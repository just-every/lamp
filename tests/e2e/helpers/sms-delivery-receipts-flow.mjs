import assert from 'node:assert/strict';
import { smsBindings, smsSignature } from './sms-subscriber-flow.mjs';
import { subscriberCsvRows } from './subscriber-management-fixture.mjs';

/** Public publish/callback/log doors; only the Twilio HTTP edge is replaced. */
export async function smsDeliveryReceiptsFlow({ api, post, raw, request = raw, db, flush, messages, pageOrigin }) {
  const created = await post('/api/app/components', { groupId: null, name: 'synthetic-lamp-501', description: '', internal: false, displayOrder: 0, note: '' });
  assert.equal(created.status, 201, created.text);
  const phones = ['+12025550171', '+12025550172', '+12025550173'];
  for (const phone of phones) {
    const added = await post('/api/app/subscribers', { channel: 'sms', phone, componentIds: [created.body.component.id] });
    assert.equal(added.status, 201, added.text);
    const url = `${pageOrigin}/api/public/sms/inbound`;
    const fields = { From: phone, To: smsBindings.TWILIO_FROM_NUMBER, Body: 'YES', MessageSid: `synthetic-lamp-yes-${phone}` };
    const confirmed = await raw(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': smsSignature(url, fields) }, body: new URLSearchParams(fields).toString() });
    assert.equal(confirmed.status, 200, await confirmed.text());
  }
  const make = await post('/api/app/incidents', { title: 'synthetic-lamp-502', components: [{ componentId: created.body.component.id, state: 'Partially unavailable', relationship: 'Primary' }] });
  assert.equal(make.status, 201, make.text);
  const incident = make.body.incident;
  const draft = await api(`/api/app/incidents/${incident.id}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle: 'Identified', affectedAudience: 'Synthetic readers', customerImpact: 'See https://help.example.com/kb/123.', whatStillWorks: '', details: '', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() }) });
  assert.equal(draft.status, 200, draft.text);
  const beforeSend = messages.length;
  const published = await post(`/api/app/incidents/${incident.id}/publish`, { channels: ['sms'] });
  assert.equal(published.status, 200, published.text);
  await flush();
  const sent = messages.slice(beforeSend);
  assert.equal(sent.length, 3, 'one publish sends exactly three requests at the Twilio edge');
  assert.deepEqual(sent.map(row => row.To).sort(), phones);
  for (const message of sent) {
    assert.equal(message.Body, `Synthetic Lamp${message.Body.startsWith('Synthetic Lamp UI:') ? ' UI' : ' follow-ups'}: synthetic-lamp-502. Identified: Synthetic readers See https://help.example.com/kb/123.\n${pageOrigin}/incidents/${incident.reference}`, 'SUB-013 rendered text reaches the edge unchanged, including full URL and outside period');
    assert.deepEqual(Object.keys(message).filter(key => /shorten|track/i.test(key)), []);
    assert.equal(message.StatusCallback, `${pageOrigin}/api/public/sms/status`);
  }
  const updateId = published.body.update.id;
  const log = async (suffix = '') => {
    const result = await api(`/api/app/deliveries?channel=sms&incidentUpdateId=${updateId}${suffix}`);
    assert.equal(result.status, 200, result.text);
    return result.body.deliveries;
  };
  const queued = await log();
  assert.equal(queued.length, 3);
  assert.ok(queued.every(row => row.channel === 'sms' && row.outcome === 'queued' && row.outcomeAt === null && row.subscriberId && row.queuedAt));
  const callback = async (message, status, signature = true) => {
    const url = `${pageOrigin}/api/public/sms/status`, fields = { MessageSid: message.sid, MessageStatus: status };
    return raw(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(signature ? { 'X-Twilio-Signature': signature === true ? smsSignature(url, fields) : signature } : {}) }, body: new URLSearchParams(fields).toString() });
  };
  const storage = async () => (await db.prepare('SELECT * FROM sms_deliveries ORDER BY id').all()).results;
  const beforeInvalid = await storage();
  for (const signature of [false, 'synthetic-lamp-wrong']) {
    const denied = await callback(sent[0], 'delivered', signature);
    assert.equal(denied.status, 401, await denied.text());
  }
  assert.deepEqual(await storage(), beforeInvalid, 'unsigned and incorrect signatures change no SMS row');
  assert.deepEqual(await log(), queued, 'unsigned and incorrect signatures change no delivery-log row');
  for (const message of sent) assert.equal((await callback(message, 'delivered')).status, 200);
  const delivered = await log('&outcome=delivered');
  assert.equal(delivered.length, 3, 'three signed callbacks record three delivered receipts');
  for (const row of delivered) {
    assert.ok(row.outcomeAt && row.queuedAt && row.subscriberId);
    assert.equal(row.incidentUpdateId, updateId);
    assert.equal(row.incidentReference, incident.reference);
    assert.equal(row.providerOutcome, 'delivered');
  }
  assert.equal((await log('&outcome=failed')).length, 0);
  const csv = await request(`/api/app/deliveries.csv?channel=sms&outcome=delivered&incidentUpdateId=${updateId}`);
  assert.equal(csv.status, 200);
  const exported = subscriberCsvRows(await csv.text());
  assert.equal(exported.length, 3);
  for (const row of delivered) {
    const record = exported.find(record => record.destination === `'${row.destination}`);
    assert.ok(record);
    for (const key of ['channel', 'outcome', 'incidentUpdateId', 'queuedAt', 'outcomeAt']) assert.equal(record[key], row[key]);
  }
  // Fresh publications exercise each terminal failure without overwriting a delivered receipt.
  for (const outcome of ['undelivered', 'failed']) {
    const next = await api(`/api/app/incidents/${incident.id}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle: 'Monitoring', affectedAudience: 'Synthetic readers', customerImpact: `synthetic-lamp-${outcome}`, whatStillWorks: '', details: '', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() }) });
    assert.equal(next.status, 200, next.text);
    const offset = messages.length;
    const update = await post(`/api/app/incidents/${incident.id}/publish`, { channels: ['sms'] });
    assert.equal(update.status, 200, update.text);
    await flush();
    assert.equal(messages.length, offset + 3);
    assert.equal((await callback(messages[offset], outcome)).status, 200);
    const failures = await api(`/api/app/deliveries?channel=sms&outcome=failed&incidentUpdateId=${update.body.update.id}`);
    assert.equal(failures.status, 200, failures.text);
    assert.equal(failures.body.deliveries.length, 1);
    assert.equal(failures.body.deliveries[0].providerOutcome, outcome);
    assert.ok(failures.body.deliveries[0].outcomeAt);
  }
  return { phones, incident, updateId };
}
