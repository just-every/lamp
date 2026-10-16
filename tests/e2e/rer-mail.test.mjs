import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unstable_splitSqlQuery } from 'wrangler';
import { legacyApiFixtureSql } from './fixtures/legacy-api-fixture.mjs';
import { load } from '../operator-readiness/runtime.mjs';

const require = createRequire(import.meta.url), workerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = workerRequire('miniflare');
const { build } = workerRequire('esbuild');

test('SUB-006 NOTIFY-010 — Managed relay sends sign-in, list and threaded subscriber mail in workerd, queues 429 and exposes rejection', async t => {
  const state = await mkdtemp(join(tmpdir(), 'lamp-rer-mail-'));
  let runtime, status = 202;
  const submissions = [];
  try {
    const built = await build({ entryPoints: ['tests/e2e/rer-mail.worker.ts'], bundle: true, format: 'esm', platform: 'browser', write: false,
      external: ['cloudflare:workers', 'node:*'], define: { 'import.meta.env.DEV': 'false' },
      plugins: [{ name: 'renderer-assets', setup(builder) {
        builder.onResolve({ filter: /\?(inline|raw)$/ }, args => ({ path: resolve(args.resolveDir, args.path.split('?')[0]), namespace: 'renderer-asset' }));
        builder.onLoad({ filter: /.*/, namespace: 'renderer-asset' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`, loader: 'js' }));
      } }],
    });
    runtime = new Miniflare(convertV4MiniflareOptions({ name: 'lamp-rer-mail', modules: true, script: built.outputFiles[0].text,
      port: 0, inspectorPort: 0, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
      bindings: { LAMP_PAGE_HOST: 'status.example.test', LAMP_APP_HOST: 'app.example.test', AUTH_ORIGIN: 'https://app.example.test',
        SETUP_OPERATOR_EMAIL: 'operator@example.test', SESSION_SECRET: 'test-only-managed-session-secret-aaaaaaaaaaaa',
        SUBSCRIBER_TOKEN_SECRET: 'test-only-subscriber-token-secret-bbbbbbbbb', MAIL_PROVIDER: 'rer', MAIL_FROM: 'status@example.test',
        MAIL_RELAY_URL: 'https://relay.example.test/api/managed-mail/send', MAIL_API_KEY: 'test-only-installation-credential' },
      d1Databases: ['DB'], r2Buckets: ['SNAPSHOTS'], durableObjects: { SNAPSHOT_CACHE: { className: 'SnapshotCache', useSQLite: true } },
      queueProducers: { JOBS: 'lamp-rer-mail-jobs' }, resourcePersistencePath: join(state, 'storage'),
      outboundService: async request => {
        assert.equal(request.url, 'https://relay.example.test/api/managed-mail/send', 'never follow a relay redirect');
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.get('authorization'), 'Bearer test-only-installation-credential');
        assert.equal(request.headers.get('content-type'), 'application/json');
        const body = await request.json();
        submissions.push(body);
        const messageId = `<${createHash('sha256').update(body.messageKey).digest('hex')}@relay.example.test>`;
        return new Response(status === 202 ? JSON.stringify({messageId}) : null, { status, headers: { 'Retry-After': '60', Location: 'https://credential-leak.example.test/' } });
      },
    }));
    const db = await runtime.getD1Database('DB');
    const execute = sql => db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));
    for (const name of (await readdir('migrations/core')).filter(n => n.endsWith('.sql')).sort()) await execute(await readFile(join('migrations/core', name), 'utf8'));
    await execute(legacyApiFixtureSql());
    await execute("DELETE FROM notification_delivery_attempts; DELETE FROM notification_deliveries; DELETE FROM notification_outbox; DELETE FROM subscribers WHERE channel='webhook';");
    await db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('01J00000000000000000000001','operator@example.test','Atlas operator','owner','active',?)").bind(Date.now()).run();
    const call = (path, body, cookie) => runtime.dispatchFetch(`https://app.example.test${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'manual', headers: { Host: 'app.example.test', Origin: 'https://app.example.test', 'CF-Connecting-IP': '192.0.2.1',
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const signInResponse = await call('/auth/magic-link', { email: 'operator@example.test' });
    assert.equal(signInResponse.status, 202, await signInResponse.text());
    assert.equal(submissions.length, 1, 'sign-in reaches the actual relay adapter');
    const signIn = submissions[0];
    assert.deepEqual(Object.keys(signIn).sort(), ['html', 'messageKey', 'subject', 'text', 'to']);
    assert.equal(signIn.to, 'operator@example.test');
    const token = new URL(signIn.text.match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');
    const confirmed = await call('/auth/confirm', { token });
    assert.equal(confirmed.status, 303);
    const cookie = confirmed.headers.get('set-cookie').split(';')[0];
    const { notificationPublicationStatements } = await load('src/core/features/deliveries/publication.ts');
    await db.batch(notificationPublicationStatements(db, { eventId: '01J00000000000000000000023', eventType: 'incident-update',
      incidentUpdateId: '01J00000000000000000000023', componentIds: ['01J00000000000000000000011'], channels: ['email'], queuedAt: new Date().toISOString() }));
    const tick = async () => assert.equal((await call('/__test/tick')).status, 204);
    const deliveries = async () => (await (await call('/api/app/deliveries', null, cookie)).json()).deliveries;
    status = 429;
    await tick();
    assert.equal((await deliveries())[0].outcome, 'queued');
    const queued = await db.prepare("SELECT attempts,available_at,last_error FROM notification_outbox WHERE kind='delivery-dispatch'").first();
    assert.equal(queued.attempts, 1);
    assert.ok(Date.parse(queued.available_at) > Date.now());
    assert.match(queued.last_error, /rate limit/i);
    status = 202;
    await db.prepare("UPDATE notification_outbox SET available_at='2000-01-01T00:00:00Z'").run();
    await tick();
    assert.equal((await deliveries())[0].outcome, 'queued');
    assert.ok((await deliveries())[0].providerAcceptedAt, 'acceptance is recorded without claiming inbox delivery');
    const notification = submissions.at(-1);
    assert.deepEqual(Object.keys(notification).sort(), ['html', 'listArchive', 'listHelp', 'listId', 'listUnsubscribe', 'listUnsubscribePost', 'messageKey', 'subject', 'text', 'to']);
    assert.equal(notification.listUnsubscribePost, true);
    assert.match(notification.listUnsubscribe, /<https:\/\/status\.example\.test\//);
    assert.equal(notification.to, 'ops-team@atlascloud.example');
    assert.equal(notification.listId, '<status.example.test>');
    assert.equal(notification.listArchive, '<https://status.example.test/history>');
    assert.match(notification.listHelp, /^<https:\/\/status\.example\.test\/manage\//);
    const receipt = await db.prepare("SELECT provider_receipt FROM mail_send_ledger WHERE state='accepted' AND message_key=?").bind(notification.messageKey).first();
    const firstMessageId = receipt.provider_receipt;
    assert.match(firstMessageId, /^<.+@relay\.example\.test>$/);
    assert.equal(submissions.at(-2).messageKey, notification.messageKey, '429 retry preserves the message key');
    // A later published incident update must name the first message in both threading fields.
    await execute("INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) SELECT '01J00000000000000000000025',incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,'2026-09-08T02:00:00.000Z',author_operator_id,created_at,updated_at FROM incident_updates WHERE id='01J00000000000000000000023';");
    await db.batch(notificationPublicationStatements(db, { eventId: '01J00000000000000000000025', eventType: 'incident-update',
      incidentUpdateId: '01J00000000000000000000025', componentIds: ['01J00000000000000000000011'], channels: ['email'], queuedAt: new Date().toISOString() }));
    await tick();
    const threaded = submissions.at(-1);
    assert.equal(threaded.inReplyTo, firstMessageId);
    assert.equal(threaded.references, firstMessageId);
    assert.notEqual(threaded.messageKey, notification.messageKey);
    t.diagnostic(`Relay threading: first=${firstMessageId}; second In-Reply-To=${threaded.inReplyTo}; References=${threaded.references}; distinct message keys; receipt persisted in D1.`);
    for (const field of ['listId', 'listArchive', 'listHelp', 'listUnsubscribe', 'listUnsubscribePost']) assert.equal(threaded[field], notification[field]);
    const unsubscribe = notification.listUnsubscribe.match(/<(https:\/\/[^>]+)>/)[1];
    assert.equal((await runtime.dispatchFetch(unsubscribe, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 200);
    assert.equal((await db.prepare("SELECT state FROM subscribers WHERE destination='ops-team@atlascloud.example'").first()).state, 'deactivated');
    // Independent persisted deliveries exercise each permanent relay response.
    for (const code of [301, 302, 303, 307, 308, 401]) {
      status = code;
      await execute(`UPDATE subscribers SET state='active'; DELETE FROM notification_delivery_attempts; DELETE FROM notification_deliveries; DELETE FROM notification_outbox; DELETE FROM mail_send_ledger;`);
      await db.batch(notificationPublicationStatements(db, { eventId: '01J00000000000000000000023', eventType: 'incident-update', incidentUpdateId: '01J00000000000000000000023', componentIds: ['01J00000000000000000000011'], channels: ['email'], queuedAt: new Date().toISOString() }));
      await tick();
      const delivery = (await deliveries())[0];
      assert.equal(delivery.outcome, 'failed');
      const attempt = await db.prepare('SELECT error FROM notification_delivery_attempts LIMIT 1').first();
      assert.match(attempt.error, /Managed mail was rejected.*credential/);
      assert.ok(!attempt.error.includes('test-only-installation-credential'));
      assert.ok(await db.prepare("SELECT id FROM notification_outbox WHERE kind='operator-alert'").first(), 'owner alert remains durable');
    }
    const redirects = await (await call('/__test/transport')).json();
    assert.ok(redirects.length > 0);
    assert.ok(redirects.every(mode => mode === 'manual'), 'the actual workerd fetch uses manual redirects');
  } finally { await runtime?.dispose(); await rm(state, { recursive: true, force: true }); }
});
