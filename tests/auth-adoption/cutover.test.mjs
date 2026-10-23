import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { lampRuntime, moveIn, preview, suspendedBody } from './lamp-runtime.mjs';
import { secret } from './runtime.mjs';
import { load } from '../operator-readiness/runtime.mjs';
import { holdConfirmationWrite } from './cutover-race-helper.mjs';
import { exerciseMailPreparation } from './cutover-mail-helper.mjs';

const fixture = family => readdirSync(`tests/fixtures/statuspage/${family}`).map(name => ({ name, text: readFileSync(`tests/fixtures/statuspage/${family}/${name}`, 'utf8') }));
const endpoint = id => `/api/app/statuspage-import/jobs/${id}`;
async function apply(r, files, cookie = r.cookie) {
  const response = await moveIn(r, cookie).apply(await preview(r, cookie, files));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.job.state, 'completed');
  return response.body;
}
const send = (r, id, cookie = r.cookie) => r.call(`${endpoint(id)}/send-invitations`, { method: 'POST', cookie, body: {} });

test("MOVE-012 MOVE-006 MOVE-002 — Owner-approved cutover invitations and preparation failure recovery", async t => {
  t.diagnostic("MOVE-006 — dry runs and saved cutover previews carry truthful destinations and mail waits for the owner across batches and repeats");
  await (async t => {
  const r = await lampRuntime(t);
  t.diagnostic("MOVE-012 — documented private Statuspage pages and unknown visibility are refused before preview or apply writes");
  const publicFiles = fixture('small');
  const privatePage = readFileSync('tests/fixtures/statuspage/private/page.json', 'utf8');
  const withoutVisibility = publicFiles.filter(file => !['page.json', 'page-access-groups.json'].includes(file.name));
  for (const visibility of [
    [],
    [{ name: 'page.json', text: privatePage }, { name: 'page-access-groups.json', text: '[]' }],
    [{ name: 'page.json', text: '{}' }, { name: 'page-access-groups.json', text: '[]' }],
    [{ name: 'page.json', text: JSON.stringify({ id: 'synthpage01', viewers_must_be_team_members: false, ip_restrictions: '192.0.2.0/24' }) }, { name: 'page-access-groups.json', text: '[]' }],
    [{ name: 'page.json', text: JSON.stringify({ id: 'synthpage01', viewers_must_be_team_members: false, ip_restrictions: null }) }, { name: 'page-access-groups.json', text: '[{"id":"team-only"}]' }],
  ]) {
    const files = [...withoutVisibility, ...visibility];
    // Move in's one import path is the owner door: the dry run is refused there.
    const response = await moveIn(r, r.cookie).preview({ files });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.match(response.body.error, /visibility|private|restricted|audience/i);
    // No plan exists to apply, so an apply naming one writes nothing either.
    const direct = await moveIn(r, r.cookie).door('statuspage', 'apply', { planId: 'plan-never-made', reviewedFingerprint: '0'.repeat(64) });
    assert.equal(direct.status, 409, JSON.stringify(direct.body));
    assert.match(direct.body.error, /changed since the dry run/);
    assert.equal((await r.db.prepare('SELECT count(*) n FROM components').first()).n, 0);
    assert.equal((await r.db.prepare('SELECT count(*) n FROM ik_jobs').first()).n, 0);
  }
  const files = fixture('small');
  files.find(file => file.name === 'subscribers.json').text = JSON.stringify(Array.from({length: 57}, (_, i) => ({ id: `subscriber-${i}`, email: `person-${i}@example.test`, mode: 'email', created_at: '2026-01-01T00:00:00Z' })));
  const dry = (await preview(r, r.cookie, files)).report.cutover;
  assert.ok(dry.rows.length > 0);
  assert.ok(dry.rows.every(row => /^\/(incidents\/INC|maintenance\/SCH)-\d+$/.test(row.target)));
  const result = await apply(r, files);
  const id = result.job.id;
  assert.deepEqual(result.report.cutover.rows, dry.rows);
  assert.equal(result.report.cutover.invitations.eligible, 57);
  for (const path of [endpoint(id), '/api/app/statuspage-import/jobs']) assert.equal((await r.call(path, {cookie:r.cookie})).status, 200);
  await moveIn(r, r.cookie).apply(result.door);
  await apply(r, files);
  assert.equal(r.messages.length, 0);
  assert.equal((await r.db.prepare('SELECT count(*) n FROM notification_deliveries').first()).n, 0);
  assert.equal((await send(r, id, '')).status, 401);
  const responses = await Promise.all([send(r, id), send(r, id)]);
  assert.ok(responses.every(response => response.status === 200));
  while ((await (await r.call(endpoint(id), {cookie:r.cookie})).json()).invites.remaining) assert.equal((await send(r, id)).status, 200);
  await send(r, id);
  assert.equal(r.messages.length, 57);
  assert.equal(new Set(r.messages.map(message => message.to)).size, 57);
  assert.equal(new Set(r.messages.map(message => message.idempotencyKey)).size, 57);
  assert.equal((await r.db.prepare('SELECT count(*) n FROM notification_deliveries').first()).n, 0);
  const large = await moveIn(r, r.cookie).preview({ files: fixture('large') });
  // Source overlaps this import, so the door plans it as this import's catch-up:
  // a shared source identity is replaced or unchanged, never created twice.
  assert.equal(large.status, 200, JSON.stringify(large.body));
  assert.ok(large.body.differences.replacements.length + large.body.differences.unchanged.length > 0);
  assert.ok(large.body.differences.additions.every(key => !large.body.differences.replacements.includes(key) && !large.body.differences.unchanged.includes(key)));
})(t);
  t.diagnostic("MOVE-002 — invitation preparation failures remain retryable while ambiguous transport failures stay claimed");
  await (async t => {
  await exerciseMailPreparation(t, r => apply(r, fixture('small')));
  for (const failure of ['origin', 'configuration', 'tokens', 'authority', 'transport']) await t.test(failure, async t => {
    const r = await lampRuntime(t);
    const imported = await apply(r, fixture('small'));
    let broken = true, cookie = r.cookie;
    const mail = { configured: true, async send(message) {
      r.messages.push(message);
      if (broken && failure === 'transport') throw Error('Transport result unknown');
    } };
    const subscriberService = r.modules.createSubscribersService(r.modules.createSubscriberRepository(r.db), {
      mail, tokenSecret: secret,
      async fromAddress() {
        if (broken && failure === 'configuration') return undefined;
        if (broken && failure === 'authority') await r.db.prepare('UPDATE oa_sessions SET revoked_at=1').run();
        return 'lamp@example.test';
      },
    });
    if (failure === 'tokens') await r.db.prepare("CREATE TRIGGER refuse_token_preparation BEFORE INSERT ON subscriber_tokens BEGIN SELECT RAISE(ABORT, 'Token preparation unavailable'); END").run();
    const app = new Hono();
    app.use('/api/app/*', r.modules.requireOperator(() => r.auth));
    r.modules.registerStatuspageImportRoutes(app, r.modules.createStatuspageImportService(r.db, {
      async inviteSubscriber(id, claim) {
        return subscriberService.inviteImported(id, broken && failure === 'origin' ? 'invalid-origin' : 'https://page.example.test', 'Test page', claim);
      },
      async publicDataChanged() {},
    }));
    const attempt = () => app.fetch(r.request(`${endpoint(imported.job.id)}/send-invitations`, {method:'POST', cookie, body:{}}), r.bindings);
    assert.equal((await attempt()).status, 409);
    const claims = (await r.db.prepare('SELECT count(*) n FROM statuspage_import_invites WHERE sent_at IS NOT NULL').first()).n;
    assert.equal(claims, failure === 'transport' ? 1 : 0, `${failure} consumes only a transport handoff`);
    assert.equal(r.messages.length, failure === 'transport' ? 1 : 0);
    broken = false;
    if (failure === 'tokens') await r.db.prepare('DROP TRIGGER refuse_token_preparation').run();
    if (failure === 'authority') cookie = await r.base.signIn();
    assert.ok((await Promise.all([attempt(), attempt()])).every(response => response.status === 200));
    assert.equal((await attempt()).status, 200);
    assert.equal(r.messages.length, 2, `${failure}: each address handed to transport once after repair`);
    assert.equal(new Set(r.messages.map(message => message.to)).size, 2);
  });
})(t);
});



