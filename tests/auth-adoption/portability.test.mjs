import { preparePortableAlertRules, assertPortableAlertRules } from '../e2e/helpers/automation-portability-flow.mjs';
import { preparePortableIncidentSubscribers, assertPortableIncidentSubscribers } from "../e2e/helpers/incident-subscriber-portability-flow.mjs";
import { preparePortableMetrics, assertPortableMetrics } from "../e2e/helpers/metrics-portability-flow.mjs";
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { fileRecords } from '@runeditrun/rer/internal/modules/portability/files.mjs';
import { authFixture, secret, setupToken } from './runtime.mjs';
import { load } from '../operator-readiness/runtime.mjs';
import { checkout, command, proxy } from '../helpers/native-transfer.mjs';
import { populateArchiveHistory } from '../helpers/archive-history.mjs';
import { fixtureProcessEnv } from '../helpers/worker-environment.mjs';

test('SUB-019 AUTO-001 HIST-004 PORT-001 ACCESS-001 ACCESS-002 INTAKE-009 INTAKE-014 native rer backup restores the whole product without reviving temporary authority', async t => {
  const root = process.cwd(), directory = await mkdtemp(join(tmpdir(), 'lamp-auth-portability-'));
  const source = join(directory, 'source'), target = join(directory, 'target');
  let current;
  try {
    await checkout(root, source); await checkout(root, target);
    // Initialize the source through the edition's ordinary migration command;
    // an extra empty archive is not part of the owner's backup journey.
    const { RER_LOCAL_OPERATION, RER_STATE_DIR, ...environment } = fixtureProcessEnv();
    execFileSync('pnpm', ['run', 'migrate:local'], { cwd: source, env: { ...environment, LAMP_WORKERS_STATE_PATH: join(source, '.wrangler/state') }, stdio: 'pipe' });
    current = await proxy(source);
    const db = current.env.DB, native = authFixture(db);
    await db.prepare("INSERT INTO oc_owner_claims(singleton,jti,installation_id,email,issued_at,expires_at,consumed_at,operator_id,session_id,completed) VALUES(1,'consumed-portable-claim','portable-installation','owner@example.test',1,10,2,'opaque-owner','opaque-session',1)").run();
    const bootstrap = await native.handle(native.request('/auth/bootstrap', { method: 'POST', body: { token: setupToken, displayName: 'Portable owner' } }));
    assert.equal(bootstrap.status, 303);
    const oldCookie = await native.signIn();
    await populateArchiveHistory(current.env);
    const actor = await native.auth.getSession(native.request('/auth/session', { cookie: oldCookie }));
    await db.prepare('UPDATE oc_owner_claims SET operator_id=?,session_id=?').bind(actor.operator.id, actor.id).run();
    await db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES('portable-audit','operator',?,'portable history',?,'{}','2026-10-01','2026-10-01')").bind(actor.operator.id, actor.operator.id).run();
    const pending = await native.auth.invite(native.request('/auth/invite', { method: 'POST', cookie: oldCookie }), { email: 'pending@example.test', displayName: 'Pending', role: 'owner' });
    assert.ok(pending);
    await db.prepare("INSERT INTO rer_dependency_pending(interface,issuer,approved_by,expires_at,approved_session,approved_version,callbacks,attempt_id) VALUES('oidc-provider@1','https://identity.example.test',?,9999999999999,?,1,'[]','pending-attempt')").bind(actor.operator.id, actor.id).run();
    await db.prepare("INSERT INTO rer_dependency_link(interface,issuer,client_id,metadata,needs_relink,linked_at) VALUES('oidc-provider@1','https://identity.example.test','portable-client','{}',0,1)").run();
    const { createSubscriberRepository, createSubscribersService, registerSubscriberRoutes } = await load('tests/auth-adoption/adapter.ts');
    const subscribers = createSubscribersService(createSubscriberRepository(db), { tokenSecret: 'portable-subscriber-secret', mail: { configured: false } });
    // Retain a real signed manage capability through the native archive.
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO subscribers(id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES('portable-reader','email','portable-reader@example.test','portable-reader@example.test','active','all','retained',?,?)").bind(now, now).run();
    const { SubscriberTokenCodec } = await load('src/core/features/subscribers/tokens.ts');
    const codec = new SubscriberTokenCodec('portable-subscriber-secret');
    const manage = await codec.encode({ id: 'portable-token', scope: 'manage' });
    await db.prepare("INSERT INTO subscriber_tokens(id,subscriber_id,scope,token_hash,created_at,updated_at) VALUES('portable-token','portable-reader','manage',?,?,?)").bind(await codec.hash(manage), now, now).run();
    const subscriberApp = new Hono(); registerSubscriberRoutes(subscriberApp, subscribers);
    assert.equal((await subscriberApp.fetch(new Request(native.origin + '/manage/' + manage))).status, 200);
    const { createChatLinksRepository } = await load('src/core/features/chat-desk/links.repository.ts');
    const { createChatLinksService } = await load('src/core/features/chat-desk/links.service.ts');
    const links = createChatLinksService(createChatLinksRepository(db), async () => {});
    await db.prepare('INSERT OR IGNORE INTO operators(id,email,display_name,is_setup_operator,created_at,updated_at) VALUES(?,?,?,1,?,?)').bind(actor.operator.id, 'owner@example.test', 'Owner', now, now).run();
    const linked = await links.mint(actor.operator.id);
    await links.link(linked.code, { transport: 'slack', tenant: 'portable-native-team', subject: 'portable-native-owner' });
    const pendingChat = await links.mint(actor.operator.id);
    await db.prepare("INSERT INTO incidents(id,reference,title,lifecycle,opened_at,created_by_operator_id,created_at,updated_at) VALUES('synthetic-lamp-1','INC-9001','synthetic-lamp-1','Investigating',?,?,?,?)").bind(now,actor.operator.id,now,now).run();
    await db.prepare("INSERT INTO chat_previews(hash,operator_id,incident_id,version,expires_at) VALUES('synthetic-lamp-preview',?,'synthetic-lamp-1','synthetic-lamp-1',?)").bind(actor.operator.id, Date.now()+600000).run();
    await db.prepare("INSERT INTO chat_requests(hash,expires_at) VALUES('synthetic-lamp-request',?)").bind(Date.now()+600000).run();
    // A connected PagerDuty source's sealed REST key is a provider credential: it never travels.
    await db.prepare("INSERT INTO alert_sources(id,name,credential_kind,signing_secret,deduplication_path,title_path,state_path,created_by_operator_id,responder_preset,responder_sealed_credentials,responder_connected,created_at,updated_at) VALUES('portable-pagerduty','Portable PagerDuty','hmac-sha256','portable-signing-secret','event.data.id','event.data.title','event.event_type',?,'pagerduty','portable-sealed-rest-key',1,?,?)").bind(actor.operator.id, now, now).run();
    for (const preset of ['jsm','opsgenie']) await db.prepare("INSERT INTO alert_sources(id,name,credential_kind,bearer_token_hash,deduplication_path,title_path,state_path,created_by_operator_id,vendor_preset,responder_sealed_credentials,responder_connected,close_alert_on_resolve,created_at,updated_at) VALUES(?,?,'bearer-token','synthetic-lamp-token-hash','preset:operations','preset:operations','preset:operations',?,?,?,1,1,?,?)").bind(`synthetic-lamp-${preset}`,`synthetic-lamp-${preset}`,actor.operator.id,preset,`synthetic-lamp-${preset}-sealed-key`,now,now).run();
    const portableIncidentSubscribers=await preparePortableIncidentSubscribers({db,codec,now});
    const portableMetrics=await preparePortableMetrics({env:current.env,native,cookie:oldCookie});
    const portableRules = await preparePortableAlertRules({ env: current.env, native, cookie: oldCookie });
    await current.dispose(); current = null;
    await command(source, 'export', '--output', join(directory, 'installation.rer'));
    for await (const record of fileRecords(join(directory, 'installation.rer'))) {
      if (record.kind !== 'manifest') continue;
      assert.equal(record.tables.find(table => table.name === 'incident_subscriptions')?.count, 2);
      assert.equal(record.tables.find(table => table.name === 'incident_follow_settings')?.count, 1);
      assert.equal(record.tables.find(table => table.name === 'report_notification_deliveries')?.count, 1);
      assert.equal(record.tables.find(table => table.name === 'report_delivery_attempts')?.count, 1);
    }
    for(const value of [portableMetrics.sealed,'synthetic-lamp-99','synthetic-lamp-100',portableMetrics.management.token,portableMetrics.hash]) assert.ok(!(await readFile(join(directory,'installation.rer'))).includes(value),'metric query keys and ciphertext never travel');
    assert.ok(!(await readFile(join(directory, 'installation.rer'))).includes('portable-sealed-rest-key'), 'the archive carries no sealed PagerDuty key');
    for (const preset of ['jsm','opsgenie']) assert.ok(!(await readFile(join(directory, 'installation.rer'))).includes(`synthetic-lamp-${preset}-sealed-key`), `${preset} ciphertext never travels`);
    for await (const record of fileRecords(join(directory, 'installation.rer'))) {
      if (record.kind !== 'manifest') continue;
      assert.equal(record.tables.find(table => table.name === 'alert_rules')?.count, portableRules.rows.length, 'native archives include every owner rule');
      assert.equal(record.tables.find(table => table.name === 'incident_templates')?.count, 1, 'native archives include saved firing and Resolved text with channels');
    }

    const damaged = Buffer.from(await readFile(join(directory, 'installation.rer')));
    damaged[damaged.length - 3] ^= 1;
    const damagedPath = join(directory, 'damaged.rer');
    await writeFile(damagedPath, damaged, { mode: 0o600 });
    await assert.rejects(command(target, 'import', '--input', damagedPath, '--yes'), /failed/i, 'a damaged backup is refused before a valid restore');
    await command(target, 'import', '--input', join(directory, 'installation.rer'), '--yes');
    await command(target, 'export', '--output', join(directory, 'restored.rer'));
    assert.deepEqual(await archivedProduct(join(directory, 'restored.rer')), await archivedProduct(join(directory, 'installation.rer')), 'clean restore and re-export preserve every archived entity and original object byte');
    current = await proxy(target);
    const restored = current.env.DB, fresh = authFixture(restored);
    assert.equal((await fresh.handle(fresh.request('/auth/bootstrap', { method: 'POST', body: { token: setupToken, displayName: 'Replacement' } }))).status, 409);
    assert.equal(await fresh.auth.getSession(fresh.request('/auth/session', { cookie: oldCookie })), null);
    const cookie = await fresh.signIn();
    const session = await fresh.auth.getSession(fresh.request('/auth/session', { cookie }));
    assert.equal(session.operator.id, actor.operator.id);
    assert.equal((await restored.prepare("SELECT operator_id FROM audit_entries WHERE id='portable-audit'").first()).operator_id, actor.operator.id);
    assert.equal((await restored.prepare('SELECT completed FROM oc_owner_claims').first()).completed, 1);
    assert.equal((await restored.prepare('SELECT COUNT(*) n FROM rer_dependency_pending').first()).n, 0);
    const restoredLinks = createChatLinksService(createChatLinksRepository(restored), async () => {});
    assert.equal((await restoredLinks.list(actor.operator.id)).length, 1, 'durable chat links survive restore');
    await assert.rejects(restoredLinks.link(pendingChat.code, { transport: 'slack', tenant: 'portable-native-team', subject: 'portable-native-unlinked' }), /invalid, used or expired/);
    // Advance only this test's clock: the imported archive has no temporary
    // link authority either before or after the original ten-minute lifetime.
    const afterTransfer = Date.parse(pendingChat.expiresAt) + 1;
    const { createApp } = await load('src/core/app/server.ts');
    const signingSecret = 'synthetic-lamp-transfer-signing-1';
    const transferredBindings = { ...current.env, AUTH_ORIGIN: fresh.origin,
      LAMP_APP_HOST: new URL(fresh.origin).host, LAMP_PAGE_HOST: 'status.example.test',
      SESSION_SECRET: secret, SETUP_OPERATOR_EMAIL: session.operator.email, SLACK_SIGNING_SECRET: signingSecret,
      SUBSCRIBER_TOKEN_SECRET: 'portable-subscriber-secret', MAIL_FROM_ADDRESS: 'lamp@example.test' };
    const transferredApp = createApp(transferredBindings);
    t.mock.timers.enable({ apis: ['Date'], now: afterTransfer });
    try {
      const raw = new URLSearchParams({ command: '/lamp', team_id: 'portable-native-team', user_id: 'portable-native-unlinked', text: `link ${pendingChat.code}` }).toString();
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = 'v0=' + createHmac('sha256', signingSecret).update(`v0:${timestamp}:${raw}`).digest('hex');
      const refused = await transferredApp.app.fetch(new Request(fresh.origin + '/api/chat/slack', { method: 'POST', body: raw,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Slack-Request-Timestamp': timestamp, 'X-Slack-Signature': signature } }), transferredBindings);
      assert.equal(refused.status, 409, await refused.clone().text());
      assert.match(await refused.text(), /invalid, used or expired/);
      assert.equal((await restoredLinks.list(actor.operator.id)).length, 1, 'the ten-minute transfer wait preserves only the durable chat identity');
    } finally { t.mock.timers.reset(); }

    assert.equal((await restored.prepare('SELECT needs_relink FROM rer_dependency_link').first()).needs_relink, 1);
    assert.equal((await restored.prepare('SELECT idp_sign_in FROM oa_auth_settings').first()).idp_sign_in, 0);
    assert.deepEqual({ ...await restored.prepare("SELECT responder_sealed_credentials, responder_connected FROM alert_sources WHERE id='portable-pagerduty'").first() }, { responder_sealed_credentials: null, responder_connected: 1 }, 'the restored PagerDuty source asks to reconnect');
    for (const preset of ['jsm','opsgenie']) assert.deepEqual({ ...await restored.prepare('SELECT vendor_preset,responder_sealed_credentials,responder_connected,close_alert_on_resolve FROM alert_sources WHERE id=?').bind(`synthetic-lamp-${preset}`).first() }, { vendor_preset:preset,responder_sealed_credentials:null,responder_connected:1,close_alert_on_resolve:1 }, `${preset} restored connection retains settings and requires reconnect`);
    const sourceListing = await transferredApp.app.fetch(new Request(fresh.origin + '/api/app/intake/sources', { headers: { Cookie: cookie } }), transferredBindings);
    assert.equal(sourceListing.status, 200, await sourceListing.clone().text());
    const restoredSources = (await sourceListing.json()).sources;
    for (const preset of ['jsm','opsgenie']) {
      const source = restoredSources.find(row => row.preset === preset);
      assert.ok(source); assert.equal(source.responderConnection, 'reconnect');
      assert.equal(source.closeAlertOnResolve, true);
      assert.ok(!JSON.stringify(source).includes('sealed-key'));
    }
    await assertPortableMetrics({expected:portableMetrics,app:transferredApp.app,bindings:transferredBindings,origin:fresh.origin,cookie,db:restored});
    await assertPortableAlertRules({ expected: portableRules, app: transferredApp.app, bindings: transferredBindings, origin: fresh.origin, cookie, oldCookie, db: restored });
    const restoredApp = new Hono();
    registerSubscriberRoutes(restoredApp, createSubscribersService(createSubscriberRepository(restored), { tokenSecret: 'portable-subscriber-secret' }));
    assert.equal((await restoredApp.fetch(new Request(fresh.origin + '/manage/' + manage))).status, 200);
    await assertPortableIncidentSubscribers({db:restored,subscriberApp:restoredApp,origin:fresh.origin,expected:portableIncidentSubscribers});
    assert.equal((await restored.prepare("SELECT status FROM oa_operators WHERE email='pending@example.test'").first()).status, 'invited');
    const original = await current.env.SNAPSHOTS.get('branding/original.png');
    assert.ok(original);
    assert.equal(original.httpMetadata.contentType,'image/png');
  } finally { await current?.dispose(); await rm(directory, { recursive: true, force: true }); }
});


async function archivedProduct(path) {
  const items = [];
  let objects;
  for await (const record of fileRecords(path)) {
    if (record.kind === 'manifest') objects = record.objects;
    if (record.kind !== 'part') continue;
    for (const item of record.items) {
      // Session generations are installation-local revocation counters. Their
      // user-facing guarantee is exercised above by refusing the old session.
      const normalized = structuredClone(item);
      if (normalized.kind === 'row' && normalized.table === 'oa_auth_settings') delete normalized.row.generation;
      items.push(normalized);
    }
  }
  return { items, objects };
}
