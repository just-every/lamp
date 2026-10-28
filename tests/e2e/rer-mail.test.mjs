import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHmac } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unstable_splitSqlQuery } from 'wrangler';
import { withDraftVersion } from './draft-version-helper.mjs';

const require = createRequire(import.meta.url), workerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = workerRequire('miniflare');
const { build } = workerRequire('esbuild');
const appOrigin = 'https://app.example.test', pageOrigin = 'https://status.example.test';
const receiptKey = Buffer.from('synthetic-lamp-provider-receipt-secret');
const owner = 'owner@example.test', reader = 'reader@example.test', pending = 'pending@example.test';

// Each row is the same business journey through a supported transport. Only
// provider responses are synthetic; app routes, migrations and Cron are real.
test('BASE-ACCESS-001 BASE-ACCESS-002 SUB-001 SUB-002 SUB-003 SUB-005 SUB-006 SUB-008 NOTIFY-001 NOTIFY-002 NOTIFY-003 NOTIFY-004 NOTIFY-005 NOTIFY-006 NOTIFY-007 NOTIFY-008 NOTIFY-009 NOTIFY-010 NOTIFY-019 MAINT-005 MAINT-009 UPDATE-008 — Sign in, confirm a reader, publish, recover frozen mail, inspect receipts, notify maintenance and opt out', { timeout: 300_000 }, async () => {
  const built = await build({ entryPoints: ['tests/e2e/rer-mail.worker.ts'], bundle: true, format: 'esm', platform: 'browser', write: false,
    external: ['cloudflare:workers', 'node:*'], define: { 'import.meta.env.DEV': 'false' },
    plugins: [{ name: 'renderer-assets', setup(builder) {
      builder.onResolve({ filter: /\?(inline|raw)$/ }, args => ({ path: resolve(args.resolveDir, args.path.split('?')[0]), namespace: 'asset' }));
      builder.onLoad({ filter: /.*/, namespace: 'asset' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`, loader: 'js' }));
    } }],
  });
  for (const provider of ['rer', 'resend', 'sendgrid']) {
    const state = await mkdtemp(join(tmpdir(), `lamp-mail-${provider}-`));
    const submissions = [];
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    let runtime, cookie, responseStatus = 202;
    const wire = body => provider === 'sendgrid' ? {
      to: body.personalizations[0].to[0].email,
      text: body.content.find(part => part.type === 'text/plain')?.value,
      html: body.content.find(part => part.type === 'text/html')?.value,
      subject: body.subject, headers: body.headers,
    } : body;
    try {
      runtime = new Miniflare(convertV4MiniflareOptions({ name: `lamp-mail-${provider}`, modules: true, script: built.outputFiles[0].text,
        port: 0, inspectorPort: 0, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
        bindings: { LAMP_PAGE_HOST: 'status.example.test', LAMP_APP_HOST: 'app.example.test', AUTH_ORIGIN: appOrigin,
          SETUP_OPERATOR_EMAIL: owner, SESSION_SECRET: 'synthetic-lamp-session-secret-aaaaaaaaaaaa',
          SUBSCRIBER_TOKEN_SECRET: 'synthetic-lamp-subscriber-secret-bbbbbbbb', MAIL_PROVIDER: provider,
          MAIL_FROM_ADDRESS: 'status@example.test', MAIL_FROM: 'status@example.test',
          MAIL_PROVIDER_API_KEY: 'synthetic-lamp-provider-key', MAIL_API_KEY: 'synthetic-lamp-managed-key', MAIL_RELAY_URL: 'https://relay.example.test/api/managed-mail/send',
          RESEND_WEBHOOK_SECRET: `whsec_${receiptKey.toString('base64url')}`,
          SENDGRID_WEBHOOK_PUBLIC_KEY: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') },
        d1Databases: ['DB'], r2Buckets: ['SNAPSHOTS'], durableObjects: { SNAPSHOT_CACHE: { className: 'SnapshotCache', useSQLite: true } },
        queueProducers: { JOBS: 'lamp-mail-jobs' }, resourcePersistencePath: join(state, 'storage'),
        outboundService: async request => {
          const expected = provider === 'rer' ? 'https://relay.example.test/api/managed-mail/send' : provider === 'resend' ? 'https://api.resend.com/emails' : 'https://api.sendgrid.com/v3/mail/send';
          assert.equal(request.url, expected, 'mail submission stays at the configured provider');
          const body = await request.json();
          submissions.push({ body, id: `provider-${submissions.length + 1}` });
          if (responseStatus !== 202) return new Response(null, { status: responseStatus, headers: { 'Retry-After': '1', Location: 'https://elsewhere.example.test/' } });
          const id = submissions.at(-1).id;
          return provider === 'rer' ? Response.json({ messageId: `<${id}@relay.example.test>` }, { status: 202 })
            : provider === 'resend' ? Response.json({ id }) : new Response(null, { status: 202, headers: { 'x-message-id': id } });
        },
      }));
      const db = await runtime.getD1Database('DB');
      const execute = sql => db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));
      for (const name of (await readdir('migrations/core')).filter(n => n.endsWith('.sql')).sort()) await execute(await readFile(join('migrations/core', name), 'utf8'));
      await execute(`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('01J00000000000000000000001','${owner}','Owner','owner','active',${Date.now()});
        INSERT INTO oa_bootstrap(singleton,claim_id,claimed_at) VALUES(1,'01J00000000000000000000001',${Date.now()});
        INSERT INTO page_settings(id,page_name,tagline,accent_color,timezone,hostname,feed_id,mail_from_address,created_at,updated_at) VALUES('default','Lamp mail journey','Updates','#16794C','UTC','status.example.test','mail-journey','status@example.test','2026-10-01','2026-10-01');
        INSERT INTO setup_readiness(step,evidence_key,checked_at) VALUES('first-run','complete','2026-10-01');`);
      const raw = (path, init = {}) => runtime.dispatchFetch(new URL(path, appOrigin).href, { redirect: 'manual', ...init, headers: { Host: new URL(path, appOrigin).host, ...init.headers } });
      const call = async (path, body, method = body ? 'POST' : 'GET') => {
        const init = await withDraftVersion(path, { method, ...(body ? { body: JSON.stringify(body) } : {}), headers: { Origin: appOrigin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } }, read => raw(read, { headers: { Cookie: cookie ?? '' } }));
        return raw(path, init);
      };
      const tick = async (expected = 204) => { assert.equal((await call('/__test/tick')).status, expected, `${provider}: scheduled work result`); };
      const deliveries = async () => (await (await call('/api/app/deliveries')).json()).deliveries;
      const sentTo = email => submissions.filter(row => {
        const to = provider === 'sendgrid' ? row.body.personalizations[0].to.map(person => person.email) : row.body.to;
        return Array.isArray(to) ? to.includes(email) : to === email;
      });
      const textFor = email => sentTo(email).map(row => wire(row.body).text).join('\n');
      const subscribe = email => raw(pageOrigin + '/subscribe', { method: 'POST', headers: { Origin: pageOrigin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email }).toString() });
      const result = await call('/auth/magic-link', { email: owner });
      assert.equal(result.status, 202, await result.clone().text());
      assert.equal((await call('/auth/magic-link', { email: 'unknown@example.test' })).status, 202);
      assert.equal(sentTo('unknown@example.test').length, 0);
      const token = new URL(textFor(owner).match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');
      const preview = await call('/auth/confirm?token=' + token);
      assert.equal(preview.status, 200); assert.equal(preview.headers.has('set-cookie'), false);
      const confirmed = await call('/auth/confirm', { token });
      assert.equal(confirmed.status, 303); cookie = confirmed.headers.get('set-cookie').split(';')[0];
      assert.equal((await call('/auth/confirm', { token })).status, 400);
      const created = await call('/api/app/components', { groupId: null, name: 'Payments', description: '', internal: false, displayOrder: 0, note: '' });
      assert.equal(created.status, 201); const component = (await created.json()).component;
      assert.equal((await subscribe(reader)).status, 202);
      assert.equal((await subscribe(pending)).status, 202);
      const confirmUrl = textFor(reader).match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
      assert.equal((await raw(confirmUrl)).status, 200);
      const initialSettings = (await (await call('/api/app/page-settings')).json()).settings;
      const settingsInput = Object.fromEntries(['pageName','tagline','accentColor','timezone','hostname','footerCreditEnabled','mailFromAddress'].map(key => [key, initialSettings[key]]));
      const branding = { subjectPrefix: '[Operations]', header: 'Service updates from Operations', footer: 'Contact our support desk for help', ...(provider === 'rer' ? {} : { displayName: 'Operations status', replyTo: 'support@example.test' }) };
      if (provider === 'rer') {
        assert.equal(initialSettings.mailIdentityEditable, false);
        assert.equal((await call('/api/app/page-settings', { ...settingsInput, emailBranding: { displayName: 'Unsupported identity' } }, 'PUT')).status, 400);
        assert.equal((await call('/api/app/page-settings', { ...settingsInput, emailBranding: { replyTo: 'support@example.test' } }, 'PUT')).status, 400);
      }
      assert.equal((await call('/api/app/page-settings', { ...settingsInput, emailBranding: branding }, 'PUT')).status, 200);
      const incidentResponse = await call('/api/app/incidents', { title: 'Payment delays', components: [{ componentId: component.id, state: 'Partially unavailable', relationship: 'Primary' }] });
      assert.equal(incidentResponse.status, 201); const incident = (await incidentResponse.json()).incident;
      const publish = async impact => {
        const saved = await call(`/api/app/incidents/${incident.id}/draft`, { lifecycle: 'Monitoring', affectedAudience: 'Payment customers', customerImpact: impact, whatStillWorks: 'Balances remain readable.', details: 'Operators are restoring capacity.', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() }, 'PUT');
        assert.equal(saved.status, 200, await saved.clone().text());
        const response = await call(`/api/app/incidents/${incident.id}/publish`, { channels: ['email'] });
        assert.equal(response.status, 200, await response.clone().text());
        return (await response.json()).update;
      };
      responseStatus = 429;
      const update = await publish('Payment processing is delayed.');
      await tick();
      assert.equal(sentTo(pending).length, 1, 'unconfirmed readers receive only confirmation');
      const queued = (await deliveries()).find(row => row.incidentUpdateId === update.id);
      assert.equal(queued.outcome, 'queued'); assert.equal(queued.providerAcceptedAt, null);
      const firstAttempt = sentTo(reader).at(-1).body;
      const settings = (await (await call('/api/app/page-settings')).json()).settings;
      const edited = await call('/api/app/page-settings', { ...Object.fromEntries(['pageName','tagline','accentColor','timezone','hostname','footerCreditEnabled','mailFromAddress'].map(key => [key, settings[key]])), emailBranding: { subjectPrefix: '[Changed after submission]', footer: 'Changed after submission' } }, 'PUT');
      assert.equal(edited.status, 200, await edited.clone().text());
      responseStatus = 202;
      // Advance the fixture's queued clock; the ordinary Cron entry performs the retry.
      await db.prepare("UPDATE notification_outbox SET available_at='2000-01-01T00:00:00Z' WHERE completed_at IS NULL").run();
      await tick();
      const accepted = (await deliveries()).find(row => row.id === queued.id);
      assert.ok(accepted.providerAcceptedAt); assert.equal(accepted.outcome, 'queued', 'provider acceptance does not claim inbox delivery');
      assert.deepEqual(sentTo(reader).at(-1).body, firstAttempt, 'retry preserves the entire submitted envelope after settings change');
      const notification = wire(firstAttempt);
      assert.ok(notification.subject.startsWith(branding.subjectPrefix));
      assert.ok(typeof notification.html === 'string' && notification.html.includes(branding.footer), 'subscriber mail retains its complete branded HTML part');
      assert.ok(notification.text.includes(branding.header) && notification.text.includes(branding.footer));
      if (provider === 'sendgrid') {
        assert.equal(firstAttempt.from.name, branding.displayName); assert.equal(firstAttempt.reply_to.email, branding.replyTo);
      } else if (provider === 'resend') {
        assert.ok(firstAttempt.from.includes(branding.displayName)); assert.equal(firstAttempt.reply_to, branding.replyTo);
      }
      if (provider === 'rer') {
        assert.ok(notification.listUnsubscribePost); assert.ok(notification.listId && notification.listArchive && notification.listHelp);
      } else {
        assert.equal(notification.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
        assert.ok(notification.headers['List-Id'] && notification.headers['List-Archive'] && notification.headers['List-Help']);
        if (provider === 'sendgrid') for (const settings of Object.values(firstAttempt.tracking_settings)) assert.equal(settings.enable, false, 'transport disables recipient tracking');
      }
      const beforeReplay = submissions.length; await tick(); assert.equal(submissions.length, beforeReplay, 'Cron replay cannot resend an accepted envelope');
      if (provider !== 'rer') {
        const receipt = provider === 'resend' ? { type: 'email.delivered', data: { email_id: sentTo(reader).at(-1).id } }
          : [{ event: 'delivered', sg_event_id: 'receipt-delivered', lamp_message_id: firstAttempt.custom_args.lamp_message_id }];
        const body = JSON.stringify(receipt), timestamp = String(Math.floor(Date.now() / 1000));
        const headers = provider === 'resend' ? { 'svix-id': 'receipt-delivered', 'svix-timestamp': timestamp, 'svix-signature': 'v1,' + createHmac('sha256', receiptKey).update(`receipt-delivered.${timestamp}.${body}`).digest('base64url') }
          : { 'x-twilio-email-event-webhook-timestamp': timestamp, 'x-twilio-email-event-webhook-signature': sign('sha256', Buffer.from(timestamp + body), keys.privateKey).toString('base64') };
        const receiptCall = value => raw(pageOrigin + '/api/intake/mail-events', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: value });
        assert.equal((await receiptCall(body + ' ')).status, 401);
        assert.equal((await receiptCall(body)).status, 200);
        assert.equal((await receiptCall(body)).status, 200);
        assert.equal((await deliveries()).find(row => row.id === queued.id).outcome, 'delivered');
      }
      const prior = sentTo(reader).at(-1);
      await publish('Payment processing has improved.'); await tick();
      const threaded = wire(sentTo(reader).at(-1).body);
      const firstMessageId = provider === 'rer' ? `<${prior.id}@relay.example.test>` : notification.headers['Message-ID'];
      assert.equal(provider === 'rer' ? threaded.inReplyTo : threaded.headers['In-Reply-To'], firstMessageId);
      assert.equal(provider === 'rer' ? threaded.references : threaded.headers.References, firstMessageId);
      const maintenanceResponse = await call('/api/app/maintenance', { title: 'Payment service upgrade', affectedAudience: 'Payment customers', customerImpact: 'Authorizations may pause.', startsAt: new Date(Date.now() + 7200000).toISOString(), endsAt: new Date(Date.now() + 10800000).toISOString(), componentIds: [component.id], autoStart: false, autoComplete: false });
      assert.equal(maintenanceResponse.status, 201, await maintenanceResponse.clone().text());
      const maintenance = (await maintenanceResponse.json()).maintenance;
      await tick();
      const start = await call(`/api/app/maintenance/${maintenance.id}/start`, {}); assert.equal(start.status, 200); await tick();
      const maintenanceRows = (await deliveries()).filter(row => row.maintenanceReference === maintenance.reference);
      assert.deepEqual(maintenanceRows.map(row => row.maintenanceNoticeKind).sort(), ['reminder', 'scheduled', 'started']);
      assert.ok(maintenanceRows.every(row => row.providerAcceptedAt));
      for (const row of sentTo(reader).slice(-2)) {
        const notice = wire(row.body);
        assert.ok(notice.text.includes('Payment customers') && notice.text.includes('Authorizations may pause.'));
        assert.ok(typeof notice.html === 'string' && notice.html.includes('Payment customers') && notice.html.includes('Authorizations may pause.'), 'maintenance wording reaches both mail parts');
      }
      const csv = await call('/api/app/deliveries.csv'); assert.equal(csv.status, 200); assert.ok((await csv.text()).includes(reader));
      const unsubscribe = (provider === 'rer' ? notification.listUnsubscribe : notification.headers['List-Unsubscribe']).match(/<(https:\/\/[^>]+)>/)[1];
      assert.equal((await raw(unsubscribe)).status, 200, 'GET only previews unsubscribe');
      assert.equal((await raw(unsubscribe, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' })).status, 200);
      const sendsBefore = sentTo(reader).length; await publish('Payment processing is recovered.'); await tick();
      assert.equal(sentTo(reader).length, sendsBefore, 'opt-out revokes captured recipient authority before later sends');
      const list = (await (await call('/api/app/subscribers')).json()).subscribers;
      const readerRow = list.find(row => row.destination === reader);
      assert.equal(readerRow.state, 'deactivated');
      assert.equal((await call(`/api/app/subscribers/${readerRow.id}`, null, 'DELETE')).status, 204);
      const erased = await call('/api/app/subscribers.csv'); const erasedText = await erased.text();
      assert.ok(!erasedText.includes(reader)); assert.ok(erasedText.includes(pending), 'erasure preserves another reader');
      let expiring = pending;
      if (provider === 'sendgrid') {
        const pendingConfirmation = textFor(pending).match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
        assert.equal((await raw(pendingConfirmation)).status, 200);
        responseStatus = 500;
        const uncertainUpdate = await publish('Provider acknowledgement was interrupted.');
        await tick();
        const failed = (await deliveries()).find(row => row.incidentUpdateId === uncertainUpdate.id);
        assert.equal(failed.outcome, 'failed', 'an ambiguous submission is visible to the operator');
        const uncertain = sentTo(pending).at(-1), submissionCount = sentTo(pending).length;
        await tick(); assert.equal(sentTo(pending).length, submissionCount, 'ambiguous acceptance is never blindly resent');
        const receipt = async (event, id) => {
          const body = JSON.stringify([{ event, sg_event_id: id, lamp_message_id: uncertain.body.custom_args.lamp_message_id, type: 'bounce' }]);
          const timestamp = String(Math.floor(Date.now() / 1000));
          return raw(pageOrigin + '/api/intake/mail-events', { method: 'POST', headers: { 'Content-Type': 'application/json',
            'x-twilio-email-event-webhook-timestamp': timestamp,
            'x-twilio-email-event-webhook-signature': sign('sha256', Buffer.from(timestamp + body), keys.privateKey).toString('base64') }, body });
        };
        assert.equal((await receipt('delivered', 'uncertain-delivered')).status, 200);
        assert.equal((await deliveries()).find(row => row.id === failed.id).outcome, 'delivered', 'a later signed receipt reconciles uncertain submission');
        assert.equal((await receipt('bounce', 'uncertain-bounced')).status, 200);
        const bounced = (await (await call('/api/app/subscribers')).json()).subscribers.find(row => row.destination === pending);
        assert.equal(bounced.state, 'deactivated');
        const beforeSuppressed = sentTo(pending).length; responseStatus = 202;
        await publish('No later send to the bounced reader.'); await tick();
        assert.equal(sentTo(pending).length, beforeSuppressed);
        expiring = 'expiry@example.test'; assert.equal((await subscribe(expiring)).status, 202);
      }
      const remaining = (await (await call('/api/app/subscribers')).json()).subscribers.find(row => row.destination === expiring);
      await db.prepare("UPDATE subscribers SET created_at='2000-01-01T00:00:00Z',updated_at='2000-01-01T00:00:00Z' WHERE id=?").bind(remaining.id).run();
      await tick();
      assert.ok(!(await (await call('/api/app/subscribers')).json()).subscribers.some(row => row.id === remaining.id), 'Cron expires unconfirmed personal data');
    } finally { await runtime?.dispose(); await rm(state, { recursive: true, force: true }); }
  }
});
