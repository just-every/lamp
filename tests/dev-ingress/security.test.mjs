import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { developmentIngress, inspectIngress } from '../../scripts/dev-ingress/plugin.mjs';
import { proofHeader, proofPayload } from '../../scripts/dev-ingress/protocol.mjs';
import { compileAccess } from './compile-access.mjs';

const origin = 'http://127.0.0.1:57300';
function incoming(extra = [], overrides = {}) {
  return { method: 'GET', url: '/health?format=json', rawHeaders: ['Host', '127.0.0.1:57300', ...extra], socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1', localPort: 57300 }, ...overrides };
}

test('raw ingress admits the Worker\'s own CF-Worker subrequest only as a plain GET or HEAD', () => {
  assert.ok(inspectIngress(incoming(['CF-Worker', 'lamp.example.com'], { url: '/' })));
  assert.ok(inspectIngress(incoming(['CF-Worker', 'lamp.example.com'], { method: 'HEAD', url: '/' })));
  assert.equal(inspectIngress(incoming(['CF-Worker', 'a', 'CF-Worker', 'b'])), null, 'duplicate');
  assert.equal(inspectIngress(incoming(['CF-Worker', 'a', 'CF-Connecting-IP', '203.0.113.9'])), null, 'other cf metadata');
  assert.equal(inspectIngress(incoming(['CF-Worker', 'a'], { method: 'POST', url: '/auth/magic-link' })), null, 'POST');
  for (const browser of [['Origin', origin], ['Sec-Fetch-Site', 'same-origin'], ['Sec-Fetch-Mode', 'navigate']]) {
    assert.equal(inspectIngress(incoming(['CF-Worker', 'a', ...browser])), null, browser[0]);
  }
});

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
  for (const target of [`${origin}/health`, '//evil.example/health', '/\\evil.example', '/#fragment']) assert.equal(inspectIngress(incoming([], { url: target })), null);
  for (const target of ['/__debug', '/__vite_plugin_cloudflare_init__', '/__vite_plugin_cloudflare_get_export_types__', '/cdn-cgi/local/explorer/api/r2/buckets', '/cdn-cgi/explorer', '/__cf_local/']) assert.equal(inspectIngress(incoming([], { url: target })), null);
  for (const remoteAddress of ['192.0.2.1', '127.0.0.2', undefined]) assert.equal(inspectIngress(incoming([], { socket: { remoteAddress, localAddress: '127.0.0.1', localPort: 57300 } })), null);
});

