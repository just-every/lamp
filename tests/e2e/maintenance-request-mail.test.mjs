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

test('MAINT-005 NOTIFY-005 — maintenance mail goes out from ordinary requests before Cron starts, and Cron sends no duplicate', async () => {
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
    const call = (path, body) => runtime.dispatchFetch(`https://app.example.test${path}`, { method: body ? 'POST' : 'GET',
      headers: { Host: 'app.example.test', Origin: 'https://app.example.test', Cookie: cookie, 'CF-Connecting-IP': '192.0.2.1',
        ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const response = await call('/api/app/maintenance', { title: 'Payment provider upgrade',
      startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(), endsAt: new Date(Date.now() + 49 * 3600_000).toISOString(), componentIds: ['01J00000000000000000000011'] });
    assert.equal(response.status, 201, await response.clone().text());
    const { maintenance } = await response.json();
    const settle = async count => {
      for (let i = 0; i < 100; i++) {
        const accepted = await db.prepare('SELECT count(*) AS n FROM notification_delivery_attempts WHERE provider_message_id IS NOT NULL').first();
        if (accepted.n === count) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail(`Expected ${count} provider acceptances; received ${messages.length} sends`);
    };
    await settle(1);
    assert.equal(messages.length, 1, 'the schedule request sends its notice without any Cron run');
    await db.prepare("UPDATE maintenance SET starts_at=?,ends_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 3600_000).toISOString(), maintenance.id).run();
    // Cron has never run: an ordinary visit starts the due window and sends its notice.
    await call('/api/app/maintenance');
    await settle(2);
    // Cron's first run arrives late and finds nothing left to send.
    await call('/__test/cron');
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(messages.length, 2, 'one scheduled and one started notice, with no second send from Cron');
    const rows = (await (await call('/api/app/deliveries')).json()).deliveries;
    assert.deepEqual(rows.map(row => row.maintenanceNoticeKind).sort(), ['scheduled', 'started']);
    assert.ok(rows.every(row => row.providerAcceptedAt && row.maintenanceReference === maintenance.reference));
    assert.equal((await db.prepare('SELECT count(*) AS n FROM notification_outbox WHERE completed_at IS NULL').first()).n, 0);
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
