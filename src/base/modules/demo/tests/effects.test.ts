import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from '../../container/adapters/d1-workerd.mjs';

const ROOT = new URL('../../', import.meta.url);

// Exercise the real Worker entry; replace only the external network edge.
async function worker(t, bindings) {
  const calls = [];
  const modules = ['demo/tests/fixture.mjs', ...['index', 'effects', 'responses', 'label', 'navigation'].map(name => `demo/${name}.mjs`), ...['http', 'csp', 'errors', 'crypto', 'loopback'].map(name => `operator-auth/${name}.mjs`)];
  const mf = new Miniflare(convertV4MiniflareOptions({ modulesRoot: fileURLToPath(ROOT), modules: modules.map(path => ({ type: 'ESModule', path: fileURLToPath(new URL(path, ROOT)) })), compatibilityDate: '2026-09-08', d1Databases: { DB: 'demo' }, bindings,
    outboundService(request) { calls.push(`${request.method} ${request.url}`); return Response.json({ reached: new URL(request.url).pathname }, { status: 202, headers: { 'x-message-id': 'real-network-id' } }); },
  }));
  t.after(() => mf.dispose());
  return { get: path => mf.dispatchFetch(`http://127.0.0.1${path}`), calls };
}

test('demo public reads and POST probes reach the network, sends complete successfully without leaving', async t => {
  const { get, calls } = await worker(t, { RER_DEMO: '1' });
  assert.deepEqual(await (await get('/read')).json(), { reached: '/page' });
  assert.deepEqual(await (await get('/probe')).json(), { reached: '/check' });
  const before = calls.length;
  const sent = await (await get('/send')).json();
  assert.equal(sent.accepted, true);
  assert.ok(sent.id);
  assert.equal((await (await get('/chat')).json()).ok, true);
  const payment = await (await get('/payment')).json();
  assert.equal(payment.payment_status, 'paid');
  assert.equal(new URL(payment.url).pathname, '/paid');
  const hook = await (await get('/webhook')).json();
  assert.equal(hook.success, true);
  assert.equal(hook.event, 'record.created');
  assert.deepEqual(await (await get('/binding')).json(), { sent: 'demo' });
  assert.equal(calls.length, before, 'no send reached the network');
});

test('demo answers the Mailgun envelope for its exact host and subdomains, not for lookalike hosts', async t => {
  const { get, calls } = await worker(t, { RER_DEMO: '1' });
  for (const host of ['mailgun.net', 'api.mailgun.net', 'api.eu.mailgun.net']) assert.equal((await (await get(`/mail?host=${host}`)).json()).message, 'Queued. Thank you.', host);
  for (const host of ['evilmailgun.net', 'mailgun.net.example.com']) assert.equal((await (await get(`/mail?host=${host}`)).json()).message, undefined, host);
  assert.equal(calls.length, 0, 'no send reached the network');
});

test('demo label: one static script, the suffix as data, the title suffixed, CSP admits the script hash', async t => {
  const { get } = await worker(t, { RER_DEMO: '1' });
  const response = await get('/');
  const html = await response.text();
  assert.match(html, /<title>App Demo<\/title>/);
  assert.match(html, /<style data-rer-label="Demo">/);
  const script = /<script>([^]*?)<\/script>/.exec(html)[1];
  assert.ok(script.includes('dataset.rerLabel'), 'the script reads the suffix from the style element');
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script))).toString('base64');
  assert.ok(response.headers.get('content-security-policy').includes(`script-src 'sha256-${digest}'`));
});

test('ordinary runtime sends remain real and the Worker is undecorated', async t => {
  const { get, calls } = await worker(t, {});
  assert.deepEqual(await (await get('/send')).json(), { accepted: true, id: 'real-network-id' });
  assert.equal(calls.length, 1);
  assert.deepEqual(await (await get('/binding')).json(), { sent: 'real' });
  assert.equal((await get('/')).headers.get('content-security-policy'), "default-src 'none'; style-src 'self'");
});
