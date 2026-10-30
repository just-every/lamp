import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { silentImportWithQueuedMail } from './silent-import.mjs';

/** The CORE specialist uses real native intake and its declared public host. */
export default async function specialist(context) {
  const { request, origin, cookie, tool } = context;
  const person = async (path, body) => {
    const response = await request(new URL(path, origin).href, {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, `Native specialist ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const call = async (name, args) => {
    const answer = await tool(name, { ...args, idempotency_key: randomUUID() });
    assert.ok(answer.result?.structuredContent && !answer.result.isError, `${name} completes through the agent door (${answer.result?._meta?.['com.runeditrun/error']?.code ?? 'no refusal code'})`);
    return answer.result.structuredContent;
  };
  const component = await call('lamp.components.create', { groupId: null,
    name: 'Specialist API', description: '', internal: false, displayOrder: 0, note: '' });
  const token = `synthetic-lamp-${randomUUID()}`;
  const { source } = await person('/api/app/intake/sources', {
    name: 'Specialist monitor', preset: 'datadog', componentId: component.id, credentialKind: 'bearer-token',
    bearerToken: token, deduplicationPath: 'id', titlePath: 'title', statePath: 'state', recoveredValue: 'resolved',
  });
  assert.notEqual(new URL(source.endpointUrl).origin, origin, 'Intake uses the declared public host');
  const intake = await request(source.endpointUrl, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ alert_id: randomUUID(), alert_title: 'Specialist API delay', alert_transition: 'Triggered' }),
  });
  assert.equal(intake.status, 202, 'Native intake accepts the incident on the public host');
  const accepted = await intake.json();
  assert.ok(accepted.incidentId, 'Accepted intake retains a native incident');
  const id = accepted.incidentId;
  const incident = await call('lamp.incidents.get', { id });
  assert.ok(incident.incident.components.some(row => row.componentId === component.id), 'Native monitor mapping attaches the affected component');
  await call('lamp.incidents.note', { id, body: 'PRIVATE-SPECIALIST-NOTE: monitor evidence is not approval.' });
  const saved = await call('lamp.incidents.draft', { id, draftVersion: incident.draftVersion, update: {
    lifecycle: 'Investigating', affectedAudience: 'Customers using the API',
    customerImpact: 'Some API requests are delayed.', whatStillWorks: 'The dashboard remains available.',
    details: 'The operator is investigating the accepted alert.', nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString(),
  } });
  await call('lamp.incidents.publish', { id, draftVersion: saved.draftVersion });
  const published = await call('lamp.incidents.get', { id });
  const publicIncident = await request(new URL(`/incidents/${published.incident.reference}`, source.endpointUrl).href);
  assert.equal(publicIncident.status, 200, 'Published incident is readable on the public host');
  const publicText = await publicIncident.text();
  assert.ok(publicText.includes(published.incident.title), 'Public incident contains the published incident');
  assert.ok(!publicText.includes('PRIVATE-SPECIALIST-NOTE'), 'Private evidence remains off the public page');

  await silentImportWithQueuedMail(context);
}
