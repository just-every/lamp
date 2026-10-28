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

// Retained native record/custody fixtures exercise privacy of stored history.
// Authentication, live accounts, the erasure HTTP route and every erasure write
// remain the real production implementations over the fully migrated D1 store.
async function retainedAgentCustody(r, target) {
  const name = 'Erasure "A&B"';
  await r.auth.changeDisplayName(r.request('/auth/display-name', { method: 'POST', cookie: target.cookie }), { displayName: name });
  const at = '2026-10-28T12:00:00.000Z';
  const ids = Object.fromEntries(['incident', 'update', 'report', 'maintenance', 'notice', 'componentEvent', 'outbox', 'unrelatedOutbox', 'account', 'post', 'delivery', 'job', 'doneJob', 'otherJob', 'audit', 'event', 'personEvent', 'approval', 'finishedApproval', 'review'].map(key => [key, crypto.randomUUID()]));
  const prepared = {
    agent: { id: 'native-erasure-agent', name: 'Incident helper' }, sponsor: { id: target.id, name },
    label: `Incident helper for ${name}`, approvers: [{ id: r.owner.id, name: r.owner.displayName }],
    invocation: { consent: 'retained-consent', scopes: ['lamp:publish'], clientId: 'retained-client' },
  };
  const approved = {
    agent: { id: 'native-other-agent', name: 'Maintenance helper' }, sponsor: { id: r.owner.id, name: r.owner.displayName },
    label: `Maintenance helper for ${r.owner.displayName}`, approvers: [{ id: target.id, name }, { id: r.owner.id, name: r.owner.displayName }],
    invocation: { consent: 'other-consent', scopes: ['lamp:publish'], clientId: 'other-client' },
  };
  const untouched = { ...approved, approvers: [{ id: r.owner.id, name: r.owner.displayName }] };
  const principal = { person: { id: target.id, name, email: 'erasure@example.test', role: 'owner', active: true }, agent: prepared.agent,
    scopes: ['lamp:publish'], consent: 'retained-consent', clientId: 'retained-client', nativeProof: { kind: 'step_up', reference: 'retained-proof' } };
  const insert = (table, row) => r.db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row));
  const updated = { created_at: at, updated_at: at };
  const subscriptionMail = [];
  const subscriberService = r.modules.createSubscribersService(r.modules.createSubscriberRepository(r.db), {
    tokenSecret: 'synthetic-agent-erasure-subscriber', fromAddress: 'lamp@example.test',
    mail: { configured: true, async send(message) { subscriptionMail.push(message); return { providerMessageId: 'synthetic-confirmation-receipt' }; } },
  });
  await subscriberService.requestEmailSubscription('recipient@example.test', 'https://page.example.test');
  const confirmation = new URL(subscriptionMail.at(-1).text.match(/https?:\/\/[^\s]+/)[0]);
  assert.equal(await subscriberService.confirm(confirmation.pathname.split('/').at(-1)), true);
  const subscriber = (await subscriberService.list()).find(row => row.destination === 'recipient@example.test');
  assert.equal(subscriber.state, 'active');
  const text = `Prepared by: ${prepared.label}\nApproved by: ${r.owner.displayName}`;
  const frozen = { frozenAt: at, from: 'lamp@example.test', to: 'recipient@example.test', subject: 'Native incident notice', text,
    html: `<p>Prepared by: Incident helper for Erasure &quot;A&amp;B&quot;</p>`, headers: {}, idempotencyKey: `notification/${ids.delivery}` };
  const socialText = `${approved.label} · Approved by ${name}, ${r.owner.displayName}`;
  const saved = { decision_id: 'retained-decision', revision: 7, tool: 'lamp.incidents.publish', args: { id: ids.incident }, classes: [{ class: 'external', facts: { measure: 1 } }], principal,
    approvers: ['role:owner'], expires_at: '2099-01-01T00:00:00.000Z', door: 'mcp', summary: { target: { id: ids.incident, name: 'Retained incident' } }, summary_sha256: 'retained-summary-hash', result: { outcome: 'pending', decision: null } };
  const preparedBy = { agent: prepared.agent, for: prepared.sponsor, label: prepared.label };
  const decision = { id: 'retained-decision', disposition: 'autonomous', revision: 7, classes: [{ class: 'external', facts: { measure: 1 }, rule: 'retained-rule', do: 'autonomous' }] };
  const audit = { id: ids.audit, at, door: 'mcp', agent: prepared.agent, sponsor: prepared.sponsor, label: prepared.label, consent: 'retained-consent', tool: 'lamp.incidents.publish', resource: `lamp://incidents/${ids.incident}`,
    decision_id: decision.id, classes: [{ class: 'external', facts: { measure: 1 } }], revision: 7, rules: decision.classes, decision: 'autonomous', outcome: 'done', code: null, approval: null, review: null, idempotency_key: 'retained-key', trace: null, ignored_arguments: [], replay_of: null };
  const completed = { outcome: 'done', decision, result: { incident: { id: ids.incident, agentAction: prepared } }, receipt: { prepared_by: preparedBy, approved_by: [target.id] } };
  await r.db.batch([
    insert('incidents', { id: ids.incident, reference: 'INC-91821', title: 'Retained incident', lifecycle: 'Resolved', opened_at: at, resolved_at: at, created_by_operator_id: target.id, ...updated }),
    insert('incident_updates', { id: ids.update, incident_id: ids.incident, lifecycle: 'Resolved', affected_audience: 'API customers', customer_impact: 'Service recovered', what_still_works: '', details: '', next_update_at: null, published_at: at, author_operator_id: target.id, agent_action_json: JSON.stringify(prepared), ...updated }),
    insert('incident_reports', { id: ids.report, incident_id: ids.incident, summary: 'Retained native report', published_at: at, author_operator_id: target.id, agent_action_json: JSON.stringify(prepared), ...updated }),
    insert('maintenance', { id: ids.maintenance, reference: 'SCH-91822', title: 'Retained maintenance', state: 'Completed', starts_at: at, ends_at: at, completed_at: at, created_by_operator_id: r.owner.id, ...updated }),
    insert('maintenance_notices', { id: ids.notice, maintenance_id: ids.maintenance, kind: 'completed', body: 'Maintenance complete', published_at: at, author_operator_id: r.owner.id, agent_action_json: JSON.stringify(approved), ...updated }),
    insert('component_notification_events', { id: ids.componentEvent, component_id: 'retained-component', component_name: 'API', component_created_at: at, previous_state: 'Degraded performance', new_state: 'Operational', changed_at: at, claimant_kind: 'standing-claim', agent_action_json: JSON.stringify(approved) }),
    insert('notification_outbox', { id: ids.outbox, kind: 'delivery-dispatch', aggregate_id: ids.update, payload_json: JSON.stringify({ eventId: ids.update }), available_at: at, agent_action_json: JSON.stringify(prepared), ...updated }),
    insert('notification_outbox', { id: ids.unrelatedOutbox, kind: 'delivery-dispatch', aggregate_id: ids.componentEvent, payload_json: JSON.stringify({ eventId: ids.componentEvent }), available_at: at, agent_action_json: JSON.stringify(untouched), ...updated }),
    insert('social_accounts', { id: ids.account, network: 'mastodon', name: 'Retained account', host: 'https://social.example.test', sealed_credential: 'synthetic-unusable-custody', created_by_operator_id: r.owner.id, created_at: at }),
    insert('social_posts', { id: ids.post, event_id: ids.notice, account_id: ids.account, maintenance_id: ids.maintenance, reference: 'SCH-91822', lifecycle: 'Completed', customer_impact: 'Maintenance complete', prefix: '', queued_at: at, body: JSON.stringify({ status: socialText }), text: socialText, post_id: 'already-accepted-provider-id', delivered_at: at, agent_action_json: JSON.stringify(approved) }),
    insert('notification_deliveries', { id: ids.delivery, subscriber_id: subscriber.id, incident_update_id: ids.update, channel: 'email', outcome: 'delivered', queued_at: at, outcome_at: at, notification_event_id: ids.update, notification_event_type: 'incident-update', mail_payload_json: JSON.stringify(frozen), ...updated }),
    ...[['job', 'pending'], ['doneJob', 'done'], ['otherJob', 'pending']].map(([key, state]) => insert('lamp_agent_jobs', { id: ids[key], tool: 'lamp.incidents.publish', args_json: JSON.stringify({ id: ids.incident, idempotency_key: ids[key] }), due_at: at, principal_json: JSON.stringify(key === 'otherJob' ? { ...principal, person: { id: r.owner.id, name: r.owner.displayName, email: r.owner.email, role: 'owner', active: true }, consent: 'other-consent' } : principal), state, result_json: state === 'done' ? JSON.stringify(completed) : null, created_at: at })),
    insert('audit_entries', { id: ids.audit, entity_type: 'agent-operation', entity_id: ids.incident, action: 'lamp.incidents.publish', operator_id: target.id, payload_json: JSON.stringify({ actor: { ...preparedBy, approvers: [{ id: target.id, name }] } }), ...updated }),
    insert('agent_door_agents', { id: prepared.agent.id, name: prepared.agent.name, sponsor: target.id, sponsor_name: name }),
    insert('agent_door_calls', { agent: prepared.agent.id, key: 'retained-key', digest: 'retained-digest', decision_id: decision.id, created_at: Date.now(), state: 'done', outcome: JSON.stringify(completed) }),
    insert('agent_door_audit', { id: ids.audit, at, agent: prepared.agent.id, classes: JSON.stringify(['external']), row: JSON.stringify(audit) }),
    insert('agent_door_events', { id: ids.event, uri: `lamp://incidents/${ids.incident}`, event: JSON.stringify({ id: ids.event, at, type: 'incident.published', uri: `lamp://incidents/${ids.incident}`, actor: { kind: 'agent', ...preparedBy }, approved_by: [{ id: target.id, name }] }) }),
    insert('agent_door_events', { id: ids.personEvent, uri: `lamp://incidents/${ids.incident}`, event: JSON.stringify({ id: ids.personEvent, at, type: 'incident.changed', uri: `lamp://incidents/${ids.incident}`, actor: { kind: 'person', person: { id: target.id, name } } }) }),
    insert('agent_door_approvals', { id: ids.approval, state: 'pending', saved: JSON.stringify(saved), approvals: JSON.stringify([{ ref: 'role:owner', person: target.id, name, at }]) }),
    insert('agent_door_approvals', { id: ids.finishedApproval, state: 'executed', saved: JSON.stringify(saved), result: JSON.stringify(completed) }),
    insert('agent_door_reviews', { id: ids.review, state: 'reviewed', saved: JSON.stringify({ tool: 'lamp.incidents.publish', principal, classes: saved.classes, reviewers: ['role:owner'] }), marked_by: r.owner.id, marked_at: at }),
    r.db.prepare("UPDATE bs_settings SET rev=11,document=?,token=?,owner_id='business-owner-retained' WHERE singleton=1").bind(JSON.stringify({ owner_id: 'business-owner-retained', team: [{ id: 'business-teammate-retained', email: 'erasure@example.test' }] }), 'retained-settings-envelope'),
    insert('bs_team', { email: 'erasure@example.test', operator_id: target.id, invite: 0, state: 'active', business_id: 'business-teammate-retained', business_role: 'member' }),
  ]);
  // bs_settings starts empty until the first signed adoption; this fixture is a
  // retained cache, not a verifier bypass or an assertion of signed adoption.
  await r.db.prepare("INSERT OR IGNORE INTO bs_settings(singleton,rev,document,token,owner_id) VALUES(1,11,?,?,'business-owner-retained')")
    .bind(JSON.stringify({ owner_id: 'business-owner-retained', team: [{ id: 'business-teammate-retained', email: 'erasure@example.test' }] }), 'retained-settings-envelope').run();
  return { ids, name, prepared, approved, untouched, principal, frozen, audit };
}

