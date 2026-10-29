import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { openStatusJourney } from './helpers/status-journey.mjs';
import { recoveryPublicSurfaces, assertRecoveryPublicSurfacesUnchanged } from './helpers/intake-recovery-surfaces.mjs';

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
      deduplicationPath: '$.alert.id', titlePath: '$.alert.title', statePath: '$.alert.state', recoveredValue: 'recovered', componentId: component.id,
    }, 201)).source;
    const alert = async payload => {
      const body = JSON.stringify(payload), at = new Date().toISOString();
      return j.raw(new URL(`/api/intake/${source.id}`, j.publicOrigin).href, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'x-lamp-timestamp': at,
        'x-lamp-signature': createHmac('sha256', 'synthetic-lamp-source-secret').update(`${at}.${body}`).digest('base64url'),
      }, body });
    };
    assert.equal((await j.raw(new URL(`/api/intake/${source.id}`, j.publicOrigin).href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    const payload = { alert: { id: 'checkout-outage', title: 'PRIVATE monitor wording', state: 'firing' } };
    const accepted = await alert(payload); assert.equal(accepted.status, 202);
    const firing = await accepted.json();
    const id = firing.incidentId;
    const replay = await alert(payload); assert.equal(replay.status, 202); assert.equal((await replay.json()).incidentId, id);
    const changed = await alert({ alert: { ...payload.alert, title: 'PRIVATE changed monitor wording' } });
    assert.equal(changed.status, 202);
    const latestFiring = await changed.json();
    assert.equal(latestFiring.incidentId, id);
    assert.equal((await alert({ alert: { title: 'Missing deduplication key', state: 'firing' } })).status, 400);
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
    for (const path of ['/', '/history', '/feed.atom', '/widget.js']) assert.ok(!(await j.publicText(path)).includes(payload.alert.title));
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
    const receipt = async receiptId => {
      const { receipts } = await j.json(`/api/app/intake/receipts?receipt=${receiptId}`);
      assert.equal(receipts.length, 1, 'the returned receipt identity independently addresses one alert');
      return receipts[0];
    };
    const matchingAlert = { sourceId: source.id, sourceName: source.name, deduplicationKey: 'checkout-outage', incidentId: id };
    for (const receiptId of [firing.receiptId, latestFiring.receiptId]) {
      const row = await receipt(receiptId);
      for (const [key, value] of Object.entries(matchingAlert)) assert.equal(row[key], value, key);
      assert.equal(row.id, receiptId);
      assert.equal(row.state, 'firing');
      assert.equal(row.recoveredAt, null);
    }
    const publicBeforeRecovery = await recoveryPublicSurfaces(j);
    for (const path of ['/', '/history', `/incidents/${before.reference}`, '/feed.atom', '/feed.rss', '/history.atom', '/history.rss', '/widget.js', '/embed/script.js', '/badge.svg', '/badge.json', '/api/public/status', '/api/public/v1/incidents.json', '/api/v2/incidents.json']) {
      assert.ok(publicBeforeRecovery.responses.some(row => row.path === path), `${path} participates in recovery invariance`);
    }
    const publishedBeforeRecovery = await j.read(id);
    assert.equal(publishedBeforeRecovery.updates.length, 1, 'the invariance control contains a real publication');
    const publishedRows = async () => (await j.db.prepare('SELECT * FROM incident_updates ORDER BY id').all()).results;
    const updatesBeforeRecovery = await publishedRows();
    assert.equal(updatesBeforeRecovery.length, 1);
    const recoveryStartedAt = Date.now();
    const recoveredResponse = await alert({ alert: { ...payload.alert, state: 'recovered' } });
    const recoveryFinishedAt = Date.now();
    assert.equal(recoveredResponse.status, 202);
    const recovered = await recoveredResponse.json();
    assert.equal(recovered.incidentId, id);
    assert.notEqual(recovered.receiptId, latestFiring.receiptId);
    const recoveryReceipt = await receipt(recovered.receiptId);
    for (const [key, value] of Object.entries(matchingAlert)) assert.equal(recoveryReceipt[key], value, key);
    assert.equal(recoveryReceipt.id, recovered.receiptId);
    assert.equal(recoveryReceipt.state, 'recovered');
    const recoveredAt = Date.parse(recoveryReceipt.recoveredAt);
    assert.ok(recoveredAt >= recoveryStartedAt && recoveredAt <= recoveryFinishedAt, 'the recorded recovery instant falls within the recovery request');
    assert.equal(recoveryReceipt.receivedAt, recoveryReceipt.recoveredAt);
    const recoveredFiring = await receipt(latestFiring.receiptId);
    for (const [key, value] of Object.entries(matchingAlert)) assert.equal(recoveredFiring[key], value, key);
    assert.equal(recoveredFiring.id, latestFiring.receiptId);
    assert.equal(recoveredFiring.state, 'firing');
    assert.equal(recoveredFiring.recoveredAt, recoveryReceipt.recoveredAt, 'recovery is recorded against the matching firing alert');
    assert.equal((await receipt(firing.receiptId)).recoveredAt, null, 'the earlier firing receipt is not mistaken for the latest matching alert');
    assertRecoveryPublicSurfacesUnchanged(publicBeforeRecovery, await recoveryPublicSurfaces(j));
    const afterRecovery = await j.read(id);
    assert.equal(afterRecovery.lifecycle, publishedBeforeRecovery.lifecycle, 'recovery cannot change incident lifecycle');
    assert.deepEqual(afterRecovery.updates, publishedBeforeRecovery.updates, 'recovery cannot change any published update field');
    assert.deepEqual(await publishedRows(), updatesBeforeRecovery, 'recovery cannot add, remove or alter a complete published record');
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