test("MOVE-002 MOVE-006 TEAM-007 — Imported invitation expiry audit, revoked authority and public subscription races", async t => {
  t.diagnostic("MOVE-002 — delayed invitations retain the original expiry and undo rows; expired pending subscribers are not sent mail");
  await (async t => {
  const r = await lampRuntime(t);
  const result = await apply(r, fixture('small'));
  const rows = (await r.db.prepare("SELECT id,created_at,updated_at FROM subscribers ORDER BY id").all()).results;
  const delayed = new Date(Date.now() - 48*60*60*1000).toISOString();
  const expired = new Date(Date.now() - 73*60*60*1000).toISOString();
  // Simulate the persisted native rows at a later date without mocking the clock.
  await r.db.prepare('UPDATE subscribers SET created_at=? WHERE id=?').bind(delayed, rows[0].id).run();
  await r.db.prepare('UPDATE subscribers SET created_at=? WHERE id=?').bind(expired, rows[1].id).run();
  const before = (await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results;
  const journal = (await r.db.prepare('SELECT * FROM ik_provenance ORDER BY ordinal').all()).results;
  const read = (await (await r.call(endpoint(result.job.id), {cookie:r.cookie})).json()).report.cutover;
  assert.equal(read.invitations.eligible, 1); assert.equal(read.invitations.expired, 1);
  assert.equal((await send(r, result.job.id)).status, 200);
  assert.equal((await send(r, result.job.id)).status, 200);
  assert.equal(r.messages.length, 1);
  const deadline = new Date(Date.parse(delayed)+72*60*60*1000).toISOString();
  assert.ok(r.messages[0].text.includes(deadline));
  const token = await r.db.prepare("SELECT expires_at FROM subscriber_tokens WHERE subscriber_id=? AND scope='confirm' AND revoked_at IS NULL").bind(rows[0].id).first();
  assert.equal(token.expires_at, deadline);
  assert.deepEqual((await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results, before);
  assert.deepEqual((await r.db.prepare('SELECT * FROM ik_provenance ORDER BY ordinal').all()).results, journal);
  const service = r.modules.createSubscribersService(r.modules.createSubscriberRepository(r.db), { tokenSecret: secret });
  await service.expirePending(); await service.expirePending();
  const expiredAudit = (await r.db.prepare("SELECT * FROM audit_entries WHERE entity_id=? AND action='expired'").bind(rows[1].id).all()).results;
  assert.equal(expiredAudit.length, 1, 'imported pending expiry records exactly one audit event');
  assert.equal(expiredAudit[0].operator_id, null, 'the scheduler is the System actor');
  assert.equal(expiredAudit[0].payload_json, '{}', 'expiry retains no address');
  const sorryFiles = readdirSync('tests/fixtures/sorry/authenticated').map(name => ({ name, text: readFileSync(`tests/fixtures/sorry/authenticated/${name}`, 'utf8') }));
  const sorry = await moveIn(r, r.cookie).apply(await moveIn(r, r.cookie).preview({ source: 'sorry', publicAccessAcknowledged: true, files: sorryFiles }));
  assert.equal(sorry.status, 200, JSON.stringify(sorry.body));
  const held = (await r.db.prepare("SELECT id FROM subscribers WHERE deactivation_reason='held for Sorry cutover'").all()).results;
  assert.ok(held.length, 'real Sorry import supplies held subscribers');
  const { expireHeldSorrySubscribers } = await load('src/core/features/statuspage-import/sorry-release.repository.ts');
  const future = Date.now() + 91 * 86400000;
  await expireHeldSorrySubscribers(r.db, future); await expireHeldSorrySubscribers(r.db, future);
  for (const row of held) {
    const audit = (await r.db.prepare("SELECT * FROM audit_entries WHERE entity_id=? AND action='expired'").bind(row.id).all()).results;
    assert.equal(audit.length, 1, 'held Sorry expiry records exactly one System audit event');
    assert.equal(audit[0].operator_id, null); assert.equal(audit[0].payload_json, '{}');
  }
})(t);
  t.diagnostic("MOVE-006 — owner revocation before an invitation action sends nothing; saved large previews cap rows without losing the count");
  await (async t => {
  const r = await lampRuntime(t);
  const cookie = await r.providerSession(r.owner.id);
  const result = await apply(r, fixture('small'), cookie);
  const pending = await suspendedBody(r, `${endpoint(result.job.id)}/send-invitations`, cookie, {});
  try { await r.db.prepare("UPDATE oa_identity_providers SET status='unlinked'").run(); }
  finally { pending.release(); }
  assert.equal((await pending.response).status, 409);
  assert.equal(r.messages.length, 0);
  assert.equal((await r.db.prepare('SELECT count(*) n FROM statuspage_import_invites').first()).n, 0);
  const other = await lampRuntime(t);
  const cutover = (await preview(other, other.cookie, fixture('large'))).report.cutover;
  assert.ok(cutover.rows.length <= 25); assert.ok(cutover.total > cutover.rows.length);
  assert.ok(cutover.rows.every(row => row.address && row.path && row.target));
})(t);
  t.diagnostic("MOVE-002 — public subscriptions racing owner invitations cannot extend either imported confirmation deadline");
  await (async t => {
  const r = await lampRuntime(t);
  const result = await apply(r, fixture('small'));
  const rows = (await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results;
  const deadline = new Date(Date.now() + 15_000).toISOString();
  const createdAt = new Date(Date.parse(deadline) - 72*60*60*1000).toISOString();
  await r.db.prepare('UPDATE subscribers SET created_at=?').bind(createdAt).run();
  const before = (await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results;
  const journal = (await r.db.prepare('SELECT * FROM ik_provenance ORDER BY ordinal').all()).results;
  const gate = holdConfirmationWrite(r.db, rows[0].id);
  const options = { tokenSecret: secret, fromAddress: 'lamp@example.test', mail: { configured: true, async send(message) { r.messages.push(message); } } };
  const publicApp = new Hono(), ownerApp = new Hono();
  const publicService = r.modules.createSubscribersService(r.modules.createSubscriberRepository(r.db), options);
  const invitationService = r.modules.createSubscribersService(r.modules.createSubscriberRepository(gate.binding), options);
  r.modules.registerSubscriberRoutes(publicApp, publicService);
  ownerApp.use('/api/app/*', r.modules.requireOperator(() => r.auth));
  r.modules.registerStatuspageImportRoutes(ownerApp, r.modules.createStatuspageImportService(r.db, {
    inviteSubscriber: (id, authority) => invitationService.inviteImported(id, 'https://page.example.test', 'Test page', authority),
    async publicDataChanged() {},
  }));
  const subscribe = email => publicApp.request('https://page.example.test/subscribe', { method: 'POST', body: new URLSearchParams({ email }) });
  // One public request commits before the owner's action. The other runs while
  // that action is held at its first real confirmation-token write.
  assert.equal((await subscribe(rows[1].destination)).status, 202);
  const sending = ownerApp.fetch(r.request(`${endpoint(result.job.id)}/send-invitations`, { method:'POST', cookie:r.cookie, body:{} }), r.bindings);
  try {
    await gate.wait();
    assert.equal((await subscribe(rows[0].destination)).status, 202);
  } finally { gate.release(); }
  assert.equal((await sending).status, 200);
  const invitations = r.messages.filter(message => message.idempotencyKey?.startsWith('subscriber-import-invite/'));
  assert.equal(invitations.length, 2);
  const expiries = [];
  for (const row of rows) {
    const tokens = (await r.db.prepare("SELECT expires_at FROM subscriber_tokens WHERE subscriber_id=? AND scope='confirm' AND revoked_at IS NULL").bind(row.id).all()).results;
    expiries.push(tokens);
    assert.ok(invitations.find(message => message.to === row.destination).text.includes(deadline));
  }
  assert.deepEqual((await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results, before);
  assert.deepEqual((await r.db.prepare('SELECT * FROM ik_provenance ORDER BY ordinal').all()).results, journal);
  assert.equal((await send(r, result.job.id)).status, 200);
  assert.equal(r.messages.length, 4, 'each public request and one claimed invitation per address sends once');
  assert.ok(Date.now() < Date.parse(deadline), 'the racing requests completed before expiry');
  await new Promise(resolve => setTimeout(resolve, Date.parse(deadline) - Date.now() + 100));
  for (const invitation of invitations) {
    const link = invitation.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/u)[0];
    assert.equal((await publicApp.request(link)).status, 404, 'the raced invitation cannot activate after its displayed deadline');
  }
  assert.deepEqual(expiries, rows.map(() => [{ expires_at: deadline }]));
  assert.deepEqual((await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results, before);
  // A separate, explicit opt-in after opting out still gets a fresh window,
  // independent of its old import window.
  const unsubscribe = invitations[0].text.match(/https?:\/\/\S+\/unsubscribe\/\S+/u)[0];
  assert.equal((await publicApp.request(unsubscribe, { method:'POST', body:new URLSearchParams({ 'List-Unsubscribe':'One-Click' }) })).status, 200);
  await r.db.prepare("UPDATE subscriber_confirmation_attempts SET last_sent_at='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await subscribe(invitations[0].to)).status, 202);
  const fresh = r.messages.at(-1).text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/u)[0];
  const renewed = await r.db.prepare('SELECT id,created_at FROM subscribers WHERE destination=?').bind(invitations[0].to).first();
  await publicService.expirePending();
  assert.equal((await publicApp.request(fresh)).status, 200, 'cleanup after the original deadline preserves the renewed confirmation');
  const rejoined = await r.db.prepare('SELECT state,created_at FROM subscribers WHERE destination=?').bind(invitations[0].to).first();
  assert.deepEqual(rejoined, { state:'active', created_at:renewed.created_at });
  assert.equal((await publicApp.request(unsubscribe, {method:'POST', body:new URLSearchParams({'List-Unsubscribe':'One-Click'})})).status, 404, 'previous unsubscribe authority stays revoked');
  const currentUnsubscribe = r.messages.at(-1).text.match(/https?:\/\/\S+\/unsubscribe\/\S+/u)[0];
  assert.equal((await publicApp.request(currentUnsubscribe, {method:'POST', body:new URLSearchParams({'List-Unsubscribe':'One-Click'})})).status, 200);
  const beforeRejoin = r.messages.length;
  assert.equal((await subscribe(invitations[0].to)).status, 202);
  assert.equal(r.messages.length, beforeRejoin + 1, 'the address\'s own unsubscribe restores its allowance, so a rejoin gets a fresh confirmation (SUB-001)');
  assert.match(r.messages.at(-1).text, /confirm-subscription/);
  assert.equal((await subscribe(invitations[0].to)).status, 202);
  assert.equal(r.messages.length, beforeRejoin + 1, 'a repeated rejoin within 24 hours keeps the anti-bomb bound');
  await r.db.prepare("UPDATE subscriber_confirmation_attempts SET last_sent_at='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await subscribe(invitations[0].to)).status, 202);
  const finalPending = await r.db.prepare('SELECT created_at FROM subscribers WHERE id=?').bind(renewed.id).first();
  // The cleanup repository takes a 72-hour cutoff; advance that cutoff just
  // beyond the renewed deadline without changing the process or D1 clock.
  await r.modules.createSubscriberRepository(r.db).deleteExpiredPending(new Date(Date.parse(finalPending.created_at)+1).toISOString(), 3);
  assert.equal(await r.db.prepare('SELECT id FROM subscribers WHERE id=?').bind(renewed.id).first(), null, 'cleanup after the renewed deadline removes the unconfirmed address');
})(t);
});
