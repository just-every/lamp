import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { openStatusJourney } from './helpers/status-journey.mjs';

const aiEndpoint = 'https://ai.example.test/v1/chat/completions';

test('INTAKE-001 INTAKE-002 INTAKE-003 INTAKE-004 INTAKE-005 DRAFT-001 DRAFT-002 DRAFT-003 DRAFT-004 AGENT-002 AGENT-004 — authenticated alert to private evidence, cited suggestion and operator-approved recovery even when AI fails', async () => {
  const requests = [];
  let answer = () => Response.json({ error: 'Provider unavailable' }, { status: 503 });
  const j = await openStatusJourney({ extraBindings: { AI_PROVIDER_URL: aiEndpoint, AI_PROVIDER_API_KEY: 'synthetic-lamp-ai-key', AI_PROVIDER_MODEL: 'synthetic-lamp-model' }, providerEdge: async request => {
    if (request.url === aiEndpoint) { requests.push(await request.json()); return answer(); }
  } });
  try {
    const component = await j.component('Checkout API');
    const hidden = await j.component('PRIVATE internal service', { internal: true });
    const source = (await j.json('/api/app/intake/sources', 'POST', {
      name: 'Customer API alerts', credentialKind: 'hmac-sha256', signingSecret: 'synthetic-lamp-source-secret',
      deduplicationPath: '$.monitor.identity.key', titlePath: '$.monitor.presentation.summary', statePath: '$.monitor.health.phase', recoveredValue: 'service-restored', componentId: component.id,
    }, 201)).source;
    const savedSource = (await j.json('/api/app/intake/sources')).sources.find(row => row.id === source.id);
    assert.ok(savedSource);
    assert.equal(savedSource.deduplicationPath, '$.monitor.identity.key');
    assert.equal(savedSource.titlePath, '$.monitor.presentation.summary');
    assert.equal(savedSource.statePath, '$.monitor.health.phase');
    assert.equal(savedSource.recoveredValue, 'service-restored');
    const receipt = async receiptId => {
      const rows = (await j.json(`/api/app/intake/receipts?receipt=${receiptId}`)).receipts;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, receiptId);
      assert.equal(rows[0].sourceId, source.id);
      assert.equal(rows[0].sourceName, 'Customer API alerts');
      return rows[0];
    };
    const endpoint = new URL(`/api/intake/${source.id}`, j.publicOrigin).href;
    const signedAlert = payload => {
      const body = JSON.stringify(payload), at = new Date().toISOString();
      return { method: 'POST', headers: {
        'Content-Type': 'application/json', 'x-lamp-timestamp': at,
        'x-lamp-signature': createHmac('sha256', 'synthetic-lamp-source-secret').update(`${at}.${body}`).digest('base64url'),
      }, body };
    };
    const alert = payload => j.raw(endpoint, signedAlert(payload));
    assert.equal((await j.raw(new URL(`/api/intake/${source.id}`, j.publicOrigin).href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    const payload = {
      alert: { id: 'unmapped-key', title: 'PRIVATE unmapped title', state: 'recovered' },
      monitor: { identity: { key: 'checkout-outage' }, presentation: { summary: 'PRIVATE monitor wording' }, health: { phase: 'service-unhealthy' } },
    };
    const originalRequest = signedAlert(payload);
    const accepted = await j.raw(endpoint, originalRequest); assert.equal(accepted.status, 202);
    const original = await accepted.json(), id = original.incidentId;
    assert.ok(id); assert.ok(original.receiptId); assert.equal(original.replayed, false);
    const inventory = async () => {
      const tables = ['incidents', 'incident_drafts', 'alert_receipts'];
      const rows = await j.db.batch(tables.map(table => j.db.prepare(`SELECT * FROM ${table} ORDER BY id`)));
      return Object.fromEntries(tables.map((table, index) => [table, rows[index].results]));
    };
    assert.equal((await j.read(id)).title, 'PRIVATE monitor wording');
    const firing = await receipt(original.receiptId);
    assert.equal(firing.deduplicationKey, 'checkout-outage');
    assert.equal(firing.incidentId, id);
    assert.equal(firing.state, 'firing');
    assert.equal(firing.error, null);
    const beforeReplay = await inventory();
    assert.deepEqual(beforeReplay.incidents.map(row => row.id), [id]);
    assert.deepEqual(beforeReplay.incident_drafts.map(row => row.incident_id), [id]);
    assert.deepEqual(beforeReplay.alert_receipts.map(row => row.id), [original.receiptId]);
    // Reuse the body, timestamp and signature while the original authentication is valid.
    const replay = await j.raw(endpoint, originalRequest);
    assert.equal(replay.status, accepted.status);
    const replayed = await replay.json();
    assert.equal(replayed.incidentId, id); assert.equal(replayed.receiptId, original.receiptId);
    assert.equal(replayed.replayed, true);
    assert.deepEqual(await inventory(), beforeReplay, 'accepted replay leaves every incident, draft and alert receipt unchanged');
    const changed = await alert({ ...payload, monitor: { ...payload.monitor, presentation: { summary: 'PRIVATE changed monitor wording' } } });
    assert.equal(changed.status, 202);
    const distinct = await changed.json();
    assert.equal(distinct.incidentId, id); assert.notEqual(distinct.receiptId, original.receiptId);
    assert.equal(distinct.replayed, false);
    const afterDistinct = await inventory();
    assert.deepEqual(afterDistinct.incidents, beforeReplay.incidents);
    assert.deepEqual(afterDistinct.incident_drafts, beforeReplay.incident_drafts);
    assert.deepEqual(afterDistinct.alert_receipts.map(row => row.id).sort(), [original.receiptId, distinct.receiptId].sort());
    const missingKey = await alert({ ...payload, monitor: { ...payload.monitor, identity: {} } });
    assert.equal(missingKey.status, 400);
    const invalid = await receipt((await missingKey.json()).receiptId);
    assert.equal(invalid.state, 'invalid');
    assert.equal(invalid.deduplicationKey, null);
    assert.equal(invalid.incidentId, null);
    assert.equal(invalid.error, 'The configured deduplication path did not produce a string.');
    await j.json(`/api/app/incidents/${id}/components`, 'POST', { componentId: component.id, state: 'Major outage', relationship: 'Primary' }, 201);
    await j.json(`/api/app/incidents/${id}/internal-notes`, 'POST', { body: 'PRIVATE responder investigation' }, 201);
    await j.json(`/api/app/incidents/${id}/components`, 'POST', { componentId: hidden.id, state: 'Major outage', relationship: 'Dependent' }, 201);
    const brief = async () => (await j.json(`/api/app/incidents/${id}/brief`)).brief;
    const privateBrief = await brief();
    assert.ok(privateBrief.whatWeKnow.alerts.some(row => row.source === source.name));
    assert.ok(privateBrief.whatWeKnow.components.some(row => row.name === component.name));
    assert.ok(!JSON.stringify(privateBrief).includes(hidden.name));
    assert.ok(!JSON.stringify(privateBrief).includes('PRIVATE responder investigation'));
    assert.equal((await j.read(id)).updates.length, 0);
    for (const path of ['/', '/history', '/feed.atom', '/widget.js']) assert.ok(!(await j.publicText(path)).includes(payload.monitor.presentation.summary));
    await j.save(id, { affectedAudience: 'Checkout customers', customerImpact: 'Some checkout requests fail.' });
    const before = await j.read(id);
    answer = () => Response.json({ choices: [{ message: { content: JSON.stringify({
      affectedAudience: { text: 'Checkout customers', sources: ['C1'] },
      customerImpact: { text: 'Some checkout requests fail.', sources: ['A999'] },
      whatStillWorks: { text: 'Browsing remains available.', sources: ['C1'] }, details: { text: '', sources: [] },
      lifecycle: 'Resolved', nextUpdateAt: '2099-01-01T00:00:00.000Z',
    }) } }] });
    const suggested = await j.json(`/api/app/incidents/${id}/ai-suggestion`, 'POST', {});
    assert.deepEqual(JSON.parse(requests.at(-1).messages.find(row => row.role === 'user').content), suggested.brief);
    assert.ok(!JSON.stringify(requests.at(-1)).includes('PRIVATE responder investigation'));
    assert.ok(!JSON.stringify(requests.at(-1)).includes(hidden.name));
    assert.equal(suggested.suggestion.affectedAudience.text, 'Checkout customers');
    assert.deepEqual(suggested.suggestion.customerImpact.sources, []);
    assert.ok(!('lifecycle' in suggested.suggestion) && !('nextUpdateAt' in suggested.suggestion));
    assert.deepEqual((await j.read(id)).draft, before.draft);
    assert.deepEqual((await j.read(id)).updates, before.updates);
    await j.publish(id);
    await j.visible(`/incidents/${before.reference}`, 'Some checkout requests fail.');
    const recovered = await alert({ ...payload, monitor: { ...payload.monitor, health: { phase: 'service-restored' } } });
    assert.equal(recovered.status, 202);
    const recoveredResult = await recovered.json();
    assert.equal(recoveredResult.incidentId, id);
    const recoveredReceipt = await receipt(recoveredResult.receiptId);
    assert.equal(recoveredReceipt.deduplicationKey, 'checkout-outage');
    assert.equal(recoveredReceipt.incidentId, id);
    assert.equal(recoveredReceipt.state, 'recovered');
    assert.equal(recoveredReceipt.error, null);
    const recovery = (await j.json(`/api/app/incidents/${id}/recovery-check`)).recovery;
    assert.equal(recovery.passed, false);
    assert.ok(recovery.items.some(row => row.state === 'holding'));
    assert.equal((await j.read(id)).lifecycle, 'Identified');
    answer = () => Response.json({ error: 'Provider down' }, { status: 500 });
    const failed = await j.api(`/api/app/incidents/${id}/ai-suggestion`, { method: 'POST', body: '{}' });
    assert.equal(failed.status, 502); assert.ok(failed.body.error);
    await j.save(id, { lifecycle: 'Resolved', customerImpact: 'Checkout has recovered.', nextUpdateAt: null });
    await j.publish(id, {}, 409);
    const reason = 'Operator verified customer checkout recovery';
    const resolved = (await j.publish(id, { overrideReason: reason })).update;
    assert.equal((await j.read(id)).lifecycle, 'Resolved');
    const audit = await j.json('/api/app/audit-log?limit=100');
    assert.ok(audit.entries.some(row => row.reason === reason && row.actorId && row.entityId === resolved.id), 'the publishing operator and incident are recorded with the private override reason');
    assert.ok((await j.read(id)).internalNotes.some(row => row.body.includes(reason)));
    assert.ok(!(await j.publicText(`/incidents/${before.reference}`)).includes(reason));
    await j.visible(`/incidents/${before.reference}`, 'Checkout has recovered.');
  } finally { await j.close(); }
  const without = await openStatusJourney();
  try {
    const component = await without.component('Provider-free API');
    const incident = await without.incident('Provider-free recovery', [component]);
    assert.equal((await without.json('/api/app/ai/status')).configured, false);
    await without.json(`/api/app/incidents/${incident.id}/ai-suggestion`, 'POST', {}, 404);
    await without.save(incident.id); await without.publish(incident.id);
    assert.ok((await without.json(`/api/app/incidents/${incident.id}/brief`)).brief);
  } finally { await without.close(); }
});
