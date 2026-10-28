import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lampRuntime, linkToken } from './lamp-runtime.mjs';

async function assertErased(r, id) {
  const target = await r.db.prepare('SELECT email,display_name,status FROM oa_operators WHERE id=?').bind(id).first();
  assert.equal(target.status, 'inactive');
  assert.equal(target.email, `deleted-${id.toLowerCase()}@operator.invalid`);
  for (const table of ['oa_external_identities', 'oa_step_up_challenges']) assert.equal((await r.db.prepare(`SELECT count(*) n FROM ${table} WHERE operator_id=?`).bind(id).first()).n, 0);
  for (const table of ['oa_provider_sessions', 'oa_provider_session_pins']) assert.equal((await r.db.prepare(`SELECT count(*) n FROM ${table} WHERE session_id IN (SELECT id FROM oa_sessions WHERE operator_id=?)`).bind(id).first()).n, 0);
  for (const table of ['oa_sessions', 'oa_tokens', 'oa_credentials']) assert.equal((await r.db.prepare(`SELECT count(*) n FROM ${table} WHERE operator_id=? AND revoked_at IS NULL`).bind(id).first()).n, 0);
  const audit = (await r.db.prepare("SELECT * FROM audit_entries WHERE entity_type='operator' AND entity_id=?").bind(id).all()).results;
  assert.ok(audit.some(row => row.action === 'deleted'));
  assert.ok(audit.every(row => row.reason === null && row.payload_json === '{}'));
}

