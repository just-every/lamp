import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { compileMailModules } from './compile-modules.mjs';
let dev, production;
let storageReads = 0;
const unopenedStore = new Proxy({}, { get() { storageReads++; throw new Error('Rejected request accessed local mail storage.'); } });
const bindings = { LAMP_APP_HOST: '127.0.0.1', LAMP_PAGE_HOST: '127.0.0.1', LAMP_DEV_OUTBOX: unopenedStore, LAMP_LOCAL_MAIL: 'true', LAMP_DEV_MAIL: 'true' };
before(async () => { dev = await compileMailModules(true); production = await compileMailModules(false); });
after(async () => { await dev?.close(); await production?.close(); });

test('actual development and exact local configured hosts are both required', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const local = { ...bindings, LAMP_APP_HOST: host, LAMP_PAGE_HOST: host };
    const request = new Request(`http://${host}:56800/__dev/outbox`);
    assert.equal(dev.access.canUseDevelopmentMail(local, request), true);
    assert.ok(dev.mail.createDevelopmentMailSender(local, request));
    assert.equal(production.access.canUseDevelopmentMail(local, request), false);
    assert.equal(production.mail.createDevelopmentMailSender(local, request), null);
  }
  for (const host of ['status.example.test', 'localhost.evil.test', 'evil.localhost', 'localhost.', '127.1', '2130706433', '0x7f000001', '0.0.0.0', '127.0.0.2', '::1', '127.0.0.1:56800', ' localhost', '']) {
    assert.equal(dev.access.canUseDevelopmentMail({ ...bindings, LAMP_APP_HOST: host }), false, host);
    assert.equal(dev.access.canUseDevelopmentMail({ ...bindings, LAMP_PAGE_HOST: host }), false, host);
  }
  assert.equal(dev.access.canUseDevelopmentMail({ ...bindings, LAMP_DEV_OUTBOX: undefined }), false);
  assert.equal(production.access.canUseDevelopmentMail(bindings), false, 'cron cannot enable production capture');
  for (const path of ['/manage/test-token', '/unsubscribe/test-token']) {
    const request = new Request(`http://127.0.0.1:56800${path}`, { method: 'POST', headers: { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(production.access.canUseDevelopmentMail(bindings, request), false, 'subscriber exception cannot enable production capture');
    assert.equal(dev.access.canUseDevelopmentMail({ ...bindings, LAMP_DEV_OUTBOX: undefined }, request), false, 'subscriber exception requires local capture storage');
  }
});

test('nonlocal, spoofed, forwarded and cross-site outbox reads fail before storage access', async () => {
  const requests = [
    ...['status.example.test', 'localhost.evil.test', 'evil.localhost', 'localhost.', '127.0.0.2'].map(host => new Request(`http://${host}:56800/__dev/outbox`)),
    ...['Forwarded', 'X-Forwarded-Host', 'X-Forwarded-For', 'X-Forwarded-Proto', 'X-Original-Host'].map(name => new Request('http://127.0.0.1:56800/__dev/outbox', { headers: { [name]: name.includes('Host') ? 'localhost' : 'for=127.0.0.1;host=localhost' } })),
    ...['localhost:56800', '127.0.0.1', '127.0.0.1.evil.test', '127.1:56800', '2130706433:56800', '127.0.0.1:65536', 'user@127.0.0.1:56800'].map(host => new Request('http://127.0.0.1:56800/__dev/outbox', { headers: { Host: host } })),
    ...['https://evil.test', 'null', 'http://localhost:56800'].map(origin => new Request('http://127.0.0.1:56800/__dev/outbox', { headers: { Origin: origin } })),
    new Request('http://127.0.0.1:56800/__dev/outbox', { headers: { 'Sec-Fetch-Site': 'cross-site' } }),
    ...['/__dev/outbox', '/__dev/outbox/test-envelope'].flatMap(path => ['GET', 'POST'].map(method => new Request(`http://127.0.0.1:56800${path}`, { method, headers: { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' } }))),
  ];
  for (const request of requests) {
    assert.equal(dev.mail.createDevelopmentMailSender(bindings, request), null, request.url);
    const response = await dev.routes.handleDevOutboxRequest(request, bindings);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const host of ['127.0.0.1', 'localhost', 'public.example.test']) {
    const request = new Request(`http://${host}:56800/__dev/outbox?format=json`);
    assert.equal((await production.routes.handleDevOutboxRequest(request, { ...bindings, LAMP_APP_HOST: host, LAMP_PAGE_HOST: host })).status, 404);
  }
  assert.equal(storageReads, 0);
});

test('captured envelope HTML remains inert, links stay local and credentials stay uncacheable', async () => {
  const id = '1'.repeat(64);
  const envelope = { id, disposition: 'captured', capturedAt: '2026-10-06T00:00:00Z', envelopeHash: '2'.repeat(64), message: {
    from: 'sender@example.test', to: '<script>alert(1)</script>@example.test', subject: '<img src=x onerror=alert(1)>',
    text: 'Sign in: http://127.0.0.1:56800/signin/complete/test-token\nhttps://evil.test/collect', html: '<script>fetch("https://evil.test")</script>', headers: {}, idempotencyKey: 'test-only-envelope',
  } };
  const fixtureStore = {};
  const db={prepare(sql){return {sql,bind(){return this;}};},async batch(statements){return statements.map(statement=>({success:true,results:statement.sql.startsWith('SELECT')?[{id,created_at:Date.parse(envelope.capturedAt),message:JSON.stringify({...envelope.message,to:[envelope.message.to],deliveryId:envelope.message.idempotencyKey})}]:[]}));}};
  const response = await dev.routes.handleDevOutboxRequest(new Request(`http://127.0.0.1:56800/__dev/outbox/${id}`), { ...bindings, LAMP_DEV_OUTBOX: fixtureStore, LAMP_BASE_MAIL: db });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.doesNotMatch(html, /<script>|<img|href="https:\/\/evil/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="http:\/\/127\.0\.0\.1:56800\/signin\/complete\/test-token"/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(await dev.routes.handleDevOutboxRequest(new Request('http://127.0.0.1:56800/other'), bindings), null);
});

test('failed capture storage fails the send without a successful substitute', async () => {
  const failureStore = { async get(){return null;}, async put() { throw new Error('test-only storage outage'); } };
  const sender = dev.mail.createDevelopmentMailSender({ ...bindings, LAMP_DEV_OUTBOX: failureStore }, new Request('http://127.0.0.1:56800/auth/magic-link'));
  await assert.rejects(sender.send({ from: 'lamp@example.test', to: 'operator@example.test', subject: 'Sign in', text: 'Native link', headers: {}, idempotencyKey: 'outage-test' }), /storage outage/);
});

test('background origin comes only from a validated first request and cannot drift', async () => {
  const objects = new Map(); // Test-only R2 fixture; native test covers real persistence/restart.
  const fixtureStore = {
    async get(key) { return objects.has(key) ? { async text() { return objects.get(key); } } : null; },
    async put(key, value, options) {
      assert.deepEqual(options.onlyIf, { etagDoesNotMatch: '*' });
      if (objects.has(key)) return null;
      objects.set(key, value);
      return { key };
    },
  };
  const local = { ...bindings, LAMP_DEV_OUTBOX: fixtureStore, SUBSCRIBER_TOKEN_SECRET: 'test-only-configured-secret' };
  assert.equal(await dev.mail.resolveDevelopmentMailOrigin(local), null);
  const incoming = new Request('http://127.0.0.1:56800/subscribe');
  await dev.mail.prepareDevelopmentMailBindings(local, incoming);
  assert.equal(await dev.mail.resolveDevelopmentMailOrigin(local), 'http://127.0.0.1:56800');
  await dev.mail.prepareDevelopmentMailBindings(local, incoming);
  await assert.rejects(dev.mail.prepareDevelopmentMailBindings(local, new Request('https://127.0.0.1:56800/')), /differs from the persisted/);
  await assert.rejects(dev.mail.prepareDevelopmentMailBindings(local, new Request('http://127.0.0.1:56801/')), /differs from the persisted/);
  assert.equal(await dev.mail.resolveDevelopmentMailOrigin(local), 'http://127.0.0.1:56800');
  const separateHosts = { ...local, LAMP_PAGE_HOST: 'localhost' };
  await assert.rejects(dev.mail.resolveDevelopmentMailOrigin(separateHosts), /does not match/);
  for (const invalid of ['http://public.example.test', 'http://127.0.0.1:56800/path', 'http://user@127.0.0.1:56800', 'not-a-url']) {
    objects.set('configuration/public-origin', invalid);
    await assert.rejects(dev.mail.resolveDevelopmentMailOrigin(local), /does not match/);
  }
  assert.equal(await production.mail.resolveDevelopmentMailOrigin(bindings), null);
  assert.equal(storageReads, 0);
  objects.clear();
  await dev.mail.prepareDevelopmentMailBindings(separateHosts, incoming);
  assert.equal(await dev.mail.resolveDevelopmentMailOrigin(separateHosts), null, 'an app-host request cannot invent a separately configured page origin');
  await dev.mail.prepareDevelopmentMailBindings(local, new Request('http://127.0.0.1:56800/', { headers: { 'X-Forwarded-Host': 'localhost' } }));
  assert.equal(await dev.mail.resolveDevelopmentMailOrigin(local), null, 'a rejected request cannot establish a background origin');
});
