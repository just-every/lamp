import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unstable_splitSqlQuery } from 'wrangler';
import { authFixture, secret } from '../auth-adoption/runtime.mjs';
import { legacyApiFixtureSql } from './fixtures/legacy-api-fixture.mjs';

const require = createRequire(import.meta.url), workerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = workerRequire('miniflare');
const { build } = workerRequire('esbuild');

test('MAINT-009 MAINT-005 NOTIFY-005 — required maintenance wording reaches scheduled, reminder and start mail without duplicate dispatch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lamp-maintenance-mail-'));
  let runtime;
  const messages = [];
  try {
    const built = await build({ entryPoints: ['tests/e2e/maintenance-request-mail.worker.ts'], bundle: true,
      format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
      define: { 'import.meta.env.DEV': 'false' }, plugins: [{ name: 'renderer-assets', setup(builder) {
        builder.onResolve({ filter: /\?(inline|raw)$/ }, args => ({ path: resolve(args.resolveDir, args.path.split('?')[0]), namespace: 'asset' }));
        builder.onLoad({ filter: /.*/, namespace: 'asset' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`, loader: 'js' }));
      } }],
    });
    runtime = new Miniflare(convertV4MiniflareOptions({ name: 'lamp-maintenance-mail', modules: true,
      script: built.outputFiles[0].text, port: 0, inspectorPort: 0, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
      bindings: { LAMP_PAGE_HOST: 'status.example.test', LAMP_APP_HOST: 'app.example.test',
        SETUP_OPERATOR_EMAIL: 'operator@example.test', SESSION_SECRET: secret,
        SUBSCRIBER_TOKEN_SECRET: 'test-only-subscriber-secret-aaaaaaaaaaaaaaaa',
        MAIL_PROVIDER: 'sendgrid', MAIL_FROM_ADDRESS: 'status@example.test', MAIL_PROVIDER_API_KEY: 'test-only-provider-key' },
      d1Databases: ['DB'], r2Buckets: ['SNAPSHOTS'], durableObjects: { SNAPSHOT_CACHE: { className: 'SnapshotCache', useSQLite: true } },
      queueProducers: { JOBS: 'lamp-maintenance-jobs' }, resourcePersistencePath: join(directory, 'storage'),
      outboundService: async request => {
        assert.equal(request.url, 'https://api.sendgrid.com/v3/mail/send');
        messages.push(await request.json());
        return new Response(null, { status: 202, headers: { 'x-message-id': `test-maintenance-${messages.length}` } });
      },
    }));
    const db = await runtime.getD1Database('DB');
    const execute = sql => db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));
    for (const name of (await readdir('migrations/core')).filter(n => n.endsWith('.sql')).sort()) await execute(await readFile(join('migrations/core', name), 'utf8'));
    await execute(legacyApiFixtureSql());
    await execute("DELETE FROM notification_deliveries; DELETE FROM notification_outbox; DELETE FROM maintenance_components; DELETE FROM maintenance; DELETE FROM subscribers WHERE channel='webhook'; UPDATE incident_updates SET next_update_at=NULL;");
    await db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('01J00000000000000000000001','operator@example.test','Owner','owner','active',?)").bind(Date.now()).run();
    const cookie = await authFixture(db, { owner: 'operator@example.test' }).signIn();
    const call = (path, body, method = body ? 'POST' : 'GET') => runtime.dispatchFetch(`https://app.example.test${path}`, { method,
      headers: { Host: 'app.example.test', Origin: 'https://app.example.test', Cookie: cookie, 'CF-Connecting-IP': '192.0.2.1',
        ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const audience = 'Customers authorizing card payments through the synthetic Lamp API.';
    const impact = 'Card authorizations may pause while the payment service is upgraded.';
    const input = { affectedAudience: audience, customerImpact: impact, title: 'Payment provider upgrade',
      startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(), endsAt: new Date(Date.now() + 49 * 3600_000).toISOString(), componentIds: ['01J00000000000000000000011'] };
    const settle = async count => {
      for (let i = 0; i < 100; i++) {
        const accepted = await db.prepare('SELECT count(*) AS n FROM notification_delivery_attempts WHERE provider_message_id IS NOT NULL').first();
        if (accepted.n === count) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail(`Expected ${count} provider acceptances; received ${messages.length} sends`);
    };
    const response = await call('/api/app/maintenance', input);
    assert.equal(response.status, 201, await response.clone().text());
    const { maintenance } = await response.json();
    assert.equal(maintenance.affectedAudience, audience); assert.equal(maintenance.customerImpact, impact);
    await settle(1);
    assert.equal(messages.length, 1, 'the schedule request sends its notice without any Cron run');
    // Existing fixture clock setup advances this stored window so the ordinary
    // request, rather than Cron, starts it at the current wall-clock instant.
    await db.prepare("UPDATE maintenance SET starts_at=?,ends_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 3600_000).toISOString(), maintenance.id).run();
    await call('/api/app/maintenance');
    await settle(2);
    // Cron's first run arrives late and finds nothing left to send.
    await call('/__test/cron');
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(messages.length, 2, 'one scheduled and one started notice, with no second send from Cron');

    const beforeInvalid = (await db.prepare('SELECT count(*) AS n FROM maintenance').first()).n;
    for (const invalid of [
      { ...input, affectedAudience: undefined }, { ...input, customerImpact: undefined },
      { ...input, affectedAudience: '', customerImpact: '' },
      { ...input, affectedAudience: '   ' }, { ...input, customerImpact: '   ' },
      { ...input, affectedAudience: 'Synthetic Lamp customer '.repeat(11) },
      { ...input, customerImpact: 'Requests may be interrupted. '.repeat(10) },
    ]) {
      const refused = await call('/api/app/maintenance', invalid);
      assert.equal(refused.status, 400, await refused.clone().text());
      assert.equal((await db.prepare('SELECT count(*) AS n FROM maintenance').first()).n, beforeInvalid, 'invalid maintenance wording creates no window');
      assert.equal(messages.length, 2, 'invalid maintenance wording sends no notice');
    }
    const reminderInput = { ...input, title: 'Synthetic Lamp payment maintenance reminder', autoStart: false, autoComplete: false,
      startsAt: new Date(Date.now() + 24 * 3600_000).toISOString(), endsAt: new Date(Date.now() + 25 * 3600_000).toISOString() };
    const reminderCreated = await call('/api/app/maintenance', reminderInput);
    assert.equal(reminderCreated.status, 201, await reminderCreated.clone().text());
    const reminderWindow = (await reminderCreated.json()).maintenance;
    await settle(3);
    // Trigger the actual Cron handler at the ordinary wall clock: this second
    // window has just reached its 24-hour reminder boundary. Only mail is fake.
    await call('/__test/cron');
    await settle(4);
    const dateOnly = { startsAt: reminderWindow.startsAt, endsAt: new Date(Date.parse(reminderWindow.endsAt) + 3600_000).toISOString() };
    const updated = await call(`/api/app/maintenance/${reminderWindow.id}/window`, dateOnly, 'PUT');
    assert.equal(updated.status, 200, await updated.clone().text());
    const preserved = (await updated.json()).maintenance;
    assert.equal(preserved.affectedAudience, audience); assert.equal(preserved.customerImpact, impact, 'date-only edits preserve the paired statements');
    await settle(5);
    const incomplete = await call(`/api/app/maintenance/${reminderWindow.id}/window`, { ...dateOnly, affectedAudience: 'A replacement audience without its paired impact.' }, 'PUT');
    assert.equal(incomplete.status, 400, await incomplete.clone().text());
    const retained = (await (await call('/api/app/maintenance')).json()).maintenance.find(row => row.id === reminderWindow.id);
    assert.equal(retained.affectedAudience, audience); assert.equal(retained.customerImpact, impact);
    const started = await call(`/api/app/maintenance/${reminderWindow.id}/start`, {});
    assert.equal(started.status, 200, await started.clone().text());
    await settle(6);
    const rows = (await (await call('/api/app/deliveries')).json()).deliveries;
    assert.deepEqual(rows.map(row => row.maintenanceNoticeKind).sort(), ['reminder', 'rescheduled', 'scheduled', 'scheduled', 'started', 'started']);
    assert.ok(rows.every(row => row.providerAcceptedAt && [maintenance.reference, reminderWindow.reference].includes(row.maintenanceReference)));
    assert.equal((await db.prepare('SELECT count(*) AS n FROM notification_outbox WHERE completed_at IS NULL').first()).n, 0);
    for (const message of messages) {
      const plain = message.content.find(part => part.type === 'text/plain')?.value;
      const html = message.content.find(part => part.type === 'text/html')?.value;
      assert.ok(plain?.includes(audience) && plain.includes(impact), 'every scheduled, reminder and start text part carries both customer statements');
      assert.ok(html?.includes(audience) && html.includes(impact), 'every scheduled, reminder and start HTML part carries both customer statements');
      assert.ok((plain.match(/UTC[+-]\d{2}:\d{2}/g) ?? []).length >= 2, 'the wording accompanies both maintenance window instants');
    }
    // An already-stored title-only window is an upgrade fixture, not an
    // allowed new native creation. Editing dates must not invent wording.
    const legacyStarts = new Date(Date.now() + 48 * 3600_000).toISOString();
    const legacyEnds = new Date(Date.now() + 49 * 3600_000).toISOString();
    await db.batch([
      db.prepare("INSERT INTO maintenance(id,reference,title,state,starts_at,ends_at,created_by_operator_id,created_at,updated_at) VALUES('synthetic-lamp-legacy-wording','SCH-940058','Synthetic Lamp title-only upgrade','Scheduled',?,?,'01J00000000000000000000001',?,?)").bind(legacyStarts, legacyEnds, legacyStarts, legacyStarts),
      db.prepare("INSERT INTO maintenance_components(id,maintenance_id,component_id,component_name,state,created_at,updated_at) VALUES('synthetic-lamp-legacy-wording-component','synthetic-lamp-legacy-wording','01J00000000000000000000011','Legacy API','Under maintenance',?,?)").bind(legacyStarts, legacyStarts),
    ]);
    const legacyEdited = await call('/api/app/maintenance/synthetic-lamp-legacy-wording/window', { startsAt: legacyStarts, endsAt: new Date(Date.parse(legacyEnds) + 3600_000).toISOString() }, 'PUT');
    assert.equal(legacyEdited.status, 200, await legacyEdited.clone().text());
    const legacy = (await legacyEdited.json()).maintenance;
    assert.equal(legacy.affectedAudience, null); assert.equal(legacy.customerImpact, null);
    await settle(7);
    const legacyPlain = messages.at(-1).content.find(part => part.type === 'text/plain')?.value;
    assert.ok(legacyPlain?.includes(legacy.title));
    assert.ok(!legacyPlain.includes(audience) && !legacyPlain.includes(impact), 'legacy title-only notices contain no invented customer wording');
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
