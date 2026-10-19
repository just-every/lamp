import assert from 'node:assert/strict';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { unstable_splitSqlQuery } from 'wrangler';
import { legacyApiFixtureSql } from '../fixtures/legacy-api-fixture.mjs';
import { withDraftVersion } from '../draft-version-helper.mjs';

const branding = { displayName: 'Acme status', replyTo: 'support@acme.example', subjectPrefix: '[Acme status]', header: 'Service updates from Acme.', footer: 'Acme, 100 Market Street, San Francisco, CA 94105', usePageLogo: true };
const logo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jm4kAAAAASUVORK5CYII=', 'base64');

export async function emailBrandingWorkerFlow({ Miniflare, convertV4MiniflareOptions, script, state }) {
  for (const provider of ['sendgrid', 'resend']) {
    let runtime, reject = false;
    const submissions = [];
    try {
      runtime = new Miniflare(convertV4MiniflareOptions({ name: `lamp-branding-${provider}`, modules: true, script,
        port: 0, inspectorPort: 0, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
        bindings: { LAMP_PAGE_HOST: 'status.example.test', LAMP_APP_HOST: 'app.example.test', AUTH_ORIGIN: 'https://app.example.test',
          SETUP_OPERATOR_EMAIL: 'operator@example.test', SESSION_SECRET: 'test-only-branding-session-secret-aaaaaaaaaaaa',
          SUBSCRIBER_TOKEN_SECRET: 'test-only-branding-subscriber-secret-bbbbbbbbb', MAIL_PROVIDER: provider,
          MAIL_FROM_ADDRESS: 'status@acme.example', MAIL_PROVIDER_API_KEY: 'test-only-mail-provider-credential' },
        d1Databases: ['DB'], r2Buckets: ['SNAPSHOTS'], durableObjects: { SNAPSHOT_CACHE: { className: 'SnapshotCache', useSQLite: true } },
        queueProducers: { JOBS: 'lamp-branding-jobs' }, resourcePersistencePath: join(state, provider),
        outboundService: async request => {
          assert.equal(request.url, provider === 'sendgrid' ? 'https://api.sendgrid.com/v3/mail/send' : 'https://api.resend.com/emails');
          submissions.push(await request.json());
          if (reject) return new Response(null, { status: 429 });
          return new Response(provider === 'resend' ? JSON.stringify({ id: `test-email-${submissions.length}` }) : null, { status: provider === 'sendgrid' ? 202 : 200, headers: { 'x-message-id': `test-email-${submissions.length}` } });
        },
      }));
      const db = await runtime.getD1Database('DB');
      const execute = sql => db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));
      for (const name of (await readdir('migrations/core')).filter(n => n.endsWith('.sql')).sort()) await execute(await readFile(join('migrations/core', name), 'utf8'));
      await execute(legacyApiFixtureSql());
      await execute("DELETE FROM notification_delivery_attempts; DELETE FROM notification_deliveries; DELETE FROM notification_outbox; DELETE FROM subscribers WHERE channel='webhook'; UPDATE page_settings SET mail_from_address='status@acme.example';");
      await db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('01J00000000000000000000001','operator@example.test','Atlas operator','owner','active',?)").bind(Date.now()).run();
      let cookie;
      const call = async (path, init = {}) => {
        init = await withDraftVersion(path, init, call);
        return runtime.dispatchFetch(`https://app.example.test${path}`, { ...init, redirect: 'manual', headers: { Host: 'app.example.test', Origin: 'https://app.example.test', 'CF-Connecting-IP': '192.0.2.1', ...(cookie ? { Cookie: cookie } : {}), ...init.headers } });
      };
      const json = (body, method = 'POST') => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
      assert.equal((await call('/auth/magic-link', json({ email: 'operator@example.test' }))).status, 202);
      const signIn = submissions[0];
      const text = provider === 'sendgrid' ? signIn.content.find(part => part.type === 'text/plain').value : signIn.text;
      const token = new URL(text.match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');
      const confirmed = await call('/auth/confirm', json({ token }));
      assert.equal(confirmed.status, 303);
      cookie = confirmed.headers.get('set-cookie').split(';')[0];
      const saved = (await (await call('/api/app/page-settings')).json()).settings;
      const settings = Object.fromEntries(['pageName','tagline','accentColor','timezone','hostname','footerCreditEnabled','mailFromAddress'].map(key => [key, saved[key]]));
      for (const invalid of [{ ...branding, displayName: 'Acme\r\nBcc: victim@example.test' }, { ...branding, replyTo: 'invalid-address' }, { ...branding, subjectPrefix: 'prefix\r\nBcc: victim@example.test' }, { ...branding, logoUrl: 'https://tracker.example/image' }, { ...branding, unsubscribeUrl: '' }]) {
        assert.equal((await call('/api/app/page-settings', json({ ...settings, emailBranding: invalid }, 'PUT'))).status, 400);
      }
      assert.equal((await call('/api/app/page-settings', json({ ...settings, emailBranding: branding }, 'PUT'))).status, 200);
      const form = new FormData(); form.set('logo', new Blob([logo], { type: 'image/png' }), 'acme.png');
      const uploadRequest = new Request('https://app.example.test/api/app/page-settings/logo', { method: 'POST', body: form });
      const upload = await call('/api/app/page-settings/logo', { method: 'POST', body: await uploadRequest.arrayBuffer(), headers: { 'Content-Type': uploadRequest.headers.get('content-type') } });
      assert.equal(upload.status, 200, await upload.clone().text());
      const incidentResponse = await call('/api/app/incidents', json({ title: 'Checkout authorization failures', components: [{ componentId: '01J00000000000000000000011', state: 'Major outage', relationship: 'Primary' }] }));
      assert.equal(incidentResponse.status, 201);
      const incident = (await incidentResponse.json()).incident;
      const draft = { lifecycle: 'Investigating', affectedAudience: 'Customers making card payments.', customerImpact: 'Some checkouts are failing.', whatStillWorks: 'Existing subscriptions continue.', details: '', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() };
      assert.equal((await call(`/api/app/incidents/${incident.id}/draft`, json(draft, 'PUT'))).status, 200);
      const preview = (await (await call(`/api/app/incidents/${incident.id}/draft/preview`, json(draft))).json()).preview.email;
      assert.equal(preview.from, '"Acme status" <status@acme.example>');
      assert.equal(preview.replyTo, branding.replyTo);
      assert.equal(preview.logoUrl, 'https://status.example.test/assets/logo');
      assert.ok(preview.subject.startsWith(branding.subjectPrefix));
      reject = true;
      const publication = await call(`/api/app/incidents/${incident.id}/publish`, json({ channels: ['email'] }));
      assert.equal(publication.status, 200, await publication.clone().text());
      assert.equal((await call('/__test/tick')).status, 204);
      const frozen = await db.prepare('SELECT mail_payload_json FROM notification_deliveries WHERE incident_update_id IS NOT NULL AND mail_payload_json IS NOT NULL ORDER BY created_at DESC LIMIT 1').first();
      const envelope = JSON.parse(frozen.mail_payload_json);
      assert.equal(envelope.from, preview.from);
      assert.equal(envelope.replyTo, preview.replyTo);
      assert.equal(envelope.subject, preview.subject);
      assert.ok(envelope.text.includes(branding.header) && envelope.text.includes(branding.footer));
      assert.ok(envelope.html.includes('src="https://status.example.test/assets/logo" alt="Atlas Cloud Status"'));
      assert.ok(!envelope.text.includes('/assets/logo'));
      assert.match(envelope.text, /Manage this subscription: https:\/\/status\.example\.test\/manage\//);
      assert.match(envelope.text, /Unsubscribe: https:\/\/status\.example\.test\/unsubscribe\//);
      assert.equal(envelope.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      for (const name of ['List-Id','List-Archive','List-Help']) assert.ok(envelope.headers[name]);
      // Edits after the first submission must never change a frozen retry.
      assert.equal((await call('/api/app/page-settings', json({ ...settings, emailBranding: { ...branding, subjectPrefix: '[Changed]', footer: 'Changed later' } }, 'PUT'))).status, 200);
      reject = false;
      await db.prepare("UPDATE notification_outbox SET available_at='2000-01-01T00:00:00Z'").run();
      assert.equal((await call('/__test/tick')).status, 204);
      const sent = submissions.at(-1);
      const actual = provider === 'sendgrid' ? { from: sent.from, replyTo: sent.reply_to, subject: sent.subject, html: sent.content.find(part => part.type === 'text/html').value } : { from: sent.from, replyTo: sent.reply_to, subject: sent.subject, html: sent.html };
      assert.deepEqual(actual.from, provider === 'sendgrid' ? { name: 'Acme status', email: 'status@acme.example' } : preview.from);
      assert.deepEqual(actual.replyTo, provider === 'sendgrid' ? { email: branding.replyTo } : branding.replyTo);
      assert.equal(actual.subject, preview.subject);
      assert.ok(actual.html.includes(branding.footer) && !actual.html.includes('Changed later'));
      // Host-side page data carries the same settings through the native export.
      const exported = await call('/api/app/page-data');
      assert.equal(exported.status, 200);
      assert.equal((await exported.json()).page.emailBranding.subjectPrefix, '[Changed]');
    } finally { await runtime?.dispose(); await rm(join(state, provider), { recursive: true, force: true }); }
  }
}
