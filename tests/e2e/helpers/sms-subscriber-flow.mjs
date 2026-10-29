import { incidentFollowSmsFlow } from './incident-follow-sms-flow.mjs';
import { smsDeliveryReceiptsFlow } from './sms-delivery-receipts-flow.mjs';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openSubscriberManagementFixture, eventuallySubscriber, pageOrigin, subscriberCsv, subscriberCsvRows } from './subscriber-management-fixture.mjs';

export const smsBindings = {
  TWILIO_ACCOUNT_SID: 'synthetic-lamp-1',
  TWILIO_AUTH_TOKEN: 'synthetic-lamp-2',
  TWILIO_FROM_NUMBER: '+12025550100',
};

/** The fake handles only Twilio's documented HTTP edge. Application consent,
 * callbacks, token management and publication all use the real Worker doors. */
export function smsProviderEdge(messages) {
  return async request => {
    const url = new URL(request.url);
    if (url.origin !== 'https://api.twilio.com') return undefined;
    assert.equal(request.method, 'POST');
    assert.equal(url.pathname, '/2010-04-01/Accounts/synthetic-lamp-1/Messages.json');
    assert.equal(request.headers.get('Authorization'), 'Basic ' + Buffer.from('synthetic-lamp-1:synthetic-lamp-2').toString('base64'));
    const fields = Object.fromEntries(new URLSearchParams(await request.text()));
    assert.equal(fields.From, smsBindings.TWILIO_FROM_NUMBER);
    assert.ok(fields.To && fields.Body);
    assert.deepEqual(Object.keys(fields).filter(key => /shorten|track/i.test(key)), [], 'Twilio receives no shortening or tracking option');
    const sid = `synthetic-lamp-${messages.length + 3}`;
    messages.push({ ...fields, sid });
    return Response.json({ sid, status: 'queued' }, { status: 201 });
  };
}

export function smsSignature(url, fields) {
  return createHmac('sha1', smsBindings.TWILIO_AUTH_TOKEN)
    .update(url + Object.keys(fields).sort().map(key => key + fields[key]).join('')).digest('base64');
}