test('Worker proof is private, single-use, instance-specific, and binds method, target, Host, Origin and fetch context', async () => {
  const directory = await mkdtemp(resolve(process.env.TMPDIR ?? '.', '.lamp-ingress-security-'));
  try {
    await copyFile('scripts/dev-ingress/protocol.mjs', join(directory, 'protocol.mjs'));
    await writeFile(join(directory, 'worker.mjs'), stripTypeScriptTypes(await readFile('scripts/dev-ingress/worker.ts', 'utf8')));
    const { createDevelopmentAuthenticator } = await import(pathToFileURL(join(directory, 'worker.mjs')).href);
    const key = randomBytes(32).toString('hex');
    const authenticate = createDevelopmentAuthenticator(key);
    const signed = (issued = Date.now(), input = {}) => {
      const method = input.method ?? 'GET';
      const url = input.url ?? `${origin}/health`;
      const requestOrigin = input.origin ?? origin;
      const stamp = `${issued}.${randomBytes(16).toString('hex')}`;
      const payload = proofPayload(method, url, '127.0.0.1:57300', requestOrigin, 'same-origin', stamp);
      const signature = createHmac('sha256', Buffer.from(key, 'hex')).update(payload).digest('hex');
      return new Request(url, { method, headers: { host: '127.0.0.1:57300', origin: requestOrigin, 'sec-fetch-site': 'same-origin', 'x-forwarded-host': '127.0.0.1:57300', [proofHeader]: `${stamp}.${signature}` } });
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
    for (const options of [{ method: 'POST' }, { url: `${origin}/auth/magic-link` }, { url: 'http://localhost:57300/health' }, { url: `${origin}/health?other=1` }]) {
      const request = signed();
      assert.equal(await authenticate(new Request(options.url ?? request.url, { method: options.method ?? request.method, headers: request.headers })), null);
    }
    assert.equal(await createDevelopmentAuthenticator(randomBytes(32).toString('hex'))(signed()), null, 'another instance cannot verify proof');
    assert.equal(await authenticate(signed(Date.now() - 360_000)), null, 'expired proof');
    assert.equal(await authenticate(signed(Date.now() + 360_000)), null, 'future proof');
    assert.equal(await authenticate(new Request(`${origin}/health`, { headers: { 'x-forwarded-host': '127.0.0.1:57300' } })), null, 'matching forwarding is insufficient');
    for (const path of ['/manage/test-token', '/unsubscribe/test-token']) {
      const subscriber = () => signed(Date.now(), { method: 'POST', url: `${origin}${path}`, origin: 'null' });
      const request = subscriber();
      const accepted = await authenticate(request);
      assert.ok(accepted);
      assert.equal(accepted.headers.get('origin'), 'null', 'proof consumption preserves the actual origin');
      assert.equal(accepted.headers.get('sec-fetch-site'), 'same-origin');
      assert.equal(await authenticate(request), null, 'subscriber proof replay fails');
      for (const [field, value] of [['origin', origin], ['origin', null], ['sec-fetch-site', 'same-site'], ['sec-fetch-site', null]]) {
        const altered = subscriber();
        if (value === null) altered.headers.delete(field); else altered.headers.set(field, value);
        assert.equal(await authenticate(altered), null, 'subscriber metadata tampering fails');
      }
      for (const change of [{ method: 'GET' }, { url: `${origin}/health` }, { url: `${origin}${path}?changed=1` }]) {
        const altered = subscriber();
        assert.equal(await authenticate(new Request(change.url ?? altered.url, { method: change.method ?? altered.method, headers: altered.headers })), null, 'subscriber target or method tampering fails');
      }
    }
    const plugin = developmentIngress();
    const id = plugin.resolveId('virtual:lamp-dev-ingress');
    assert.throws(() => plugin.load.call({ environment: { name: 'client' } }, id), /private to the Worker/);
    assert.equal(plugin.load.call({ environment: { name: 'ssr' } }, id).map.sources.length, 0, 'private module has no published source map');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('no-referrer subscriber POSTs pass both development gates only with exact same-origin browser metadata', async () => {
  const modules = await compileAccess(true);
  const bindings = { LAMP_PAGE_HOST: '127.0.0.1', LAMP_APP_HOST: '127.0.0.1',  };
  const metadata = ['Origin', 'null', 'Sec-Fetch-Site', 'same-origin'];
  function check(target, method, headers, allowed) {
    const fields = new Headers(Array.from({ length: headers.length / 2 }, (_, index) => headers.slice(index * 2, index * 2 + 2)));
    const payload = inspectIngress(incoming(headers, { method, url: target }));
    assert.equal(payload !== null, allowed, 'raw ingress decision');
    if (payload !== null) {
      assert.deepEqual(JSON.parse(payload).slice(0, 5), [method, new URL(target, origin).href, '127.0.0.1:57300', fields.get('origin'), fields.get('sec-fetch-site')]);
    }
    const request = new Request(new URL(target, origin), { method, headers: fields });
    assert.equal(modules.access.admitsDevelopmentRequest(bindings, request), allowed, 'Worker gate decision');
  }
  try {
    for (const path of ['/manage/v1.manage.test-id.test_signature', '/unsubscribe/v1.unsubscribe.test-id.test_signature', '/confirm-subscription/v1.confirm.test-id.test_signature', '/subscribe/teams']) {
      check(path, 'POST', metadata, true);
      check(`${path}?selection=all`, 'POST', metadata, true);
      for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) check(path, method, metadata, false);
      for (const site of [undefined, '', 'none', 'same-site', 'cross-site', 'Same-Origin', 'same-origin, same-origin']) {
        check(path, 'POST', ['Origin', 'null', ...(site === undefined ? [] : ['Sec-Fetch-Site', site])], false);
      }
      for (const value of ['', 'NULL', 'https://evil.example', 'http://localhost:57300', 'http://127.0.0.1:57301']) {
        check(path, 'POST', ['Origin', value, 'Sec-Fetch-Site', 'same-origin'], false);
      }
      // Existing ordinary origins and absent headers retain their behavior,
      // including non-browser RFC 8058 clients that do not send Origin.
      check(path, 'POST', [], true);
      check(path, 'POST', ['Origin', origin, 'Sec-Fetch-Site', 'same-origin'], true);
      assert.equal(inspectIngress(incoming([...metadata, 'Origin', 'null'], { method: 'POST', url: path })), null);
      assert.equal(inspectIngress(incoming([...metadata, 'Sec-Fetch-Site', 'same-origin'], { method: 'POST', url: path })), null);
    }
    for (const path of ['/manage', '/manage/', '/manage/a/', '/manage/a/b', '/manage/a%2fb', '/manage/a%5cb', '/manage/%00', '/manage/%0a', '/manage/%252f', '/manage/a;b', '/Manage/a', '/management/a', '/unsubscribe', '/unsubscribe/', '/unsubscribe/a/b', '/unsubscribe/a%2Fb', '/health', '/health/detail', '/auth/magic-link', '/setup', '/api/app/subscribers', '/subscribe', '/subscribe/teams/', '/subscribe/teams/a', '/confirm-subscription/', '/confirm-subscription/a/b', '/confirm-subscription/a%2Fb', '/assets/status-page.css', '/__debug', '/cdn-cgi/local/explorer']) {
      check(path, 'POST', metadata, false);
    }
    // WHATWG URL parsing removes dot segments. Inspect the original socket
    // target before that normalization can turn a lookalike into an exception.
    for (const path of ['/manage/.', '/manage/..', '/manage/../manage/a', '/other/../manage/a', '/manage/%2e%2e/manage/a', '/%6danage/a', '/manage/a\\b', '/manage/a\u0000', '/manage/a#fragment']) {
      assert.equal(inspectIngress(incoming(metadata, { method: 'POST', url: path })), null, 'noncanonical raw target');
    }
  } finally { await modules.close(); }
});