test("Invitation cancellation and complete identity erasure preserve subscriber authority", async t => {
  t.diagnostic("TEAM-007: repeated and competing erasures of a subscriber tombstone record only one successful deletion");
  await (async () => {
    const r = await lampRuntime(t, { registerRoutes: ({ app, db, modules }) => {
      modules.registerSubscriberRoutes(app, modules.createSubscribersService(modules.createSubscriberRepository(db), { tokenSecret: 'synthetic-lamp-erasure' }));
      modules.registerAuditLogRoutes(app, modules.createAuditLogRepository(db));
    } });
    const created = await r.call('/api/app/subscribers/webhook', { method: 'POST', cookie: r.cookie, body: { destination: 'https://hooks.example.test/synthetic-lamp-erasure', contactEmail: 'synthetic-lamp-erasure@example.test', componentIds: [] } });
    assert.equal(created.status, 201);
    const { subscriber } = await created.json();
    for (const response of await Promise.all([1, 2].map(() => r.call(`/api/app/subscribers/${subscriber.id}`, { method: 'DELETE', cookie: r.cookie })))) assert.equal(response.status, 204);
    assert.equal((await r.call(`/api/app/subscribers/${subscriber.id}`, { method: 'DELETE', cookie: r.cookie })).status, 204);
    const path = `/api/app/audit-log?actorId=${r.owner.id}&action=deleted`;
    const entries = (await (await r.call(path, { cookie: r.cookie })).json()).entries.filter(row => row.entityId === subscriber.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actorName, r.owner.displayName);
    const csv = await (await r.call(`${path}&format=csv`, { cookie: r.cookie })).text();
    assert.equal(csv.split(entries[0].id).length - 1, 1);
  })();
  t.diagnostic("pending invitations appear in Settings routes and erasure cancels every invitation without granting authority");
  await (async t => {
  const r = await lampRuntime(t);
  const pending = await r.invite('pending@example.test');
  const reissued = await r.invite('pending@example.test');
  const listed = await r.call('/api/app/operators/invited', { cookie: r.cookie });
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).operators.map(row => row.id), [pending.id]);
  assert.equal((await r.call(`/api/app/operators/${pending.id}`, { method: 'DELETE', cookie: r.cookie })).status, 204);
  for (const token of [pending.token, reissued.token]) assert.equal((await r.base.handle(r.request('/auth/confirm', { method: 'POST', body: { token } }))).status, 400);
  assert.equal((await (await r.call('/api/app/operators/invited', { cookie: r.cookie })).json()).operators.length, 0);
  assert.ok(await r.db.prepare('SELECT 1 FROM oa_invitation_cancellations WHERE operator_id=?').bind(pending.id).first());
  assert.equal((await r.authHandle(r.request('/auth/operator/status', { method: 'POST', cookie: r.cookie, body: { operatorId: pending.id, status: 'active' } }))).status, 403);
  await assertErased(r, pending.id);
  assert.equal((await r.authHandle(r.request('/auth/invite', { method: 'POST', cookie: r.cookie, body: { email: `deleted-${pending.id.toLowerCase()}@operator.invalid`, displayName: 'Restore', role: 'owner' } }))).status, 403);
  const replacement = await r.invite('pending@example.test', true);
  assert.notEqual(replacement.id, pending.id, 'a new explicit invitation creates a new identity');
})(t);
  t.diagnostic("erasure redacts provider identity and revokes actual links, credentials and sessions while preserving subscriber tokens");
  await (async t => {
  const r = await lampRuntime(t);
  const target = await r.invite('erasure@example.test', true);
  const providerCookie = await r.providerSession(target.id);
  assert.equal((await r.call('/api/app/session', { cookie: providerCookie })).status, 200);
  await r.base.auth.requestMagicLink(r.request('/auth/magic-link', { method: 'POST' }), { email: 'erasure@example.test' });
  const outstanding = linkToken(r.base.messages.at(-1));
  await r.base.auth.mintCredential(r.request('/auth/credentials', { method: 'POST', cookie: target.cookie }));
  await r.base.auth.requestStepUp(r.request('/auth/step-up', { method: 'POST', cookie: target.cookie }), { action: 'delete' });
  // Publication provenance is durable product data, but the saved approver's
  // personal name must be anonymized by the same owner erasure transaction.
  const at = new Date().toISOString();
  await r.db.prepare("INSERT INTO incidents(id,reference,title,lifecycle,opened_at,created_by_operator_id,created_at,updated_at) VALUES('erasure-rule-incident','INC-9901','Saved rule incident','Investigating',?,?,?,?)").bind(at,target.id,at,at).run();
  await r.db.prepare("INSERT INTO incident_updates(id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at,automation_attribution,automation_receipt_id) VALUES('erasure-rule-update','erasure-rule-incident','Investigating','API customers','Requests are delayed.','','',?,?,?,?,?,?,?)").bind(at,at,target.id,at,at,`rule API availability, approved by ${target.displayName}`,'erasure-alert-receipt').run();
  const subscriberTokens = (await r.db.prepare('SELECT * FROM subscriber_tokens').all()).results;
  assert.ok((await r.db.prepare('SELECT count(*) n FROM oa_tokens WHERE operator_id=? AND revoked_at IS NULL').bind(target.id).first()).n > 0);
  assert.equal((await r.db.prepare('SELECT count(*) n FROM oa_credentials WHERE operator_id=? AND revoked_at IS NULL').bind(target.id).first()).n, 1);
  assert.equal((await r.call(`/api/app/operators/${target.id}`, { method: 'DELETE', cookie: r.cookie })).status, 204);
  await assertErased(r, target.id);
  const provenance = await r.db.prepare("SELECT automation_attribution,automation_receipt_id,customer_impact FROM incident_updates WHERE id='erasure-rule-update'").first();
  assert.equal(provenance.automation_attribution, 'rule API availability, approved by Erased operator');
  assert.equal(provenance.automation_receipt_id, 'erasure-alert-receipt');
  assert.equal(provenance.customer_impact, 'Requests are delayed.', 'erasure keeps the operator-written publication and causal alert');
  assert.equal((await r.authHandle(r.request('/auth/operator/status', { method: 'POST', cookie: r.cookie, body: { operatorId: target.id, status: 'active' } }))).status, 403, 'fresh activation cannot restore an erased identity');
  assert.equal((await r.base.handle(r.request('/auth/confirm', { method: 'POST', body: { token: outstanding } }))).status, 400);
  for (const cookie of [target.cookie, providerCookie]) assert.equal((await r.call('/api/app/session', { cookie })).status, 401);
  assert.deepEqual((await r.db.prepare('SELECT * FROM subscriber_tokens').all()).results, subscriberTokens);
})(t);
});