export async function smsSubscriberFlow() {
  const messages = [];
  const fixture = await openSubscriberManagementFixture({ extraBindings: smsBindings, providerEdge: smsProviderEdge(messages) });
  const { api, post, raw, db } = fixture;
  let inboundSequence = 0;
  const messagesFor = phone => messages.filter(message => message.To === phone);
  const subscribe = async (phone, componentId, kinds = ['incidents', 'maintenance']) => {
    const form = new URLSearchParams({ phone, componentId, preferencesPresent: '1' });
    for (const kind of kinds) form.append('eventKind', kind);
    return raw(`${pageOrigin}/subscribe/sms`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: pageOrigin, Accept: 'text/html', 'CF-Connecting-IP': `192.0.2.${Math.abs([...phone].reduce((value, character) => value + character.charCodeAt(0), 0)) % 200 + 1}` }, body: form.toString() });
  };
  const inbound = async (phone, body, { signature = true, sid } = {}) => {
    const url = `${pageOrigin}/api/public/sms/inbound`;
    const fields = { From: phone, To: smsBindings.TWILIO_FROM_NUMBER, Body: body, MessageSid: sid ?? `synthetic-lamp-inbound-${++inboundSequence}` };
    return raw(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(signature ? { 'X-Twilio-Signature': signature === true ? smsSignature(url, fields) : signature } : {}) }, body: new URLSearchParams(fields).toString() });
  };
  const flush = async () => {
    const result = await (await fixture.runtime.getWorker()).scheduled({ cron: '* * * * *' });
    assert.equal(result.outcome, 'ok', 'ordinary scheduled entry point dispatches committed SMS');
  };
  const publish = async (component, impact, details = '') => {
    const created = await post('/api/app/incidents', { title: 'synthetic-lamp-301', components: [{ componentId: component.id, state: 'Partially unavailable', relationship: 'Primary' }] });
    assert.equal(created.status, 201, created.text);
    const incident = created.body.incident;
    const draft = await api(`/api/app/incidents/${incident.id}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle: 'Identified', affectedAudience: 'Synthetic Lamp readers', customerImpact: impact, whatStillWorks: '', details, nextUpdateAt: new Date(Date.now() + 3600000).toISOString() }) });
    assert.equal(draft.status, 200, draft.text);
    const result = await post(`/api/app/incidents/${incident.id}/publish`, { channels: ['sms'] });
    assert.equal(result.status, 200, result.text);
    await flush();
    await eventuallySubscriber(async () => {
      const response = await raw(`${pageOrigin}/incidents/${incident.reference}`);
      assert.equal(response.status, 200);
      return response.text();
    }, html => html.replace(/<[^>]*>/g, '').includes(impact), 'the exact incident update text is present on its permanent public page');
    return { incident, update: result.body.update };
  };
  try {
    const component = await fixture.createComponent('synthetic-lamp-302');
    const other = await fixture.createComponent('synthetic-lamp-303');
    const phone = '+12025550101', pendingPhone = '+12025550102';
    const settings = await api('/api/app/sms/settings');
    assert.equal(settings.status, 200, settings.text);
    assert.equal(settings.body.configured, true);
    assert.deepEqual(settings.body.settings.countries, ['US', 'CA']);
    const beforeLongControl = await fixture.databaseState();
    const longSupport = await api('/api/app/sms/settings', { method: 'PUT', body: JSON.stringify({ countries: ['US', 'CA'], supportContact: '界'.repeat(120) }) });
    assert.equal(longSupport.status, 400, longSupport.text);
    await fixture.assertUnchanged(beforeLongControl);
    assert.equal(messages.length, 0, 'over-two-segment mandatory control wording is refused without sending');
    const beforeInvalid = await fixture.databaseState();
    const rateBefore = await db.prepare('SELECT COALESCE(SUM(request_count),0) AS count FROM request_rate_windows').first();
    for (const invalid of ['2025550101', '+442055550101', '+12425550106']) {
      const refused = await subscribe(invalid, component.id);
      assert.equal(refused.status, 400, await refused.text());
    }
    const afterInvalid = await fixture.databaseState();
    assert.deepEqual([...afterInvalid.keys()], [...beforeInvalid.keys()]);
    for (const [table, value] of beforeInvalid) if (table !== 'request_rate_windows') assert.equal(afterInvalid.get(table), value, `invalid SMS subscription changed ${table}`);
    const rateAfter = await db.prepare('SELECT COALESCE(SUM(request_count),0) AS count FROM request_rate_windows').first();
    assert.equal(rateAfter.count, rateBefore.count + 3, 'all three refused public requests count against their rate limits');
    assert.equal(messages.length, 0, 'invalid and disabled-country numbers send nothing');
    const enabled = await api('/api/app/sms/settings', { method: 'PUT', body: JSON.stringify({ countries: ['US', 'CA', 'GB'], supportContact: 'https://help.example.com' }) });
    assert.equal(enabled.status, 200, enabled.text);
    const gb = await subscribe('+442055550101', component.id);
    assert.equal(gb.status, 202, await gb.text());
    assert.equal(messagesFor('+442055550101').length, 1, 'owner-enabled country is admitted');
    const canadian = await subscribe('+14165550109', component.id);
    assert.equal(canadian.status, 202, await canadian.text());
    assert.equal(messagesFor('+14165550109').length, 1, 'Canada is admitted by default');
    const optedIn = await subscribe(phone, component.id);
    assert.equal(optedIn.status, 202, await optedIn.text());
    const repeated = await subscribe(phone, component.id);
    assert.equal(repeated.status, 202, await repeated.text());
    assert.equal(messagesFor(phone).length, 1, 'one opt-in per number per 24 hours');
    const wording = messagesFor(phone)[0].Body;
    for (const text of ['Synthetic Lamp follow-ups', 'Msg & data rates may apply', 'HELP', 'STOP']) assert.ok(wording.includes(text), text);
    assert.match(wording, /frequency|messages? (?:vary|per)|updates? (?:vary|per|when|as)/i, 'opt-in states message frequency');
    assert.equal((await subscribe(pendingPhone, component.id)).status, 202);
    const beforeUnsigned = await fixture.databaseState(), sendsBeforeUnsigned = messages.length;
    for (const signature of [false, 'synthetic-lamp-wrong']) {
      const rejected = await inbound(phone, 'YES', { signature });
      assert.equal(rejected.status, 401, await rejected.text());
    }
    await fixture.assertUnchanged(beforeUnsigned);
    assert.equal(messages.length, sendsBeforeUnsigned, 'unsigned/wrong-signature replies neither mutate nor send');
    const confirmedAfter = Date.now();
    const yes = await inbound(phone, 'YES', { sid: 'synthetic-lamp-replayed-yes' });
    assert.equal(yes.status, 200, await yes.text());
    const confirmedBefore = Date.now();
    const replay = await inbound(phone, 'YES', { sid: 'synthetic-lamp-replayed-yes' });
    assert.equal(replay.status, 200, await replay.text());
    const subscriber = (await fixture.list()).find(row => row.destination === phone);
    assert.equal(subscriber.state, 'active');
    const consents = (await db.prepare('SELECT * FROM sms_consents WHERE subscriber_id = ?').bind(subscriber.id).all()).results;
    assert.equal(consents.length, 1, 'signed replay records exactly one consent');
    const consent = JSON.stringify(consents[0]);
    for (const text of [phone, 'Synthetic Lamp follow-ups', wording]) assert.ok(consent.includes(text), 'consent retains number, page and exact opt-in wording');
    assert.ok(Object.values(consents[0]).some(value => typeof value === 'string' && Date.parse(value) >= confirmedAfter && Date.parse(value) <= confirmedBefore), 'consent stores actual YES time');
    const beforeHelp = messagesFor(phone).length;
    assert.equal((await inbound(phone, 'HELP')).status, 200);
    assert.equal(messagesFor(phone).length, beforeHelp + 1);
    assert.ok(messagesFor(phone).at(-1).Body.includes('Synthetic Lamp follow-ups'));
    assert.ok(messagesFor(phone).at(-1).Body.includes('https://help.example.com'));
    const beforePublish = messagesFor(phone).length;
    const first = await publish(component, 'See https://help.example.com/kb/123.');
    assert.equal(messagesFor(phone).length, beforePublish + 1, 'one active selected number receives one publish');
    assert.ok(messagesFor(phone).at(-1).Body.includes('See https://help.example.com/kb/123.'));
    assert.ok(messagesFor(phone).at(-1).Body.includes(`/incidents/${first.incident.reference}`), 'SMS always carries the permanent update link');
    assert.equal(messagesFor(pendingPhone).length, 1, 'number without YES gets only its opt-in');
    const beforeOther = messagesFor(phone).length;
    await publish(other, 'synthetic-lamp-304');
    assert.equal(messagesFor(phone).length, beforeOther, 'component selection suppresses unrelated publication');
    await publish(component, 'Synthetic long update. ' + 'x'.repeat(190), 'y'.repeat(160) + ' https://help.example.com/kb/123. ' + 'z'.repeat(240));
    const shortened = messagesFor(phone).at(-1).Body;
    assert.ok(shortened.length <= 306, 'ASCII SMS is within two concatenated GSM segments');
    assert.match(shortened, /https:\/\/status\.example\.test\/incidents\/\S+/);
    assert.ok(!shortened.includes('https://help.example') || shortened.includes('https://help.example.com/kb/123.'), 'URL at truncation boundary is complete or absent');
    await publish(component, 'http://example.test javascript:alert(1) data:text/html,x');
    const literal = messagesFor(phone).at(-1).Body;
    for (const text of ['http://example.test', 'javascript:alert(1)', 'data:text/html,x']) assert.ok(literal.includes(text), 'non-HTTPS schemes stay literal');

    const resolution = await api(`/api/app/incidents/${first.incident.id}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle: 'Resolved', affectedAudience: 'Synthetic Lamp readers', customerImpact: 'Requests have recovered.', whatStillWorks: '', details: 'Operators verified recovery.', nextUpdateAt: null }) });
    assert.equal(resolution.status, 200, resolution.text);
    const resolved = await post(`/api/app/incidents/${first.incident.id}/publish`, { channels: [] });
    assert.equal(resolved.status, 200, resolved.text);
    const savedReport = await api(`/api/app/incidents/${first.incident.id}/report`, { method: 'PUT', body: JSON.stringify({ summary: 'Report: See https://help.example.com/kb/123.', timeline: 'Operators published the incident and verified recovery.', cause: 'A synthetic queue exhausted its configured capacity.', remediation: 'Operators restored capacity and added a review.' }) });
    assert.equal(savedReport.status, 200, savedReport.text);
    const beforeReport = messagesFor(phone).length;
    const report = await post(`/api/app/incidents/${first.incident.id}/report/publish`, { channels: ['sms'] });
    assert.equal(report.status, 200, report.text);
    await flush();
    assert.equal(messagesFor(phone).length, beforeReport + 1, 'report SMS sends once through the real publication door');
    assert.ok(messagesFor(phone).at(-1).Body.includes('See https://help.example.com/kb/123.'), 'report SMS carries the complete URL with period outside');
    assert.ok(messagesFor(phone).at(-1).Body.includes(`/incidents/${first.incident.reference}`), 'report SMS retains its permanent report link');
    const reportPage = await raw(`${pageOrigin}/incidents/${first.incident.reference}`);
    assert.equal(reportPage.status, 200);
    assert.ok((await reportPage.text()).includes('Report: See'), 'the report SMS link reaches its published report');

    const management = messagesFor(phone).map(message => message.Body).join('\n').match(/https?:\/\/\S+\/manage\/\S+/)?.[0];
    assert.ok(management, 'YES acknowledgement supplies a session-free management capability');
    assert.equal((await raw(management)).status, 200);
    const changed = await raw(management, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: pageOrigin }, body: new URLSearchParams({ componentId: component.id, preferencesPresent: '1', eventKind: 'maintenance' }).toString() });
    assert.equal(changed.status, 200, await changed.text());
    assert.deepEqual((await fixture.list()).find(row => row.id === subscriber.id).preferences.eventKinds, ['maintenance']);
    const beforeExcluded = messagesFor(phone).length;
    await publish(component, 'synthetic-lamp-305');
    assert.equal(messagesFor(phone).length, beforeExcluded, 'maintenance-only SMS receives no incident on the same component');
    const maintenance = await post('/api/app/maintenance', { title: 'synthetic-lamp-306', affectedAudience: 'Synthetic Lamp readers', customerImpact: 'Maintenance starts shortly. See https://help.example.com/kb/123.', startsAt: new Date(Date.now() + 7200000).toISOString(), endsAt: new Date(Date.now() + 10800000).toISOString(), componentIds: [component.id], autoStart: false, autoComplete: false });
    assert.equal(maintenance.status, 201, maintenance.text);
    await flush();
    const beforeStart = messagesFor(phone).length;
    const started = await post(`/api/app/maintenance/${maintenance.body.maintenance.id}/start`);
    assert.equal(started.status, 200, started.text);
    await flush();
    assert.equal(messagesFor(phone).length, beforeStart + 1, 'maintenance-only SMS receives one start notice');
    assert.ok(messagesFor(phone).at(-1).Body.includes('https://help.example.com/kb/123.'), 'maintenance wording inherits intact links');

    const added = await post('/api/app/subscribers', { channel: 'sms', phone: '+12025550103', componentIds: [component.id] });
    assert.equal(added.status, 201, added.text);
    assert.equal(added.body.subscriber.state, 'pending');
    assert.deepEqual(added.body.subscriber.componentSelections.map(row => row.componentId), [component.id]);
    assert.equal(messagesFor('+12025550103').length, 1, 'operator Add sends one opt-in');
    const owner = (await api('/api/app/session')).body.operator;
    assert.deepEqual(added.body.subscriber.addedBy, { id: owner.id, displayName: owner.displayName }, 'SMS Add retains its operator attribution');
    const repeatedAdd = await post('/api/app/subscribers', { channel: 'sms', phone: '+12025550103', componentIds: [other.id] });
    assert.equal(repeatedAdd.status, 200, repeatedAdd.text);
    assert.equal(repeatedAdd.body.created, false);
    assert.equal(repeatedAdd.body.confirmationSent, false);
    assert.deepEqual(repeatedAdd.body.subscriber.componentSelections.map(row => row.componentId), [component.id], 'repeated Add preserves existing choices');
    assert.equal(messagesFor('+12025550103').length, 1, 'repeated Add sends no second opt-in');
    const addAudit = await api('/api/app/audit-log?action=subscriber.added&limit=100');
    assert.equal(addAudit.status, 200, addAudit.text);
    assert.equal(addAudit.body.entries.filter(entry => entry.entityId === added.body.subscriber.id && entry.actorId === owner.id).length, 1, 'SMS Add has one attributed audit entry');
    assert.ok(!addAudit.text.includes('+12025550103'), 'the attributed audit copies no phone number');
    const addedConfirmedAfter = Date.now();
    assert.equal((await inbound('+12025550103', 'YES')).status, 200);
    const addedConfirmedBefore = Date.now();
    const exported = await fixture.request('/api/app/subscribers.csv');
    assert.equal(exported.status, 200);
    const exportedPhone = subscriberCsvRows(await exported.text()).find(row => row.destination === "'+12025550103");
    assert.ok(exportedPhone, 'CSV neutralizes the formula-leading E.164 destination');
    assert.equal(exportedPhone.channel, 'sms');
    assert.equal(exportedPhone.state, 'active');
    assert.equal(exportedPhone.components, component.id);
    assert.ok(Date.parse(exportedPhone.consent_at) >= addedConfirmedAfter && Date.parse(exportedPhone.consent_at) <= addedConfirmedBefore, 'SMS CSV records the actual signed YES consent instant');

    const csv = subscriberCsv(['email', 'phone', 'webhook_url', 'contact_email', 'components', 'language'], [
      ['synthetic-lamp-307@example.test', '', '', '', component.id, 'en'],
      ['', '+12025550104', '', '', component.id, 'en'],
      ['', '+12025550104', '', '', component.id, 'en'],
      ['', '', 'https://receiver.example.test/synthetic-lamp-1', 'synthetic-lamp-308@example.test', component.id, 'en'],
      ['', '2025550105', '', '', component.id, 'en'],
    ]);
    const beforeCsv = await fixture.databaseState(), messagesBeforeCsv = messages.length;
    const preview = await post('/api/app/subscribers/import/preview', { csv });
    assert.equal(preview.status, 200, preview.text);
    assert.deepEqual(preview.body.counts, { created: 3, skipped: 1, refused: 1 });
    await fixture.assertUnchanged(beforeCsv);
    assert.equal(messages.length, messagesBeforeCsv, 'CSV mixed-channel dry run writes and sends nothing');

    const restored = await raw(management, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: pageOrigin }, body: new URLSearchParams([['componentId', component.id], ['preferencesPresent', '1'], ['eventKind', 'incidents'], ['eventKind', 'maintenance']]).toString() });
    assert.equal(restored.status, 200, await restored.text());
    for (const keyword of ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']) {
      const target = keyword === 'STOP' ? phone : `+120255501${10 + ['UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].indexOf(keyword)}`;
      if (target !== phone) { assert.equal((await subscribe(target, component.id)).status, 202); assert.equal((await inbound(target, 'YES')).status, 200); }
      const before = messagesFor(target).length, sid = `synthetic-lamp-stop-${keyword}`;
      const stop = await inbound(target, keyword, { sid });
      assert.equal(stop.status, 200, await stop.text());
      assert.equal((await fixture.list()).find(row => row.destination === target).state, 'deactivated', `${keyword} deactivates immediately`);
      assert.equal(messagesFor(target).length, before + 1, `${keyword} sends one carrier confirmation`);
      assert.equal((await inbound(target, keyword, { sid })).status, 200);
      assert.equal(messagesFor(target).length, before + 1, `${keyword} replay sends no duplicate confirmation`);
    }
    const smsList = (await fixture.list()).filter(row => row.channel === 'sms');
    const smsReport = await api('/api/app/subscriber-reporting?channel=sms');
    assert.equal(smsReport.status, 200, smsReport.text);
    assert.equal(smsReport.body.total, smsList.length, 'SMS reporting equals the operator subscriber list');
    const webhookReport = await api('/api/app/subscriber-reporting?channel=webhook');
    assert.equal(webhookReport.status, 200, webhookReport.text);
    assert.equal(webhookReport.body.total, 0, 'SMS backing storage does not inflate webhook counts');
    const beforeSuppressed = messagesFor(phone).length;
    // STOP revoked management authority, so the former maintenance-only choice
    // cannot be edited with the stale subscriber capability.
    assert.equal((await raw(management)).status, 404);
    await publish(component, 'synthetic-lamp-309');
    assert.equal(messagesFor(phone).length, beforeSuppressed, 'the next publish after STOP sends nothing');
    const suppressed = (await db.prepare("SELECT * FROM sms_deliveries WHERE subscriber_id = ? AND outcome = 'suppressed'").bind(subscriber.id).all()).results;
    assert.ok(suppressed.length, 'next publish records STOP suppression durably');
    assert.equal(messagesFor(pendingPhone).length, 1, 'unconfirmed number never receives publications or maintenance');
    assert.equal((await api(`/api/app/subscribers/${subscriber.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fixture.list()).find(row => row.destination === pendingPhone).state, 'pending', 'erasure preserves unrelated SMS subscribers');
    const erased = await fixture.databaseState();
    for (const [table, data] of erased) assert.ok(!data.includes(phone), `subscriber erasure removes the number from ${table}`);
    await incidentFollowSmsFlow({ fixture, publish, inbound, flush, messagesFor, component, pageOrigin });
    await smsDeliveryReceiptsFlow({ ...fixture, flush, messages, pageOrigin });
  } finally { await fixture.close(); }
}
