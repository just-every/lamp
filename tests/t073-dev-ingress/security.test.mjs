import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { developmentIngress, inspectIngress } from '../../scripts/dev-ingress/plugin.mjs';
import { proofHeader, proofPayload } from '../../scripts/dev-ingress/protocol.mjs';
import { compileMailModules } from '../t073-u5/compile-modules.mjs';

const origin = 'http://127.0.0.1:57300';
function incoming(extra = [], overrides = {}) {
  return { method: 'GET', url: '/__dev/outbox?format=json', rawHeaders: ['Host', '127.0.0.1:57300', ...extra], socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1', localPort: 57300 }, ...overrides };
}

test('raw ingress rejects forwarding, duplicate authority, internal metadata and nonlocal sockets before normalization', () => {
  assert.ok(inspectIngress(incoming()));
  for (const name of ['Forwarded', 'X-Forwarded-Host', 'x-FoRwArDeD-proto', 'X-Forwarded-For', 'X-Original-Host', 'X-Real-IP', 'CF-Connecting-IP', 'MF-Route-Override', '__VITE_ENVIRONMENT_NAME__', proofHeader, `${proofHeader}-other`]) {
    assert.equal(inspectIngress(incoming([name, ''])), null, name);
    assert.equal(inspectIngress(incoming([name, '127.0.0.1:57300', name, '127.0.0.1:57300'])), null, name);
  }
  for (const field of ['Host', 'Origin', 'Sec-Fetch-Site']) {
    const rawHeaders = ['Host', '127.0.0.1:57300', field, field === 'Host' ? '127.0.0.1:57300' : origin];
    if (field !== 'Host') rawHeaders.push(field, origin);
    assert.equal(inspectIngress(incoming([], { rawHeaders })), null, field);
  }
  for (const host of ['public.example.test:57300', 'localhost.evil:57300', 'evil.localhost:57300', 'localhost.:57300', '127.1:57300', '2130706433:57300', '0x7f000001:57300', '127.0.0.2:57300', '127.0.0.1:57301', '127.0.0.1:65536', 'user@127.0.0.1:57300']) {
    assert.equal(inspectIngress(incoming([], { rawHeaders: ['Host', host] })), null, host);
  }
  for (const value of ['null', 'https://evil.example', 'http://localhost:57300']) assert.equal(inspectIngress(incoming(['Origin', value])), null);
  assert.equal(inspectIngress(incoming(['Sec-Fetch-Site', 'cross-site'])), null);
  for (const target of [`${origin}/__dev/outbox`, '//evil.example/__dev/outbox', '/\\evil.example', '/#fragment']) assert.equal(inspectIngress(incoming([], { url: target })), null);
  for (const target of ['/__debug', '/__vite_plugin_cloudflare_init__', '/__vite_plugin_cloudflare_get_export_types__', '/cdn-cgi/local/explorer/api/r2/buckets', '/cdn-cgi/explorer', '/__cf_local/']) assert.equal(inspectIngress(incoming([], { url: target })), null);
  for (const remoteAddress of ['192.0.2.1', '127.0.0.2', undefined]) assert.equal(inspectIngress(incoming([], { socket: { remoteAddress, localAddress: '127.0.0.1', localPort: 57300 } })), null);
});

test('Worker proof is private, single-use, instance-specific, and binds method, target, Host, Origin and fetch context', async () => {
  const directory = await mkdtemp(resolve('.t073-ingress-security-'));
  try {
    await copyFile('scripts/dev-ingress/protocol.mjs', join(directory, 'protocol.mjs'));
    await writeFile(join(directory, 'worker.mjs'), stripTypeScriptTypes(await readFile('scripts/dev-ingress/worker.ts', 'utf8')));
    const { createDevelopmentAuthenticator } = await import(pathToFileURL(join(directory, 'worker.mjs')).href);
    const key = randomBytes(32).toString('hex');
    const authenticate = createDevelopmentAuthenticator(key);
    const signed = (issued = Date.now()) => {
      const stamp = `${issued}.${randomBytes(16).toString('hex')}`;
      const payload = proofPayload('GET', `${origin}/__dev/outbox`, '127.0.0.1:57300', origin, 'same-origin', stamp);
      const signature = createHmac('sha256', Buffer.from(key, 'hex')).update(payload).digest('hex');
      return new Request(`${origin}/__dev/outbox`, { headers: { host: '127.0.0.1:57300', origin, 'sec-fetch-site': 'same-origin', 'x-forwarded-host': '127.0.0.1:57300', [proofHeader]: `${stamp}.${signature}` } });
    };
    const original = signed();
    const cleaned = await authenticate(original);
    assert.ok(cleaned);
    assert.equal(cleaned.headers.has(proofHeader), false);
    assert.equal(cleaned.headers.has('x-forwarded-host'), false);
    assert.equal(await authenticate(original), null, 'replay is rejected');
    const concurrent = signed();
    assert.equal((await Promise.all([authenticate(concurrent), authenticate(concurrent)])).filter(Boolean).length, 1);
    for (const [field, value] of [['host', 'localhost:57300'], ['origin', 'null'], ['sec-fetch-site', 'cross-site'], ['x-forwarded-host', 'localhost:57300'], [proofHeader, 'spoof']]) {
      const request = signed();
      request.headers.set(field, value);
      assert.equal(await authenticate(request), null, field);
    }
    for (const options of [{ method: 'POST' }, { url: `${origin}/signin/request` }, { url: 'http://localhost:57300/__dev/outbox' }, { url: `${origin}/__dev/outbox?other=1` }]) {
      const request = signed();
      assert.equal(await authenticate(new Request(options.url ?? request.url, { method: options.method ?? request.method, headers: request.headers })), null);
    }
    assert.equal(await createDevelopmentAuthenticator(randomBytes(32).toString('hex'))(signed()), null, 'another instance cannot verify proof');
    assert.equal(await authenticate(signed(Date.now() - 360_000)), null, 'expired proof');
    assert.equal(await authenticate(signed(Date.now() + 360_000)), null, 'future proof');
    assert.equal(await authenticate(new Request(`${origin}/__dev/outbox`, { headers: { 'x-forwarded-host': '127.0.0.1:57300' } })), null, 'matching forwarding is insufficient');
    const plugin = developmentIngress();
    const id = plugin.resolveId('virtual:lamp-dev-ingress');
    assert.throws(() => plugin.load.call({ environment: { name: 'client' } }, id), /private to the Worker/);
    assert.equal(plugin.load.call({ environment: { name: 'ssr' } }, id).map.sources.length, 0, 'private module has no published source map');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unconsumed internal proof cannot select local capture in direct Worker composition', async () => {
  const modules = await compileMailModules(true);
  try {
    const bindings = { LAMP_PAGE_HOST: '127.0.0.1', LAMP_APP_HOST: '127.0.0.1', LAMP_DEV_OUTBOX: {} };
    for (const name of [proofHeader, `${proofHeader}-other`]) {
      assert.equal(modules.mail.createDevelopmentMailSender(bindings, new Request(`${origin}/signin/request`, { headers: { [name]: 'client-supplied' } })), null);
    }
  } finally { await modules.close(); }
});
