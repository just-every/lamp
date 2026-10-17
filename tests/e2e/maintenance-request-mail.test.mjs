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
const calendarInstant = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

function calendarValues(content) {
  const lines = content.replace(/\r\n[ \t]/g, '').split('\r\n');
  assert.equal(lines.filter(line => line === 'BEGIN:VEVENT').length, 1, 'one maintenance email carries one window');
  return new Map(lines.filter(line => line.includes(':')).map(line => {
    const separator = line.indexOf(':');
    return [line.slice(0, separator), line.slice(separator + 1).replace(/\\([nN,;\\])/g, (_, character) => /[nN]/.test(character) ? '\n' : character)];
  }));
}

function attachedCalendar(payload, provider, expected) {
  assert.equal(payload.attachments?.length, 1, `${provider} submits its calendar in the actual provider request`);
  const attachment = payload.attachments[0];
  assert.match(attachment.filename, /\.ics$/i);
  assert.match(provider === 'sendgrid' ? attachment.type : attachment.content_type, /^text\/calendar(?:;|$)/i);
  if (provider === 'sendgrid') assert.equal(attachment.disposition, 'attachment');
  const calendar = calendarValues(Buffer.from(attachment.content, 'base64').toString('utf8'));
  assert.equal(calendar.get('METHOD'), 'PUBLISH');
  assert.equal(calendar.get('SUMMARY'), expected.title);
  assert.equal(calendar.get('DTSTART'), calendarInstant(expected.startsAt));
  assert.equal(calendar.get('DTEND'), calendarInstant(expected.endsAt));
  assert.equal(calendar.get('URL'), `https://status.example.test/maintenance/${expected.reference}`);
  for (const field of ['affectedAudience', 'customerImpact', 'whatStillWorks', 'details']) {
    assert.ok(calendar.get('DESCRIPTION').includes(expected[field]), `the attachment retains ${field}, including escaped text and Unicode`);
  }
  assert.ok(calendar.get('UID'), 'the attachment has a calendar identity');
  return calendar;
}

