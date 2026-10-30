import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { openStatusJourney } from './helpers/status-journey.mjs';

const aiEndpoint = 'https://ai.example.test/v1/chat/completions';

test('INTAKE-001 INTAKE-002 INTAKE-003 INTAKE-004 INTAKE-005 DRAFT-001 DRAFT-002 DRAFT-003 DRAFT-004 AGENT-002 AGENT-004 — authenticated alert to private evidence, cited suggestion and operator-approved recovery even when AI fails', async t => {
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
    const payload = { alert: { id: 'checkout-outage', title: 'PRIVATE monitor wording', state: 'firing' } };
    const originalRequest = signedAlert(payload);
    const accepted = await j.raw(endpoint, originalRequest); assert.equal(accepted.status, 202);
    const original = await accepted.json(), id = original.incidentId;
    assert.ok(id); assert.ok(original.receiptId); assert.equal(original.replayed, false);
    const inventory = async () => {
      const tables = ['incidents', 'incident_drafts', 'alert_receipts'];
      const rows = await j.db.batch(tables.map(table => j.db.prepare(`SELECT * FROM ${table} ORDER BY id`)));
      return Object.fromEntries(tables.map((table, index) => [table, rows[index].results]));
    };
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
    const changed = await alert({ alert: { ...payload.alert, title: 'PRIVATE changed monitor wording' } });
    assert.equal(changed.status, 202);
    const distinct = await changed.json();
    assert.equal(distinct.incidentId, id); assert.notEqual(distinct.receiptId, original.receiptId);
    assert.equal(distinct.replayed, false);
    const afterDistinct = await inventory();
    assert.deepEqual(afterDistinct.incidents, beforeReplay.incidents);
    assert.deepEqual(afterDistinct.incident_drafts, beforeReplay.incident_drafts);
    assert.deepEqual(afterDistinct.alert_receipts.map(row => row.id).sort(), [original.receiptId, distinct.receiptId].sort());
    assert.equal((await alert({ alert: { title: 'Missing deduplication key', state: 'firing' } })).status, 400);
    await j.json(`/api/app/incidents/${id}/components`, 'POST', { componentId: component.id, state: 'Major outage', relationship: 'Primary' }, 201);
    await j.json(`/api/app/incidents/${id}/internal-notes`, 'POST', { body: 'PRIVATE responder investigation' }, 201);
    await j.json(`/api/app/incidents/${id}/components`, 'POST', { componentId: hidden.id, state: 'Major outage', relationship: 'Dependent' }, 201);
    const brief = async (incidentId = id) => {
      const count = requests.length;
      const result = (await j.json(`/api/app/incidents/${incidentId}/brief`)).brief;
      assert.equal(requests.length, count, 'reading a brief never requests a model, even with a configured provider');
      return result;
    };
    const privateBrief = await brief();
    assert.ok(privateBrief.whatWeKnow.alerts.some(row => row.source === source.name));
    assert.ok(privateBrief.whatWeKnow.components.some(row => row.name === component.name));
    const receipts = (await j.json('/api/app/intake/receipts')).receipts
      .filter(row => row.incidentId === id && row.state === 'firing')
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
    assert.deepEqual(receipts.map(row => row.id).sort(), [original.receiptId, distinct.receiptId].sort());
    const expectedAlerts = receipts.map((row, index) => {
      const title = row.id === original.receiptId ? 'PRIVATE monitor wording' : 'PRIVATE changed monitor wording';
      return { ref: `A${index + 1}`, receivedAt: row.receivedAt, source: 'Customer API alerts', state: 'firing', title,
        payload: { alert: { id: 'checkout-outage', title, state: 'firing' } } };
    });
    assert.deepEqual(privateBrief.whatWeKnow, { alerts: expectedAlerts, updates: [],
      components: [{ ref: 'C1', name: 'Checkout API', state: 'Major outage', relationship: 'Primary' }] });
    const unanswered = [
      { ref: 'Q-audience', question: 'Who is affected? No affected-audience statement is written yet.' },
      { ref: 'Q-impact', question: 'What is the customer impact? No customer-impact statement is written yet.' },
      { ref: 'Q-next-update', question: 'When will you update next? The draft has no next-update time.' },
      { ref: 'Q-unpublished-alert', question: 'This draft came from an alert and has never been published. Customers see nothing about it yet.' },
    ];
    assert.deepEqual(privateBrief.whatWeDoNotKnowYet, unanswered);
    assert.deepEqual(await brief(), privateBrief, 'every fact and question retains its reference on another read');
    assert.ok(!JSON.stringify(privateBrief).includes(hidden.name));
    assert.ok(!JSON.stringify(privateBrief).includes('PRIVATE responder investigation'));
    assert.equal((await j.read(id)).updates.length, 0);

    // A fresh incident has no historical component claim to retain after detachment.
    const detached = await j.incident('Synthetic Lamp unattached draft', [component]);
    assert.deepEqual((await j.read(detached.id)).components.map(row => row.componentId), [component.id]);
    await j.json(`/api/app/incidents/${detached.id}/components/${component.id}`, 'DELETE');
    const empty = await j.read(detached.id);
    assert.deepEqual(empty.components, []);
    assert.deepEqual(empty.updates, []);
    const emptyBrief = await brief(detached.id);
    assert.deepEqual(emptyBrief.whatWeKnow, { alerts: [], updates: [], components: [] });
    assert.deepEqual(emptyBrief.whatWeDoNotKnowYet, [
      { ref: 'Q-components', question: 'Which components are affected? None is attached, so this incident cannot be published.' },
      ...unanswered.slice(0, 3),
    ]);
    assert.deepEqual(await brief(detached.id), emptyBrief);
    t.diagnostic('PROBE DRAFT-004 acceptance 2: native component DELETE then incident and brief GET -> empty attachments and exact stable Q-components question');

    for (const path of ['/', '/history', '/feed.atom', '/widget.js']) assert.ok(!(await j.publicText(path)).includes(payload.alert.title));
    const commitment = new Date(Date.now() - 60_000).toISOString();
    await j.save(id, { affectedAudience: 'Checkout customers', customerImpact: 'Some checkout requests fail.', nextUpdateAt: commitment });
    const answered = await brief();
    assert.deepEqual(answered.whatWeDoNotKnowYet, [unanswered[3]], 'saved wording and commitment answer only their questions');
    const before = await j.read(id);
    answer = () => Response.json({ choices: [{ message: { content: JSON.stringify({
      affectedAudience: { text: 'Checkout customers', sources: ['C1'] },
      customerImpact: { text: 'Some checkout requests fail.', sources: ['A999'] },
      whatStillWorks: { text: 'Browsing remains available.', sources: ['C1'] }, details: { text: '', sources: [] },
      lifecycle: 'Resolved', nextUpdateAt: '2099-01-01T00:00:00.000Z',
    }) } }] });
    const suggested = await j.json(`/api/app/incidents/${id}/ai-suggestion`, 'POST', {});
    assert.equal(requests.length, 1, 'only the explicit suggestion crosses the provider boundary');
    assert.deepEqual(suggested.brief, answered);
    assert.deepEqual(JSON.parse(requests.at(-1).messages.find(row => row.role === 'user').content), suggested.brief);
    assert.ok(!JSON.stringify(requests.at(-1)).includes('PRIVATE responder investigation'));
    assert.ok(!JSON.stringify(requests.at(-1)).includes(hidden.name));
    assert.equal(suggested.suggestion.affectedAudience.text, 'Checkout customers');
    assert.deepEqual(suggested.suggestion.customerImpact.sources, []);
    assert.ok(!('lifecycle' in suggested.suggestion) && !('nextUpdateAt' in suggested.suggestion));
    assert.deepEqual((await j.read(id)).draft, before.draft);
    assert.deepEqual((await j.read(id)).updates, before.updates);
    const published = (await j.publish(id)).update;
    const publishedBrief = await brief();
    assert.deepEqual(publishedBrief.whatWeKnow.updates, [{ ref: 'U1', lifecycle: 'Identified',
      affectedAudience: before.draft.affectedAudience, customerImpact: before.draft.customerImpact,
      whatStillWorks: before.draft.whatStillWorks, details: before.draft.details,
      nextUpdateAt: commitment, publishedAt: published.publishedAt }]);
    assert.deepEqual(publishedBrief.whatWeDoNotKnowYet, [
      { ref: 'Q-overdue', question: 'The next update this incident promised is overdue.', at: commitment },
    ]);
    await j.visible(`/incidents/${before.reference}`, 'Some checkout requests fail.');
    const recoveredResponse = await alert({ alert: { ...payload.alert, state: 'recovered' } });
    assert.equal(recoveredResponse.status, 202);
    const recovered = await recoveredResponse.json();
    const recoveryReceipt = (await j.json(`/api/app/intake/receipts?receipt=${recovered.receiptId}`)).receipts[0];
    const recoveredBrief = await brief();
    assert.deepEqual(recoveredBrief.whatWeKnow.alerts, [...expectedAlerts, {
      ref: 'A3', receivedAt: recoveryReceipt.receivedAt, source: 'Customer API alerts', state: 'recovered',
      title: 'PRIVATE monitor wording', payload: { alert: { ...payload.alert, state: 'recovered' } },
    }]);
    assert.deepEqual(recoveredBrief.whatWeDoNotKnowYet, [
      { ref: 'Q-recovery', question: 'The monitor reports recovery; confirm, then publish Resolved.', at: recoveryReceipt.receivedAt },
      publishedBrief.whatWeDoNotKnowYet[0],
    ]);
    assert.deepEqual(await brief(), recoveredBrief);
    t.diagnostic('PROBE DRAFT-004 acceptance 5: repeated native brief GETs before and after explicit suggestion -> provider counts stay 0 and 1 respectively; saved facts, references and questions reconcile');
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
    const finalBrief = await brief();
    assert.deepEqual(finalBrief.whatWeDoNotKnowYet, []);
    assert.deepEqual(finalBrief.whatWeKnow.updates, [...publishedBrief.whatWeKnow.updates, {
      ref: 'U2', lifecycle: 'Resolved', affectedAudience: resolved.affectedAudience, customerImpact: 'Checkout has recovered.',
      whatStillWorks: resolved.whatStillWorks, details: resolved.details, nextUpdateAt: null, publishedAt: resolved.publishedAt,
    }]);
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