async function assertAgentCustodyErased(r, target, saved) {
  const { ids, name, prepared, untouched, principal, frozen, audit } = saved;
  const anonymous = `Erased operator · ${target.id}`;
  for (const [table, id] of [['incident_updates', ids.update], ['incident_reports', ids.report], ['maintenance_notices', ids.notice], ['component_notification_events', ids.componentEvent], ['notification_outbox', ids.outbox], ['social_posts', ids.post]]) {
    const row = await r.db.prepare(`SELECT agent_action_json FROM ${table} WHERE id=?`).bind(id).first();
    const action = JSON.parse(row.agent_action_json);
    assert.ok(!row.agent_action_json.includes(name), `${table} forgets the copied person's name`);
    assert.equal(action.invocation, undefined, `${table} no longer carries retained dispatch authority`);
    if (action.sponsor.id === target.id) {
      assert.equal(action.sponsor.name, anonymous);
      assert.equal(action.label, `${action.agent.name} for ${anonymous}`);
    } else {
      assert.equal(action.sponsor.id, r.owner.id);
      assert.equal(action.sponsor.name, r.owner.displayName);
      assert.equal(action.approvers.find(person => person.id === target.id).name, anonymous);
    }
  }
  const unrelated = await r.db.prepare('SELECT agent_action_json FROM notification_outbox WHERE id=?').bind(ids.unrelatedOutbox).first();
  assert.deepEqual(JSON.parse(unrelated.agent_action_json), untouched, 'another current principal retains their original unrelated authority');
  const delivery = await r.db.prepare('SELECT outcome,outcome_at,mail_payload_json FROM notification_deliveries WHERE id=?').bind(ids.delivery).first();
  const envelope = JSON.parse(delivery.mail_payload_json);
  assert.ok(envelope.text.includes(`Prepared by: ${prepared.agent.name} for ${anonymous}`));
  assert.ok(envelope.html.includes(anonymous));
  assert.ok(!envelope.html.includes('A&amp;B') && !envelope.text.includes(name), 'both HTML-encoded and plain attribution copies are anonymized');
  assert.equal(envelope.idempotencyKey, frozen.idempotencyKey);
  assert.equal(envelope.to, frozen.to);
  assert.equal(delivery.outcome, 'delivered', 'erasure does not claim a sent message was recalled');
  assert.equal(delivery.outcome_at, '2026-10-28T12:00:00.000Z');
  const social = await r.db.prepare('SELECT text,body,post_id,delivered_at FROM social_posts WHERE id=?').bind(ids.post).first();
  assert.ok(social.text.includes(`Approved by ${anonymous}`));
  assert.ok(JSON.parse(social.body).status.includes(anonymous));
  assert.ok(!social.text.includes(name) && !JSON.parse(social.body).status.includes(name));
  assert.equal(social.post_id, 'already-accepted-provider-id');
  assert.equal(social.delivered_at, '2026-10-28T12:00:00.000Z');
  const job = await r.db.prepare('SELECT state,args_json,principal_json,result_json FROM lamp_agent_jobs WHERE id=?').bind(ids.job).first();
  const queued = JSON.parse(job.principal_json);
  assert.equal(job.state, 'refused');
  assert.equal(JSON.parse(job.result_json).code, 'sponsor_erased');
  assert.equal(queued.person.id, target.id);
  assert.deepEqual(queued.scopes, []);
  for (const key of ['consent', 'clientId', 'nativeProof']) assert.equal(queued[key], undefined);
  assert.deepEqual(JSON.parse(job.args_json), {});
  assert.ok(!job.principal_json.includes(name) && !job.principal_json.includes('erasure@example.test'), 'queued principal has no copied person identity');
  const done = await r.db.prepare('SELECT state,result_json FROM lamp_agent_jobs WHERE id=?').bind(ids.doneJob).first();
  assert.equal(done.state, 'done'); assert.equal(JSON.parse(done.result_json).outcome, 'done');
  const other = await r.db.prepare('SELECT state,principal_json FROM lamp_agent_jobs WHERE id=?').bind(ids.otherJob).first();
  assert.equal(other.state, 'pending');
  assert.deepEqual(JSON.parse(other.principal_json), { ...principal, person: { id: r.owner.id, name: r.owner.displayName, email: r.owner.email, role: 'owner', active: true }, consent: 'other-consent' });
  const nativeAudit = JSON.parse((await r.db.prepare('SELECT payload_json FROM audit_entries WHERE id=?').bind(ids.audit).first()).payload_json);
  assert.equal(nativeAudit.actor.for.name, anonymous); assert.equal(nativeAudit.actor.approvers[0].name, anonymous);
  const nativeAuditView = await r.call(`/api/app/audit-log?actorId=${encodeURIComponent(target.id)}&action=lamp.incidents.publish`, { cookie: r.cookie });
  assert.equal(nativeAuditView.status, 200);
  assert.equal((await nativeAuditView.json()).entries.find(row => row.id === ids.audit).actorName, `${prepared.agent.name} for ${anonymous}`);
  const retained = JSON.parse((await r.db.prepare('SELECT row FROM agent_door_audit WHERE id=?').bind(ids.audit).first()).row);
  assert.equal(retained.sponsor.name, anonymous); assert.equal(retained.label, `${prepared.agent.name} for ${anonymous}`);
  assert.equal(retained.sponsor.id, target.id); assert.equal(retained.agent.id, prepared.agent.id);
  assert.equal(retained.outcome, 'done'); assert.equal(retained.consent, null);
  assert.deepEqual(retained.classes, audit.classes);
  const event = JSON.parse((await r.db.prepare('SELECT event FROM agent_door_events WHERE id=?').bind(ids.event).first()).event);
  assert.equal(event.actor.for.name, anonymous); assert.equal(event.approved_by[0].name, anonymous);
  const personEvent = JSON.parse((await r.db.prepare('SELECT event FROM agent_door_events WHERE id=?').bind(ids.personEvent).first()).event);
  assert.equal(personEvent.actor.person.name, anonymous);
  const agent = await r.db.prepare('SELECT sponsor_name,revoked FROM agent_door_agents WHERE id=?').bind(prepared.agent.id).first();
  assert.equal(agent.sponsor_name, anonymous); assert.equal(agent.revoked, 1);
  const approval = await r.db.prepare('SELECT state,saved,approvals,result FROM agent_door_approvals WHERE id=?').bind(ids.approval).first();
  assert.equal(approval.state, 'refused'); assert.equal(JSON.parse(approval.result).code, 'sponsor_erased');
  assert.equal(JSON.parse(approval.approvals)[0].name, anonymous);
  const approvalSaved = JSON.parse(approval.saved);
  assert.equal(approvalSaved.principal.person.name, anonymous); assert.equal(approvalSaved.principal.person.active, false);
  assert.deepEqual(approvalSaved.principal.scopes, []); assert.equal(approvalSaved.principal.nativeProof, undefined);
  const finished = await r.db.prepare('SELECT state,result FROM agent_door_approvals WHERE id=?').bind(ids.finishedApproval).first();
  assert.equal(finished.state, 'executed');
  assert.equal(JSON.parse(finished.result).outcome, 'done');
  assert.equal(JSON.parse(finished.result).receipt.prepared_by.for.name, anonymous);
  assert.equal(JSON.parse(finished.result).result, undefined);
  const review = JSON.parse((await r.db.prepare('SELECT saved FROM agent_door_reviews WHERE id=?').bind(ids.review).first()).saved);
  assert.equal(review.principal.person.name, anonymous); assert.equal(review.principal.consent, undefined);
  const replay = JSON.parse((await r.db.prepare('SELECT outcome FROM agent_door_calls WHERE agent=?').bind(prepared.agent.id).first()).outcome);
  assert.equal(replay.outcome, 'refused'); assert.equal(replay.code, 'sponsor_erased');
  const settings = await r.db.prepare('SELECT rev,document,token,owner_id FROM bs_settings WHERE singleton=1').first();
  assert.deepEqual(settings, { rev: 11, document: null, token: '', owner_id: 'business-owner-retained' });
  const member = await r.db.prepare('SELECT email,state,business_id,business_role FROM bs_team WHERE operator_id=?').bind(target.id).first();
  assert.deepEqual(member, { email: `deleted-${target.id.toLowerCase()}@operator.invalid`, state: 'inactive', business_id: null, business_role: null });
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
  const r = await lampRuntime(t, { registerRoutes: ({ app, db, modules }) => modules.registerAuditLogRoutes(app, modules.createAuditLogRepository(db)) });
  const target = await r.invite('erasure@example.test', true);
  const retained = await retainedAgentCustody(r, target);
  const providerCookie = await r.providerSession(target.id);
  assert.equal((await r.call('/api/app/session', { cookie: providerCookie })).status, 200);
  await r.base.auth.requestMagicLink(r.request('/auth/magic-link', { method: 'POST' }), { email: 'erasure@example.test' });
  const outstanding = linkToken(r.base.messages.at(-1));
  await r.base.auth.mintCredential(r.request('/auth/credentials', { method: 'POST', cookie: target.cookie }));
  await r.base.auth.requestStepUp(r.request('/auth/step-up', { method: 'POST', cookie: target.cookie }), { action: 'delete' });
  const subscriberTokens = (await r.db.prepare('SELECT * FROM subscriber_tokens').all()).results;
  assert.ok((await r.db.prepare('SELECT count(*) n FROM oa_tokens WHERE operator_id=? AND revoked_at IS NULL').bind(target.id).first()).n > 0);
  assert.equal((await r.db.prepare('SELECT count(*) n FROM oa_credentials WHERE operator_id=? AND revoked_at IS NULL').bind(target.id).first()).n, 1);
  assert.equal((await r.call(`/api/app/operators/${target.id}`, { method: 'DELETE', cookie: r.cookie })).status, 204);
  await assertErased(r, target.id);
  await assertAgentCustodyErased(r, target, retained);
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
    await r.db.prepare("INSERT INTO bs_settings(singleton,rev,document,token,owner_id) VALUES(1,13,?,?,'business-owner-to-erase')")
      .bind(JSON.stringify({ owner_id: 'business-owner-to-erase', owner_email: r.owner.email }), 'retained-owner-settings-envelope').run();
    const refused = await r.call(`/api/app/operators/${r.owner.id}`, { method: 'DELETE', cookie: other.cookie });
    assert.equal(refused.status, 403, 'another owner cannot erase the setup owner');
    assert.equal((await r.db.prepare('SELECT token FROM bs_settings').first()).token, 'retained-owner-settings-envelope', 'refused erasure preserves cached signed-settings custody');
    assert.equal((await r.call(`/api/app/operators/${r.owner.id}`, { method: 'DELETE', cookie: actorCookie })).status, 204);
    await assertErased(r, r.owner.id);
    assert.deepEqual(await r.db.prepare('SELECT rev,document,token,owner_id FROM bs_settings').first(), { rev: 13, document: null, token: '', owner_id: null }, 'setup-owner erasure removes its applied Business identity without lowering the signed revision');
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
