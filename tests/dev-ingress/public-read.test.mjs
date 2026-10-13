import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectIngress } from '../../scripts/dev-ingress/plugin.mjs';
import { compileMailModules } from '../local-mail/compile-modules.mjs';

const owner = 'http://127.0.0.1:57300';
const page = 'http://localhost:57300';
const metadata = { origin: owner, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' };
function incoming(path, { method = 'GET', headers = {}, targetOrigin = page } = {}) {
  const fields = { host: new URL(targetOrigin).host, ...metadata, ...headers };
  return { method, url: path, rawHeaders: Object.entries(fields).filter(([, value]) => value !== undefined).flat(),
    socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1', localPort: 57300 } };
}
function request(path, options = {}) {
  const raw = incoming(path, options);
  const headers = Array.from({ length: raw.rawHeaders.length / 2 }, (_, i) => raw.rawHeaders.slice(i * 2, i * 2 + 2));
  return new Request(new URL(path, options.targetOrigin ?? page), { method: raw.method, headers });
}

test('Cutover owner GETs admit safe aliases and native destinations, without enabling local mail', async () => {
  const dev = await compileMailModules(true);
  const production = await compileMailModules(false);
  let storageReads = 0;
  const storage = new Proxy({}, { get() { storageReads++; throw new Error('Cross-site request reached private storage'); } });
  const bindings = { LAMP_APP_HOST: '127.0.0.1', LAMP_PAGE_HOST: 'localhost', LAMP_DEV_OUTBOX: storage };
  try {
    for (const path of ['/old-service/outage', '/unfamiliar-provider-link/', '/incidents/source_opaque-id', '/incidents/INC-7', '/maintenance/SCH-9', '/history.atom']) {
      const read = request(path);
      const proof = inspectIngress(incoming(path));
      assert.ok(proof, path);
      assert.deepEqual(JSON.parse(proof).slice(0, 5), ['GET', read.url, 'localhost:57300', owner, 'cross-site']);
      assert.equal(dev.access.admitsDevelopmentRequest(bindings, read), true, path);
      assert.equal(production.access.admitsDevelopmentRequest(bindings, read), false);
      assert.equal(dev.access.canUseDevelopmentMail(bindings, read), false);
      assert.equal(dev.mail.createDevelopmentMailSender(bindings, read), null);
      await dev.mail.prepareDevelopmentMailBindings(bindings, read);
      for (const changed of [
        { LAMP_APP_HOST: '[::1]' }, { LAMP_PAGE_HOST: '[::1]' },
        { LAMP_APP_HOST: 'localhost', LAMP_PAGE_HOST: '127.0.0.1' },
        { LAMP_DEV_OUTBOX: undefined },
      ]) assert.equal(dev.access.admitsDevelopmentRequest({ ...bindings, ...changed }, read), false, 'configured surfaces and dev storage remain required');
    }
    assert.equal(storageReads, 0, 'public admission cannot initialize or inspect private mail storage');
    const navigation = new Request(`${page}/confirm-subscription/test-token`, { headers: {
      referer: `${owner}/app`, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document',
    } });
    assert.equal(dev.access.admitsDevelopmentRequest(bindings, navigation), true);
    assert.equal(dev.access.canPrepareDevelopmentMail(bindings, navigation), true, 'existing subscriber navigation still prepares token verification');
    assert.equal(dev.access.canUseDevelopmentMail(bindings, navigation), false);
  } finally { await dev.close(); await production.close(); }
});

test('Cutover exception rejects private routes, credentials, other initiators and malformed raw targets', async () => {
  const dev = await compileMailModules(true);
  const bindings = { LAMP_APP_HOST: '127.0.0.1', LAMP_PAGE_HOST: 'localhost', LAMP_DEV_OUTBOX: {} };
  const rejected = [
    ['/CDN-CGI/local/explorer', {}],
    ...['/', '/app', '/app/settings', '/api/app/session', '/api/public/status', '/api/intake/source', '/auth/dev/enter', '/signin', '/setup', '/setup/state', '/health', '/docs', '/__dev/outbox', '/__dev/key', '/subscribe', '/manage/token', '/unsubscribe/token', '/confirm-subscription/token', '/assets/status-page.js', '/app-assets/script.js', '/src/server.ts', '/node_modules/vite/client', '/@id/virtual:lamp-dev-ingress', '/__vite_plugin_cloudflare_init__', '/cdn-cgi/handler/scheduled', '/__debug', '/__cf_local', '/scripts/dev-ingress/worker?import', '/old-link?raw', '/incidents/INC-0', '/maintenance/SCH-0'].map(path => [path, {}]),
    ...['HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'].map(method => ['/old-link', { method }]),
    ...['https://evil.test', 'null', 'http://127.0.0.1:57301', 'https://127.0.0.1:57300', 'http://127.1:57300', 'http://127.0.0.1:57300/', 'http://user@127.0.0.1:57300'].map(origin => ['/old-link', { headers: { origin } }]),
    ...['cookie', 'cookie2', 'authorization', 'proxy-authorization', 'x-rer-dev-key', 'x-forwarded-host', 'x-lamp-dev-ingress'].map(name => ['/old-link', { headers: { [name]: 'test-only' } }]),
    ...['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'origin'].map(name => ['/old-link', { headers: { [name]: undefined } }]),
    ...[['sec-fetch-site', 'same-site'], ['sec-fetch-mode', 'no-cors'], ['sec-fetch-dest', 'script']].map(([name, value]) => ['/old-link', { headers: { [name]: value } }]),
    ['/old-link', { targetOrigin: 'http://localhost:57301' }],
  ];
  try {
    for (const [path, options] of rejected) {
      assert.equal(inspectIngress(incoming(path, options)), null, `${path} ${JSON.stringify(options)}`);
      assert.equal(dev.access.admitsDevelopmentRequest(bindings, request(path, options)), false, `${path} Worker`);
    }
    // The raw boundary is only a candidate check. Another local site is not
    // owner authority, and reversing the surfaces must fail in the Worker.
    for (const options of [{ headers: { origin: 'http://[::1]:57300' } }, { targetOrigin: owner, headers: { origin: page } }]) {
      assert.ok(inspectIngress(incoming('/old-link', options)));
      assert.equal(dev.access.admitsDevelopmentRequest(bindings, request('/old-link', options)), false);
    }
    for (const path of ['/private/../old-link', '/%6fld-link', '/old-link%2fnext', '/old-link#fragment', '/old-link?import', '//localhost:57300/old-link']) {
      assert.equal(inspectIngress(incoming(path)), null, 'raw path must itself be safe before URL normalization');
    }
    for (const name of ['Host', 'Origin', 'Sec-Fetch-Site', 'Sec-Fetch-Mode', 'Sec-Fetch-Dest']) {
      const raw = incoming('/old-link');
      raw.rawHeaders.push(name, raw.rawHeaders[raw.rawHeaders.findIndex(value => value === name.toLowerCase()) + 1]);
      assert.equal(inspectIngress(raw), null, `duplicate ${name}`);
    }
    for (const name of ['Cookie', 'Authorization']) {
      const raw = incoming('/old-link'); raw.rawHeaders.push(name, '', name, '');
      assert.equal(inspectIngress(raw), null, 'even empty credentials are denied');
    }
  } finally { await dev.close(); }
});
