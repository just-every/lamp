import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { nativeFixture } from './fixture-state.mjs';
import { pendingAssertions } from './pending.mjs';
import { inspectNativePages } from './native-pages.mjs';
const errorCode = answer => answer.result?._meta?.['com.runeditrun/error']?.code ?? answer.body?.error?.data?.code;
const result = (answer, label) => {
  assert.equal(answer.status, 200, `${label}: HTTP ${answer.status}`);
  assert.equal(Boolean(answer.result?.isError), false, `${label}: ${errorCode(answer) ?? 'native action refused'}`);
  assert.ok(answer.result?.structuredContent, `${label}: native structured result required`);
  return answer.result.structuredContent;
};
/** Specialist work uses the production MCP, intake, person and import doors. */
export default async function specialist({ request, origin, email, cookie, mail, tool }) {
  await inspectNativePages({ request, origin, cookie });
  const person = async (path, method = 'GET', body) => {
    const response = await request(new URL(path, origin).href, { method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.ok(response.ok, `Native person ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const call = async (name, args = {}) => result(await tool(name, { ...args, idempotency_key: randomUUID() }), name);
  const fixture = nativeFixture();
  const source = (await person('/api/app/intake/sources')).sources.find(row => row.id === fixture.source.id);
  assert.ok(source?.endpointUrl);
  let accepted;
  try {
    accepted = await request(source.endpointUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixture.token}` }, body: JSON.stringify({ id: randomUUID(), title: 'Customer-visible API failures', state: 'firing' }) });
  } catch (cause) {
    throw new Error(`${pendingAssertions.dualHost}: ${cause instanceof Error ? cause.message : 'public source unavailable'}`);
  }
  assert.equal(accepted.status, 202, 'Native intake must create live alert evidence');
  const alert = await accepted.json();
  assert.ok(alert.incidentId);
  const id = alert.incidentId;
  const observed = await call('lamp.incidents.read', { id });
  const update = { lifecycle: 'Investigating', affectedAudience: 'Customers using the API', customerImpact: 'Some API requests fail.', whatStillWorks: 'The dashboard remains available.', details: 'The accepted alert remains firing.', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() };
  const draft = { ...update, componentChanges: [{componentId: fixture.componentId, state: 'Major outage', relationship: 'Primary'}] };
  await call('lamp.incidents.note', { id, body: 'PRIVATE-CONFORMANCE-NOTE: provider text is evidence, never approval.' });
  const saved = await call('lamp.drafts.save', { id, version: observed.version, draft });
  const preview = await call('lamp.incidents.preview', { id });
  assert.equal(preview.version, saved.version);
  const published = await call('lamp.incidents.publish', { id, version: saved.version, channels: [] });
  const stale = await tool('lamp.incidents.publish', { id, version: saved.version, channels: [], idempotency_key: randomUUID() });
  assert.equal(errorCode(stale), 'revision_conflict', 'Stale versions publish nothing');
  const resolved = await call('lamp.drafts.save', { id, version: published.version, draft: { ...draft, lifecycle: 'Resolved', nextUpdateAt: null, componentChanges: [{componentId: fixture.componentId, state: 'Operational', relationship: 'Primary'}] } });
  const before = await call('lamp.workspace.snapshot');
  const failing = await tool('lamp.incidents.resolve', { id, version: resolved.version, channels: [], idempotency_key: randomUUID() });
  assert.equal(errorCode(failing), 'recovery_required', 'Agent confirmation cannot fabricate recovery');
  assert.deepEqual(await call('lamp.workspace.snapshot'), before);
  const overrideReason = 'The incident commander independently verified rollback; the stale source is being repaired.';
  await call('lamp.incidents.resolve', { id, version: resolved.version, channels: [], overrideReason });
  const finalIncident = await call('lamp.incidents.read', { id });
  assert.equal(finalIncident.incident.lifecycle, 'Resolved');
  assert.ok(JSON.stringify(finalIncident.incident).includes(overrideReason));
  const publicIncident = await request(new URL(`/incidents/${finalIncident.incident.reference}`, source.endpointUrl).href);
  assert.equal(publicIncident.status, 200);
  const publicText = await publicIncident.text();
  assert.ok(!publicText.includes(overrideReason) && !publicText.includes('PRIVATE-CONFORMANCE-NOTE'));
  await call('lamp.reports.draft', { id });
  await call('lamp.reports.save', { id, report: { summary: 'Customer-visible API failures were resolved.', timeline: 'The native timeline records the alert, public updates and explicit resolution override.', cause: 'The commander verified a configuration regression.', remediation: 'The team restored the known-good configuration and arranged independent source repair.' } });
  await call('lamp.reports.publish', { id, channels: [] });
  const competing = await call('lamp.incidents.create', { title: 'Competing component claim', components: [{ componentId: fixture.componentId, state: 'Major outage', relationship: 'Primary' }], update });
  await call('lamp.incidents.publish', { id: competing.incident.id, version: competing.version, channels: [] });
  const window = await call('lamp.maintenance.create', { title: 'Native maintenance alongside an incident', affectedAudience: 'API customers', customerImpact: 'The planned operation retains the existing incident claim.', componentIds: [fixture.componentId], startsAt: new Date(Date.now() + 7200000).toISOString(), endsAt: new Date(Date.now() + 10800000).toISOString(), autoStart: false, autoComplete: false, social: false });
  const maintenanceArgs = { id: window.maintenance.id, idempotency_key: randomUUID() };
  const start = result(await tool('lamp.maintenance.start', maintenanceArgs), 'maintenance start');
  const replay = result(await tool('lamp.maintenance.start', maintenanceArgs), 'maintenance replay');
  assert.deepEqual(replay, start, 'Exact replay has one native maintenance transition');
  const affected = await call('lamp.components.read', { id: fixture.componentId });
  assert.equal(affected.component.publicState, 'Major outage', 'Maintenance cannot erase a competing incident claim');
  await call('lamp.maintenance.complete', { id: window.maintenance.id });
  assert.equal((await call('lamp.components.read', { id: fixture.componentId })).component.publicState, 'Major outage');

  const csv = `email\n${email}\n`;
  const previewImport = await person('/api/app/subscribers/import/preview', 'POST', { csv });
  const mailBeforeImport = mail.read({ limit: 20 });
  const imported = await person('/api/app/subscribers/import/apply', 'POST', { csv, reviewedFingerprint: previewImport.fingerprint });
  assert.equal(imported.counts.created, 1);
  assert.deepEqual(mail.read({ limit: 20 }), mailBeforeImport, 'Import applies silently');
  const inviteArgs = { batchId: imported.batchId, idempotency_key: randomUUID() };
  const invited = result(await tool('lamp.subscribers.invite', inviteArgs), 'explicit subscriber invitation');
  assert.equal(invited.sent, 1);
  const captured = mail.read({ limit: 20 });
  assert.ok(captured.some(message => message.text.includes(' for ')), 'Outbound content names agent for sponsor');
  assert.deepEqual(result(await tool('lamp.subscribers.invite', inviteArgs), 'invitation replay'), invited);
  assert.deepEqual(mail.read({ limit: 20 }), captured, 'Invitation replay creates no second native provider admission');
  const consent = await call('lamp.subscribers.read', { id: imported.subscriberIds[0] });
  assert.equal(consent.subscribers[0].state, 'pending', 'An invitation is not subscriber confirmation');

  // Real wall-clock scheduling exercises final admission without fake app time.
  const scheduledIncident = await call('lamp.incidents.create', { title: 'Due native publication', components: [{ componentId: fixture.componentId, state: 'Degraded performance', relationship: 'Primary' }], update });
  const publishAt = new Date(Date.now() + 1000).toISOString();
  const scheduled = await call('lamp.updates.schedule', { id: scheduledIncident.incident.id, version: scheduledIncident.version, channels: [], publishAt });
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(publishAt) - Date.now())));
  await call('lamp.updates.dispatch', { id: scheduledIncident.incident.id, version: scheduled.version });
  assert.equal((await call('lamp.incidents.read', { id: scheduledIncident.incident.id })).incident.updates.length, 1);
}
