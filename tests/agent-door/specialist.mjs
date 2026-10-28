import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const content = answer => answer.result?.structuredContent;
const code = answer => answer.result?._meta?.['com.runeditrun/error']?.code ?? answer.body?.error?.data?.code;

/** One native incident shift; every application effect uses the public door. */
export default async function specialist({ request, origin, cookie, tool }) {
  const person = async (path, value, method = 'POST') => {
    const response = await request(new URL(path, origin).href, { method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    const body = await response.json();
    assert.ok(response.ok, `${path} refused with HTTP ${response.status}`);
    return body;
  };
  const call = async (name, args = {}, key = randomUUID()) => {
    const answer = await tool(name, { ...args, idempotency_key: key });
    assert.ok(!answer.result?.isError && content(answer) !== undefined, `${name}: ${code(answer) ?? answer.status}`);
    return { answer, result: content(answer), key };
  };
  const component = (await call('lamp.components.create', { groupId: null, name: 'Harbour API', description: 'Customer API requests', internal: false, displayOrder: 0, note: '' })).result.component;
  const source = (await person('/api/app/intake/sources', { name: 'API request monitor', preset: 'datadog', componentId: component.id, credentialKind: 'bearer-token' })).source;
  const incoming = await request(`https://status.rer-hosted-check.invalid/api/intake/${source.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${source.token}` }, body: JSON.stringify({ alert_id: 'harbour-api-delay', alert_cycle_key: randomUUID(), alert_transition: 'Triggered', alert_title: 'API requests failing' }) });
  assert.equal(incoming.status, 202, 'A real signed/native alert credential creates private evidence');
  const id = (await incoming.json()).incidentId;
  const initial = (await call('lamp.incidents.read', { id })).result;
  const draft = { lifecycle: 'Investigating', affectedAudience: 'API customers', customerImpact: 'Some API requests are delayed.', whatStillWorks: 'The dashboard remains available.', details: 'Responders are investigating the reported delay.', nextUpdateAt: new Date(Date.now() + 3600_000).toISOString() };
  const saved = (await call('lamp.drafts.save', { id, draft_version: initial.revision, draft })).result;
  await call('lamp.incidents.note', { id, body: 'PRIVATE-DO-NOT-DISCLOSE: responder investigation detail.' });
  const brief = (await call('lamp.incidents.brief', { id })).result;
  assert.ok(!JSON.stringify(brief).includes('PRIVATE-DO-NOT-DISCLOSE'));
  const stale = await tool('lamp.incidents.publish', { id, draft_version: initial.revision, channels: [], idempotency_key: randomUUID() });
  assert.equal(code(stale), 'revision_conflict', 'A stale saved preview cannot publish');
  const published = await call('lamp.incidents.publish', { id, draft_version: saved.revision, channels: [] });
  const beforeReplay = (await call('lamp.incidents.read', { id })).result;
  const replayed = await call('lamp.incidents.publish', { id, draft_version: saved.revision, channels: [] }, published.key);
  assert.deepEqual(replayed.result, published.result);
  assert.equal((await call('lamp.incidents.read', { id })).result.incident.updates.length, beforeReplay.incident.updates.length);
  const recovery = (await call('lamp.recovery.read', { id })).result.recovery;
  assert.equal(recovery.passed, false, 'Still-firing native recovery evidence stays failed');
  const current = (await call('lamp.incidents.read', { id })).result;
  const resolved = (await call('lamp.drafts.save', { id, draft_version: current.revision, draft: { ...draft, lifecycle: 'Resolved', nextUpdateAt: null, componentChanges: [{ componentId: component.id, state: 'Operational', relationship: 'Primary' }] } })).result;
  const refused = await tool('lamp.incidents.resolve', { id, draft_version: resolved.revision, channels: [], confirmExternal: true, idempotency_key: randomUUID() });
  assert.equal(code(refused), 'recovery_required', 'Caller confirmation cannot manufacture recovery');
  const reason = 'Independent customer checks confirm recovery; this monitor still checks the retired endpoint.';
  await call('lamp.incidents.resolve', { id, draft_version: resolved.revision, channels: [], overrideReason: reason });
  const publicResponse = await request(`https://status.rer-hosted-check.invalid/incidents/${beforeReplay.incident.reference}`);
  const publicHtml = await publicResponse.text();
  assert.equal(publicResponse.status, 200);
  assert.ok(!publicHtml.includes(reason) && !publicHtml.includes('PRIVATE-DO-NOT-DISCLOSE'));
  assert.ok(publicHtml.includes('for Jordan Harbour'), 'Published content names agent for sponsor');
  await call('lamp.reports.draft', { id });
  const report = (await call('lamp.reports.save', { id, report: { summary: 'API requests were delayed.', timeline: 'Responders isolated the dependency and checked recovery.', cause: 'A retired dependency remained in the request path.', remediation: 'Remove the dependency and retain an independent customer check.' } })).result;
  await call('lamp.reports.publish', { id, report_version: report.revision, channels: [] });
  // A competing incident must retain its component claim when maintenance ends.
  const competitor = (await call('lamp.incidents.create', { title: 'Concurrent API dependency incident', components: [{ componentId: component.id, state: 'Major outage', relationship: 'Primary' }], update: draft })).result;
  await call('lamp.incidents.publish', { id: competitor.incident.id, draft_version: competitor.revision, channels: [] });
  const maintenance = (await call('lamp.maintenance.create', { title: 'API dependency maintenance', affectedAudience: 'API customers', customerImpact: 'Brief API delays are possible.', startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 7200_000).toISOString(), componentIds: [component.id], autoStart: false, autoComplete: false })).result.maintenance;
  const start = await call('lamp.maintenance.start', { id: maintenance.id });
  await call('lamp.maintenance.start', { id: maintenance.id }, start.key);
  await call('lamp.maintenance.complete', { id: maintenance.id });
  assert.equal((await call('lamp.components.read', { id: component.id })).result.component.publicState, 'Major outage');
  const csv = 'email\r\nmove-in-recipient@example.test\r\n';
  const preview = await person('/api/app/subscribers/import/preview', { csv });
  const applied = await person('/api/app/subscribers/import/apply', { csv, reviewedFingerprint: preview.fingerprint });
  const invitation = await call('lamp.subscribers.invite', { batch_id: applied.batchId });
  await call('lamp.subscribers.invite', { batch_id: applied.batchId }, invitation.key);
  const recipients = (await call('lamp.subscribers.read')).result.subscribers.filter(row => row.destination === 'move-in-recipient@example.test');
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].state, 'pending', 'An invitation never confirms a subscription');
  return { id, componentId: component.id, maintenanceId: maintenance.id, reference: beforeReplay.incident.reference, reportId: report.report.id, competitor: competitor.incident.id };
}
