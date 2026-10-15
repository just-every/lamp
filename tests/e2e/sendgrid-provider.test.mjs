import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';
import { createServer } from 'vite';
import { getPlatformProxy } from 'wrangler';
let vite, platform, state, Sender, repository, verify, handleEvents;
before(async () => {
  vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true } });
  ({ SendGridMailSender: Sender } = await vite.ssrLoadModule('/src/core/platform/mail/sendgrid.ts'));
  ({ createMailSendRepository: repository } = await vite.ssrLoadModule('/src/core/platform/mail/repository.ts'));
  ({ verifySendGridWebhook: verify } = await vite.ssrLoadModule('/src/core/platform/mail/sendgrid-webhooks.ts'));
  ({ handleSendGridEvents: handleEvents } = await vite.ssrLoadModule('/src/core/features/deliveries/sendgrid-events.ts'));
  state = await mkdtemp(join(tmpdir(), 'lamp-sendgrid-'));
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state, '--config', 'wrangler.jsonc'], { stdio: 'pipe' });
  platform = await getPlatformProxy({ configPath: 'wrangler.jsonc', remoteBindings: false, persist: { path: join(state, 'v3') } });
});
after(async () => { await platform?.dispose(); await vite?.close(); if (state) await rm(state, { recursive: true, force: true }); });
const message = id => ({ idempotencyKey: id, from: 'status@example.test', to: 'reader@example.test', subject: 'Status', text: 'Real notification', html: '<p>Real notification</p>', headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'Auto-Submitted': 'auto-generated' } });
function sender() { return new Sender({ apiKey: 'test-only-key', fromAddress: 'status@example.test' }, repository(platform.env.DB)); }





test('crash-before-response send claim becomes visible uncertainty without resending', async t => {
  const store = repository(platform.env.DB);
  let sent;
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 202 }));
  sent = await sender().send(message('crash'));
  await platform.env.DB.prepare("UPDATE mail_send_ledger SET state = 'sending', updated_at = '2000-01-01T00:00:00Z' WHERE id = ?").bind(sent.providerMessageId).run();
  await assert.rejects(sender().send(message('crash')), e => e.retryable === false && e.providerMessageId === sent.providerMessageId);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
  assert.equal((await store.get(sent.providerMessageId)).state, 'sending');
});

test('signed raw SendGrid receipts verify and correlate delivery, bounce and complaint; altered/stale payloads fail', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(['delivered', 'bounce', 'spamreport'].map((event, i) => ({ event, sg_event_id: `event-${i}`, lamp_message_id: 'sendgrid-message', type: 'bounce' })));
  const signature = sign('sha256', Buffer.from(timestamp + body), privateKey).toString('base64');
  assert.equal(await verify({ publicKey: key, timestamp, signature, rawBody: body }), true);
  assert.equal(await verify({ publicKey: key, timestamp, signature, rawBody: body + ' ' }), false);
  assert.equal(await verify({ publicKey: key, timestamp: '1', signature, rawBody: body }), false);
  const events = [];
  const result = await handleEvents(new Request('https://app.example.test/api/intake/mail-events', { method: 'POST', headers: { 'x-twilio-email-event-webhook-timestamp': timestamp, 'x-twilio-email-event-webhook-signature': signature }, body }), key, { handleProviderEvent: async e => events.push(e) });
  assert.equal(result.status, 200);
  assert.deepEqual(events.map(e => e.type), ['delivered', 'bounced', 'complained']);
  assert.equal(events[1].hardBounce, true);
});

