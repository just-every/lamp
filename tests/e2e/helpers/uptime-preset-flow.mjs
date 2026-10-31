import assert from 'node:assert/strict';
import { intakeByteFlow, intakeInventory } from './intake-byte-flow.mjs';
import { createHmac } from 'node:crypto';

// run-uptime main: notification-content.ts, notification-context.ts and
// timestamped-body-signature.ts. Default body and Lamp-compatible headers.
const secret = 'synthetic-uptime-signing-secret-for-integration';
function envelope(monitorId, key, recovered = false) {
  const at = Date.now() - 90000;
  return { schemaVersion: 2, id: `${key}:${recovered ? 'recovery' : 'trigger'}`, kind: recovered ? 'recovery' : 'trigger', eventType: recovered ? 'uptime.incident.recovered' : 'uptime.incident.firing', incidentKey: key, state: recovered ? 'recovered' : 'firing', title: `${recovered ? 'Recovered' : 'Down'}: Checkout API`, monitorId, monitorRevision: 1, monitorName: 'Checkout API', url: 'https://shop.example.test/health', slotId: key, observedAt: recovered ? Date.now() : at, visibility: 'private', evidenceRef: `/api/monitors/${monitorId}/history`, explanation: 'Confirmed scheduled failure.', probes: [{ name: 'us-east', outcome: recovered ? 'pass' : 'target_failure', reason: recovered ? 'All checks passed' : 'Expected HTTP 200; received 503' }, { name: 'eu-west', outcome: recovered ? 'pass' : 'target_failure', reason: recovered ? 'All checks passed' : 'Expected HTTP 200; received 503' }], consoleUrl: 'https://uptime.example.test', webhookContext: { monitorType: 'http', httpStatusCode: recovered ? 200 : 503, responseTimeMs: 120, ...(recovered ? {} : { failedAssertion: 'status' }) }, incidentContext: { version: 2, confirmedStartedAt: at, confirmedRecoveredAt: recovered ? Date.now() : null, downtimeSeconds: recovered ? 90 : null, originalReason: 'Expected HTTP 200; received 503', failedLocations: [{ probe: 'us-east', name: 'US East', reason: 'HTTP 503' }, { probe: 'eu-west', name: 'EU West', reason: 'HTTP 503' }], timeZone: 'UTC' } };
}
async function send(source, payload, { timestamp = new Date().toISOString(), signingSecret = secret, body = JSON.stringify(payload), signature } = {}) {
  const response = await fetch(source.endpointUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lamp-Timestamp': timestamp, 'X-Lamp-Signature': signature ?? createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('base64url') }, body });
  return { status: response.status, body: await response.json() };
}

export async function uptimePresetFlow({ api, post, component, publicOrigin, sql }) {
  const targets = [await component('Checkout API (Uptime)'), await component('Payments worker (Uptime)')];
  const mappings = targets.map((row, index) => ({ monitorId: index ? 'payments' : 'checkout', componentId: row.id }));
  const input = { name: 'Production Uptime evidence', preset: 'uptime', credentialKind: 'hmac-sha256', signingSecret: secret, monitorMappings: mappings };
  assert.equal((await post('/api/app/intake/sources', { ...input, signingSecret: undefined })).status, 400);
  assert.equal((await post('/api/app/intake/sources', { ...input, monitorMappings: [mappings[0], mappings[0]] })).status, 400);
  const created = await post('/api/app/intake/sources', input);
  assert.equal(created.status, 201, created.text);
  const source = created.body.source;
  assert.equal(source.credentialKind, 'hmac-sha256');
  assert.deepEqual(source.monitorMappings, mappings);
  assert.ok(!(await api('/api/app/intake/sources')).text.includes(secret));
  await intakeByteFlow({ api, post, publicOrigin, source, payload: envelope('checkout', 'incident:exact-bytes'), secret, sql });
  const down = envelope('checkout', 'incident:checkout-first');
  for (const [label, credentials] of [
    ['INTAKE-008 replay outside five minutes', { timestamp: new Date(Date.now() - 6 * 60000).toISOString() }],
    ['wrong signing secret', { signingSecret: 'wrong' }],
    ['signature covers timestamp and exact body', { signature: createHmac('sha256', secret).update(JSON.stringify(down)).digest('base64url') }],
  ]) {
    const before = await intakeInventory(sql);
    assert.equal((await send(source, down, credentials)).status, 401, label);
    assert.deepEqual(await intakeInventory(sql), before, `${label}: no persisted records change`);
  }
  assert.equal((await send(source, { ...down, kind: 'recovery' })).status, 400, 'unconfirmed or inconsistent transitions refused');
  assert.equal((await send(source, envelope('unmapped', 'incident:unmapped'))).status, 400);
  const firing = await send(source, down);
  assert.equal(firing.status, 202, JSON.stringify(firing));
  assert.equal((await send(source, down)).body.incidentId, firing.body.incidentId, 'duplicate webhook stays in one draft');
  const incident = (await api(`/api/app/incidents/${firing.body.incidentId}`)).body.incident;
  assert.deepEqual(incident.components.map(row => row.componentId), [targets[0].id]);
  assert.equal(incident.updates.length, 0);
  const brief = (await api(`/api/app/incidents/${incident.id}/brief`)).body.brief;
  assert.deepEqual(brief.whatWeKnow.alerts[0].payload, down);
  for (const text of ['US East', 'EU West', 'status', new Date(down.incidentContext.confirmedStartedAt).toISOString()]) assert.ok(brief.whatWeKnow.alerts[0].evidenceSummary.includes(text));
  const second = await send(source, envelope('payments', 'incident:checkout-first'));
  assert.notEqual(second.body.incidentId, incident.id, 'monitor identity isolates equal incident keys');
  assert.deepEqual((await api(`/api/app/incidents/${second.body.incidentId}`)).body.incident.components.map(row => row.componentId), [targets[1].id]);
  const recovery = await send(source, { ...down, id: 'recovered-event', kind: 'recovery', state: 'recovered', eventType: 'uptime.incident.recovered' });
  assert.equal(recovery.status, 202);
  assert.equal(recovery.body.incidentId, incident.id);
  assert.equal((await api(`/api/app/incidents/${incident.id}`)).body.incident.lifecycle, 'Resolved');
  assert.ok((await api('/api/app/intake/receipts')).body.receipts.some(row => row.id === recovery.body.receiptId && row.state === 'recovered'));
  assert.equal((await api(`/api/app/incidents/${second.body.incidentId}`)).body.incident.lifecycle, 'Investigating');
  assert.ok(!(await (await fetch(`${publicOrigin}/`)).text()).includes(incident.reference));

  const historical = envelope('checkout', 'incident:older-context');
  delete historical.incidentContext; delete historical.webhookContext;
  const oldResult = await send(source, historical);
  assert.equal(oldResult.status, 202);
  const oldBrief = (await api(`/api/app/incidents/${oldResult.body.incidentId}/brief`)).body.brief;
  assert.ok(oldBrief.whatWeKnow.alerts[0].evidenceSummary.includes('Confirmed failure time: not supplied'));
  const publishedId = second.body.incidentId;
  const draft = { lifecycle: 'Investigating', affectedAudience: 'Customers checking out.', customerImpact: 'Some payments are failing.', whatStillWorks: 'Browsing works.', details: '', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() };
  assert.equal((await api(`/api/app/incidents/${publishedId}/draft`, { method: 'PUT', body: JSON.stringify(draft) })).status, 200);
  assert.equal((await post(`/api/app/incidents/${publishedId}/publish`, { channels: [] })).status, 200);
  assert.equal((await send(source, envelope('payments', 'incident:checkout-first', true))).status, 202);
  assert.equal((await api(`/api/app/incidents/${publishedId}`)).body.incident.lifecycle, 'Investigating', 'INTAKE-008 recovery records evidence but cannot close a published incident');
  const changed = await api(`/api/app/intake/sources/${source.id}`, { method: 'PUT', body: JSON.stringify({ ...input, signingSecret: undefined }) });
  assert.equal(changed.status, 200, changed.text);
  assert.equal((await send(source, envelope('checkout', 'incident:after-edit'))).status, 202, 'blank secret preserves signed connection');
}