test("Concurrent owner erasure preserves a recoverable active identity", async t => {
  t.diagnostic("native and stepped-up provider owners can erase themselves atomically while the remaining owner stays recoverable");
  await (async t => {
  for (const kind of ['native', 'oidc']) {
    const r = await lampRuntime(t, { ownerClaim: true, registerRoutes: ({ app, db, modules }) => modules.registerAuditLogRoutes(app, modules.createAuditLogRepository(db)) });
    const other = await r.invite('recovery@example.test', true);
    const auditPath = `/api/app/audit-log?actorId=${encodeURIComponent(r.owner.id)}&action=invited`;
    const originalAudit = (await (await r.call(auditPath, { cookie: other.cookie })).json()).entries.find(row => row.entityId === other.id);
    assert.equal(originalAudit.actorName, r.owner.displayName);
    const actorCookie = kind === 'oidc' ? await r.providerSession(r.owner.id) : r.cookie;
    if (kind === 'oidc') await r.stepUp(actorCookie);
    const refused = await r.call(`/api/app/operators/${r.owner.id}`, { method: 'DELETE', cookie: other.cookie });
    assert.equal(refused.status, 403, 'another owner cannot erase the setup owner');
    assert.equal((await r.call(`/api/app/operators/${r.owner.id}`, { method: 'DELETE', cookie: actorCookie })).status, 204);
    await assertErased(r, r.owner.id);
    const erasedAudit = await (await r.call(auditPath, { cookie: other.cookie })).json();
    const anonymous = `Erased operator · ${r.owner.id}`;
    assert.equal(erasedAudit.entries.find(row => row.id === originalAudit.id).actorName, anonymous);
    assert.equal(erasedAudit.actors.find(row => row.id === r.owner.id).name, anonymous);
    const csv = await (await r.call(`${auditPath}&format=csv`, { cookie: other.cookie })).text();
    assert.ok(csv.includes(originalAudit.id) && csv.includes(anonymous));
    for (const path of [auditPath, `${auditPath}&format=csv`]) {
      assert.equal((await r.call(path, { cookie: actorCookie })).status, 401);
      assert.equal((await r.call(path)).status, 401);
    }
    const claim = await r.db.prepare('SELECT email,completed,jti,operator_id FROM oc_owner_claims').first();
    assert.equal(claim.email, `deleted-${r.owner.id.toLowerCase()}@operator.invalid`);
    assert.equal(claim.operator_id, r.owner.id);
    assert.equal(claim.completed, 1);
    assert.equal(claim.jti, 'consumed-claim');
    const grants = (await r.db.prepare('SELECT jti,subject FROM oc_idp_grants ORDER BY issuer').all()).results;
    assert.deepEqual(grants, [{ jti: 'consumed-claim', subject: `erased:${r.owner.id}` }, { jti: 'consumed-claim', subject: 'other-subject' }]);
    assert.equal((await r.base.handle(r.request('/auth/bootstrap', { method: 'POST', body: { token: r.bindings.SETUP_TOKEN, displayName: 'Replacement' } }))).status, 409);
    assert.equal((await r.call('/api/app/session', { cookie: actorCookie })).status, 401);
    assert.equal((await r.call('/api/app/session', { cookie: other.cookie })).status, 200);
    assert.equal((await r.call(`/api/app/operators/${other.id}`, { method: 'DELETE', cookie: other.cookie })).status, 409);
  }
})(t);
  t.diagnostic("accepting or reactivating concurrently with erasure never leaves an authorized identity erased");
  await (async t => {
  const r = await lampRuntime(t);
  const target = await r.invite('racing@example.test');
  const [erasure, acceptance] = await Promise.all([
    r.call(`/api/app/operators/${target.id}`, { method: 'DELETE', cookie: r.cookie }),
    r.base.handle(r.request('/auth/confirm', { method: 'POST', body: { token: target.token } })),
  ]);
  assert.ok([204, 409].includes(erasure.status));
  assert.ok([303, 400].includes(acceptance.status));
  let row = await r.db.prepare('SELECT email,status FROM oa_operators WHERE id=?').bind(target.id).first();
  if (row.status === 'active') assert.equal(row.email, 'racing@example.test');
  else { assert.equal(erasure.status, 204); await assertErased(r, target.id); }
  const active = await r.invite('reactivated@example.test', true);
  assert.equal((await r.call(`/api/app/operators/${active.id}/revoke-access`, { method: 'POST', cookie: r.cookie })).status, 204);
  const results = await Promise.all([
    r.call(`/api/app/operators/${active.id}`, { method: 'DELETE', cookie: r.cookie }),
    r.authHandle(r.request('/auth/operator/status', { method: 'POST', cookie: r.cookie, body: { operatorId: active.id, status: 'active' } })),
  ]);
  assert.ok([204, 409].includes(results[0].status));
  row = await r.db.prepare('SELECT email,status FROM oa_operators WHERE id=?').bind(active.id).first();
  if (row.status === 'active') assert.equal(row.email, 'reactivated@example.test');
})(t);
});