test('a later signed receipt reconciles an uncertain failed notification without resending', async () => {
  const { createDeliveryRepository, createDeliveriesService } = await vite.ssrLoadModule('/src/core/features/deliveries/index.ts');
  const db = platform.env.DB, now = new Date().toISOString();
  await db.batch([
    db.prepare('INSERT INTO operators (id,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?)').bind('receipt-operator', 'operator@example.test', 'Operator', now, now),
    db.prepare('INSERT INTO maintenance (id,reference,title,state,starts_at,ends_at,created_by_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind('receipt-maintenance', 'SCH-9000', 'Maintenance', 'Scheduled', now, now, 'receipt-operator', now, now),
    db.prepare('INSERT INTO subscribers (id,channel,destination,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind('uncertain-subscriber', 'email', 'uncertain@example.test', 'active', 'all', 'uncertain-token', now, now),
    db.prepare('INSERT INTO notification_deliveries (id,subscriber_id,maintenance_id,channel,outcome,queued_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind('uncertain-delivery', 'uncertain-subscriber', 'receipt-maintenance', 'email', 'failed', now, now, now),
    db.prepare('INSERT INTO notification_delivery_attempts (id,delivery_id,attempt_number,attempted_at,provider_message_id,error,created_at) VALUES (?,?,?,?,?,?,?)').bind('uncertain-attempt', 'uncertain-delivery', 1, now, 'sendgrid-uncertain', 'Acceptance unconfirmed', now),
  ]);
  await repository(db).claim('sendgrid-uncertain', 'test-envelope', now);
  const service = createDeliveriesService(createDeliveryRepository(db), {});
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify([{ event: 'delivered', sg_event_id: 'uncertain-receipt', lamp_message_id: 'sendgrid-uncertain' }]);
  const signature = sign('sha256', Buffer.from(timestamp + body), privateKey).toString('base64');
  for (let replay = 0; replay < 2; replay++) {
    const response = await handleEvents(new Request('https://app.example.test/api/intake/mail-events', { method: 'POST', headers: { 'x-twilio-email-event-webhook-timestamp': timestamp, 'x-twilio-email-event-webhook-signature': signature }, body }), key, service);
    assert.equal(response.status, 200);
  }
  assert.equal((await db.prepare('SELECT outcome FROM notification_deliveries WHERE id = ?').bind('uncertain-delivery').first()).outcome, 'delivered');
  assert.equal((await db.prepare('SELECT count(*) AS count FROM mail_provider_webhook_events WHERE provider_event_id = ?').bind('sendgrid/uncertain-receipt').first()).count, 1);
});


test('signed unknown account mail never enters Lamp provider event storage', async () => {
  const { createDeliveryRepository, createDeliveriesService } = await vite.ssrLoadModule('/src/core/features/deliveries/index.ts');
  const service = createDeliveriesService(createDeliveryRepository(platform.env.DB), {});
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify([{ event: 'delivered', sg_event_id: 'unrelated-account-mail', lamp_message_id: 'sendgrid-unknown' }]);
  const signature = sign('sha256', Buffer.from(timestamp + body), privateKey).toString('base64');
  const response = await handleEvents(new Request('https://app.example.test/api/intake/mail-events', { method: 'POST', headers: { 'x-twilio-email-event-webhook-timestamp': timestamp, 'x-twilio-email-event-webhook-signature': signature }, body }), key, service);
  assert.equal(response.status, 200);
  assert.equal((await platform.env.DB.prepare('SELECT count(*) AS count FROM mail_provider_webhook_events WHERE provider_event_id = ?').bind('sendgrid/unrelated-account-mail').first()).count, 0);
});


test('optional owner relay authenticates exact bytes and discards other products before provider event storage', async () => {
  const { createDeliveryRepository, createDeliveriesService } = await vite.ssrLoadModule('/src/core/features/deliveries/index.ts');
  const service = createDeliveriesService(createDeliveryRepository(platform.env.DB), {});
  const secret = 'test-only-lamp-relay-secret-32-characters';
  const timestamp = String(Math.floor(Date.now() / 1000));
  await repository(platform.env.DB).claim('sendgrid-relay-known', 'relay-envelope', new Date().toISOString());
  const body = JSON.stringify([{ event: 'delivered', sg_event_id: 'relay-owned', lamp_message_id: 'sendgrid-relay-known', rer_product: 'lamp' }, { event: 'delivered', sg_event_id: 'relay-other', lamp_message_id: 'sendgrid-relay-known', rer_product: 'orbit' }]);
  const signature = 'v1=' + createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
  const request = (text = body, ts = timestamp) => new Request('https://app.example.test/api/intake/mail-events', { method: 'POST', headers: { 'x-rer-mail-timestamp': ts, 'x-rer-mail-signature': signature }, body: text });
  assert.equal((await handleEvents(request(), undefined, service, secret)).status, 200);
  assert.equal((await handleEvents(request(body + ' '), undefined, service, secret)).status, 401);
  assert.equal((await handleEvents(request(body, '1'), undefined, service, secret)).status, 401);
  assert.equal((await handleEvents(request(), undefined, service, secret + '-wrong')).status, 401);
  assert.equal((await platform.env.DB.prepare("SELECT count(*) AS count FROM mail_provider_webhook_events WHERE provider_event_id = 'sendgrid/relay-owned'").first()).count, 1);
  assert.equal((await platform.env.DB.prepare("SELECT count(*) AS count FROM mail_provider_webhook_events WHERE provider_event_id = 'sendgrid/relay-other'").first()).count, 0);
});

test('full application routes signed mail events before generic alert source intake', async () => {
  const { createApp } = await vite.ssrLoadModule('/src/core/app/server.ts');
  const secret = 'test-only-full-application-relay-secret';
  const runtime = createApp({ ...platform.env, LAMP_PAGE_HOST: 'status.example.test', LAMP_APP_HOST: 'app.example.test', MAIL_PROVIDER: 'sendgrid', RER_MAIL_RELAY_SECRET: secret });
  const url = 'https://status.example.test/api/intake/mail-events';
  const unsigned = await runtime.app.request(url, { method: 'POST', body: '[]' });
  assert.equal(unsigned.status, 401);
  await repository(platform.env.DB).claim('sendgrid-application-known', 'application-envelope', new Date().toISOString());
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify([{ event: 'delivered', sg_event_id: 'application-owned', lamp_message_id: 'sendgrid-application-known', rer_product: 'lamp' }]);
  const signature = 'v1=' + createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
  const signed = await runtime.app.request(url, { method: 'POST', headers: { 'x-rer-mail-timestamp': timestamp, 'x-rer-mail-signature': signature }, body });
  assert.equal(signed.status, 200);
  assert.equal((await platform.env.DB.prepare("SELECT count(*) AS count FROM mail_provider_webhook_events WHERE provider_event_id = 'sendgrid/application-owned'").first()).count, 1);
});







 test('pre-consolidation accepted and uncertain envelopes survive serializer adoption', async t => {
  const { createHash } = await import('node:crypto');
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('old claim must not be submitted'); });
  for (const state of ['accepted', 'uncertain', 'sending']) {
    const input = message(`legacy-${state}`);
    const id = 'sendgrid-' + createHash('sha256').update(input.idempotencyKey).digest('hex');
    // Retained 1.1.0 wire bytes, intentionally independent of the new serializer.
    const oldEnvelope = JSON.stringify({ personalizations: [{ to: [{ email: input.to }], headers: input.headers, custom_args: { lamp_message_id: id, rer_product: 'lamp' } }], from: { email: input.from }, subject: input.subject, content: [{ type: 'text/plain', value: input.text }, { type: 'text/html', value: input.html }], tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false }, subscription_tracking: { enable: false }, ganalytics: { enable: false } } });
    const store = repository(platform.env.DB);
    await store.claim(id, createHash('sha256').update(oldEnvelope).digest('hex'), '2000-01-01T00:00:00Z');
    if (state !== 'sending') await store.finish(id, state);
    if (state === 'accepted') assert.deepEqual(await sender().send(input), { providerMessageId: id });
    else await assert.rejects(sender().send(input), error => error.retryable === false && error.providerMessageId === id);
    await assert.rejects(sender().send({ ...input, text: 'Different envelope' }), /different envelope/);
  }
  assert.equal(request.mock.callCount(), 0);
});

 test('native HTTP transport and durable ledger preserve every submission outcome', async t => {
  const nativeFetch = globalThis.fetch;
  let status = 202, receipt = true, interrupted = false, calls = 0, destinationCalls = 0;
  const payloads = [];
  const canary = createHttpServer((request, response) => { destinationCalls++; request.resume(); response.writeHead(202).end(); });
  canary.listen(0, '127.0.0.1'); await once(canary, 'listening');
  const provider = createHttpServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    payloads.push(JSON.parse(Buffer.concat(chunks).toString()));
    calls++;
    if (interrupted) { request.socket.destroy(); return; }
    response.writeHead(status, { ...(receipt ? { 'x-message-id': 'native-receipt' } : {}), location: `http://127.0.0.1:${canary.address().port}/leak` }).end();
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  t.mock.method(globalThis, 'fetch', (url, init) => {
    assert.equal(url, 'https://api.sendgrid.com/v3/mail/send');
    return nativeFetch(`http://127.0.0.1:${provider.address().port}/send`, init);
  });
  try {
    for (const scenario of [{ status: 202, receipt: true }, { status: 202, receipt: false }, ...[408, 429, 500, 502, 301, 302, 303, 307, 308, 400, 401].map(status => ({ status })), { status: 202, interrupted: true }]) {
      ({ status, receipt = false, interrupted = false } = scenario);
      const input = message(`native-${status}-${receipt}-${interrupted}`), before = calls;
      if (status === 202 && !interrupted) {
        const accepted = await sender().send(input);
        const record = await repository(platform.env.DB).get(accepted.providerMessageId);
        assert.equal(record.state, 'accepted');
        assert.equal(record.provider_receipt, receipt ? 'native-receipt' : null);
        assert.notEqual(accepted.providerMessageId, 'native-receipt');
        const payload = payloads.at(-1);
        assert.equal(payload.custom_args.lamp_message_id, accepted.providerMessageId);
        assert.equal(payload.custom_args.rer_delivery_id, accepted.providerMessageId);
        for (const tracking of ['open_tracking', 'click_tracking', 'subscription_tracking', 'ganalytics']) assert.equal(payload.tracking_settings[tracking].enable, false);
        assert.equal(payload.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
        await assert.rejects(sender().send({ ...input, text: 'Changed' }), /different envelope/);
        assert.deepEqual(await sender().send(input), accepted);
      } else if (status === 429) {
        await assert.rejects(sender().send(input), error => error.retryable === true);
        status = 202;
        await sender().send(input);
      } else {
        let correlation;
        await assert.rejects(sender().send(input), error => { correlation = error.providerMessageId; return error.retryable === false; });
        await assert.rejects(sender().send(input), error => error.retryable === false && error.providerMessageId === correlation);
        const record = await repository(platform.env.DB).get(correlation);
        assert.equal(record.state, status === 400 || status === 401 ? 'rejected' : 'uncertain');
      }
      assert.equal(calls - before, scenario.status === 429 ? 2 : 1);
    }
    assert.equal(destinationCalls, 0);
  } finally {
    provider.closeAllConnections(); canary.closeAllConnections();
    await Promise.all([new Promise(resolve => provider.close(resolve)), new Promise(resolve => canary.close(resolve))]);
  }
});