test('MAINT-005 MAINT-007 NOTIFY-005 — request mail sends once, direct providers attach calendars, and Managed remains without attachments', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lamp-maintenance-mail-'));
  let runtime;
  try {
    const built = await build({ entryPoints: ['tests/e2e/maintenance-request-mail.worker.ts'], bundle: true,
      format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
      define: { 'import.meta.env.DEV': 'false' }, plugins: [{ name: 'renderer-assets', setup(builder) {
        builder.onResolve({ filter: /\?(inline|raw)$/ }, args => ({ path: resolve(args.resolveDir, args.path.split('?')[0]), namespace: 'asset' }));
        builder.onLoad({ filter: /.*/, namespace: 'asset' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`, loader: 'js' }));
      } }],
    });
    for (const provider of ['sendgrid', 'resend', 'rer']) {
      const messages = [];
      runtime = new Miniflare(convertV4MiniflareOptions({ name: 'lamp-maintenance-mail', modules: true,
        script: built.outputFiles[0].text, port: 0, inspectorPort: 0, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
        bindings: { LAMP_PAGE_HOST: 'status.example.test', LAMP_APP_HOST: 'app.example.test',
          SETUP_OPERATOR_EMAIL: 'operator@example.test', SESSION_SECRET: secret,
          SUBSCRIBER_TOKEN_SECRET: 'test-only-subscriber-secret-aaaaaaaaaaaaaaaa', MAIL_PROVIDER: provider,
          ...(provider === 'rer' ? { MAIL_FROM: 'status@example.test', MAIL_RELAY_URL: 'https://relay.example.test/api/managed-mail/send', MAIL_API_KEY: 'test-only-installation-key' }
            : { MAIL_FROM_ADDRESS: 'status@example.test', MAIL_PROVIDER_API_KEY: 'test-only-provider-key' }) },
        d1Databases: ['DB'], r2Buckets: ['SNAPSHOTS'], durableObjects: { SNAPSHOT_CACHE: { className: 'SnapshotCache', useSQLite: true } },
        queueProducers: { JOBS: 'lamp-maintenance-jobs' }, resourcePersistencePath: join(directory, provider),
        outboundService: async request => {
          assert.equal(request.url, { sendgrid: 'https://api.sendgrid.com/v3/mail/send', resend: 'https://api.resend.com/emails', rer: 'https://relay.example.test/api/managed-mail/send' }[provider]);
          assert.equal(request.method, 'POST');
          messages.push(await request.json());
          return new Response(provider === 'rer' ? JSON.stringify({ messageId: `<maintenance-${messages.length}@relay.example.test>` })
            : provider === 'resend' ? JSON.stringify({ id: `test-maintenance-${messages.length}` }) : null,
          { status: provider === 'resend' ? 200 : 202, headers: { 'Content-Type': 'application/json', 'x-message-id': `test-maintenance-${messages.length}` } });
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
      const input = { title: 'Payment provider upgrade', affectedAudience: 'Customers making payments',
        customerImpact: 'Payments may pause briefly while the provider is upgraded.', whatStillWorks: 'Existing receipts remain available.',
        details: 'Préparation continues; check https://help.example.test/payments, then retry.',
        startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(), endsAt: new Date(Date.now() + 49 * 3600_000).toISOString(), componentIds: ['01J00000000000000000000011'] };
      const response = await call('/api/app/maintenance', input);
      assert.equal(response.status, 201, await response.clone().text());
      const { maintenance } = await response.json();
      const settle = async count => {
        for (let i = 0; i < 100; i++) {
          const accepted = await db.prepare('SELECT count(*) AS n FROM notification_delivery_attempts WHERE provider_message_id IS NOT NULL').first();
          if (accepted.n === count) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.fail(`${provider}: expected ${count} provider acceptances; received ${messages.length} sends`);
      };
      await settle(1);
      assert.equal(messages.length, 1, 'the schedule request sends its notice without any Cron run');
      const scheduled = provider === 'rer' ? null : attachedCalendar(messages[0], provider, { ...input, reference: maintenance.reference });
      const startedWindow = { startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString() };
      await db.prepare('UPDATE maintenance SET starts_at=?,ends_at=? WHERE id=?').bind(startedWindow.startsAt, startedWindow.endsAt, maintenance.id).run();
      // Cron has never run: an ordinary visit starts the due window and sends its notice.
      await call('/api/app/maintenance');
      await settle(2);
      if (provider === 'rer') {
        assert.ok(messages.every(message => !Object.hasOwn(message, 'attachments')), 'Managed relay requests carry no unsupported attachment field');
        assert.ok(messages.every(message => message.text.includes(input.customerImpact)), 'Managed still delivers the maintenance wording');
        t.diagnostic('Managed maintenance mail delivers wording; calendar attachments remain unavailable until the relay supports them. Direct Resend and SendGrid requests are checked separately.');
      } else {
        const started = attachedCalendar(messages[1], provider, { ...input, ...startedWindow, reference: maintenance.reference });
        assert.equal(started.get('UID'), scheduled.get('UID'), 'later notices update the same calendar event');
        assert.ok(Number(started.get('SEQUENCE')) > Number(scheduled.get('SEQUENCE')), 'the changed event has a later revision');
      }
      // Cron's first run arrives late and finds nothing left to send.
      await call('/__test/cron');
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.equal(messages.length, 2, 'one scheduled and one started notice, with no second send from Cron');
      const rows = (await (await call('/api/app/deliveries')).json()).deliveries;
      assert.deepEqual(rows.map(row => row.maintenanceNoticeKind).sort(), ['scheduled', 'started']);
      assert.ok(rows.every(row => row.providerAcceptedAt && row.maintenanceReference === maintenance.reference));
      assert.equal((await db.prepare('SELECT count(*) AS n FROM notification_outbox WHERE completed_at IS NULL').first()).n, 0);
      await runtime.dispose(); runtime = undefined;
    }
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
