import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parse } from 'parse5';
import { openSubscriberManagementFixture } from './subscriber-management-fixture.mjs';
import { eventuallyFollowUp } from './follow-ups-runtime.mjs';

const address = name => `${name}${String.fromCharCode(64)}example.test`;
const children = node => node.childNodes ?? [];
const descendants = node => [node, ...children(node).flatMap(descendants)];
const text = node => node.nodeName === '#text' ? node.value : node.tagName === 'br' ? '\n' : children(node).map(text).join('');

function publicReport(html) {
  const reports = descendants(parse(html)).filter(node => node.tagName === 'section' && node.attrs.some(attr => attr.name === 'class' && attr.value.split(' ').includes('report')));
  assert.equal(reports.length, 1, 'the incident permalink contains exactly one report');
  return Object.fromEntries(descendants(reports[0]).filter(node => node.tagName === 'dt').map(label => {
    const value = children(label.parentNode).find(node => node.tagName === 'dd');
    return [text(label).toLowerCase(), children(value).filter(node => node.tagName === 'p').map(text).join('\n\n')];
  }));
}

/** Native report publication with only the mail and webhook network edges fake.
 * Optional screen capture observes the same successfully published permalink. */
export async function reportPublicationFlow({ capture } = {}) {
  const requests = [];
  const f = await openSubscriberManagementFixture({ pageHost: 'localhost', workerEntry: 'tests/e2e/helpers/status-journey.worker.ts', providerEdge: async request => {
    if (new URL(request.url).origin === 'https://receiver.example.test') requests.push({ destination: request.url, body: await request.clone().json() });
  } });
  const json = async (path, method = 'GET', body, status = 200) => {
    const response = await f.api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, status, `${method} ${path}: ${response.text}`);
    return response.body;
  };
  try {
    const component = await f.createComponent('Synthetic Lamp report service');
    const subscribers = [];
    for (const number of [1, 2]) {
      const email = address(`synthetic-lamp-report-reader-${number}`);
      const added = await json('/api/app/subscribers', 'POST', { channel: 'email', email, componentIds: [component.id] }, 201);
      await f.confirm(email);
      subscribers.push({ id: added.subscriber.id, channel: 'email', destination: email });
      const contactEmail = address(`synthetic-lamp-report-contact-${number}`);
      const destination = `https://receiver.example.test/${number === 1 ? 'synthetic-lamp-1' : 'synthetic-lamp-components'}`;
      const webhook = await json('/api/app/subscribers', 'POST', { channel: 'webhook', contactEmail, destination, componentIds: [component.id] }, 201);
      await f.confirm(contactEmail);
      subscribers.push({ id: webhook.subscriber.id, channel: 'webhook', destination });
    }
    f.recoverWebhook();
    assert.deepEqual((await f.list()).map(row => [row.id, row.channel, row.state]).sort(), subscribers.map(row => [row.id, row.channel, 'active']).sort());

    for (const channels of [['email'], ['webhook'], ['email', 'webhook'], []]) {
      const name = channels.join('-') || 'silent';
      const { incident } = await json('/api/app/incidents', 'POST', { title: `Synthetic Lamp ${name} report incident`, components: [{ componentId: component.id, state: 'Major outage', relationship: 'Primary' }] }, 201);
      const path = `/api/app/incidents/${incident.id}`;
      for (const lifecycle of ['Identified', 'Resolved']) {
        await json(`${path}/draft`, 'PUT', { lifecycle, affectedAudience: 'Synthetic Lamp report readers', customerImpact: `${name} service ${lifecycle === 'Resolved' ? 'has recovered' : 'is unavailable'}.`, whatStillWorks: '', details: 'Operators verified the service state.', nextUpdateAt: lifecycle === 'Resolved' ? null : new Date(Date.now() + 3_600_000).toISOString() });
        await json(`${path}/publish`, 'POST', { channels: [] });
      }
      assert.equal((await json(path)).incident.lifecycle, 'Resolved');
      const reportPath = `${path}/report`;
      const fields = {
        summary: `The ${name} service recovered after capacity was restored.`,
        timeline: `${name}: Operators observed exhausted capacity.\nOperators restored the pool and verified recovery.`,
        cause: `The ${name} pool exhausted its configured connections.`,
        remediation: `The ${name} pool now has additional capacity and saturation alerts.`,
      };
      const { report: firstSave } = await json(reportPath, 'PUT', { ...fields, summary: `Initial private ${name} summary.` });
      const { report: saved } = await json(reportPath, 'PUT', fields);
      assert.equal(saved.id, firstSave.id, 'editing retains the one report identity');
      const { report: readback } = await json(reportPath);
      assert.equal(readback.id, firstSave.id);
      assert.equal(readback.incidentId, incident.id);
      assert.equal(readback.publishedAt, null);
      assert.deepEqual(Object.fromEntries(Object.keys(fields).map(key => [key, readback[key]])), fields, 'independent native GET retains all four fields on the resolved incident');
      const permalink = `${f.publicOrigin}/incidents/${incident.reference}`;
      const beforePage = await f.raw(permalink);
      assert.equal(beforePage.status, 200);
      const beforeHtml = await beforePage.text();
      for (const value of Object.values(fields)) assert.ok(!beforeHtml.includes(value), 'saved report wording stays private');

      const mailBefore = f.messages.length, webhookBefore = f.webhookRequests.length, receiptsBefore = f.mailReceipts.length, requestsBefore = requests.length;
      const { report: published } = await json(`${reportPath}/publish`, 'POST', { channels });
      const acknowledged = performance.now();
      assert.equal(published.id, firstSave.id);
      assert.equal(published.incidentId, incident.id);
      assert.ok(Number.isFinite(Date.parse(published.publishedAt)));
      // All fields must appear together on the actual public route under one
      // monotonic deadline, measured from successful publication acknowledgement.
      let html, publicFields;
      do {
        const response = await f.raw(permalink);
        assert.equal(response.status, 200);
        html = await response.text();
        if (html.includes('class="report"')) publicFields = publicReport(html);
        if (publicFields && JSON.stringify(publicFields) === JSON.stringify(fields)) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (performance.now() - acknowledged < 10_000);
      const elapsedMs = performance.now() - acknowledged;
      assert.deepEqual(publicFields, fields, 'the public incident report retains every exact saved field');
      assert.ok(elapsedMs <= 10_000, `public report took ${elapsedMs} ms after successful publication`);

      const expected = subscribers.filter(row => channels.includes(row.channel));
      const deliveries = async () => (await json('/api/app/deliveries?limit=100')).deliveries.filter(row => row.incidentReportId === published.id);
      const committed = await deliveries();
      const identities = rows => rows.map(row => [row.subscriberId, row.channel]).sort();
      assert.deepEqual(identities(committed), expected.map(row => [row.id, row.channel]).sort(), `${name}: exact selected recipients are committed, with none on omitted channels`);
      for (const row of committed) {
        assert.equal(row.incidentReportId, published.id);
        assert.equal(row.incidentReference, incident.reference);
        assert.equal(row.incidentTitle, incident.title);
        assert.equal(row.destination, expected.find(subscriber => subscriber.id === row.subscriberId).destination);
      }
      // Explicit native Queue dispatch also covers the silent case. Waiting for
      // its completion makes omitted-channel silence an observation after work.
      const worker = await f.runtime.getWorker();
      const dispatch = await worker.queue('lamp-follow-ups-jobs', [{ id: `synthetic-lamp-report-${name}`, timestamp: new Date(), attempts: 1, body: { type: 'delivery-dispatch', eventId: published.id } }]);
      assert.equal(dispatch.outcome, 'ok');
      await eventuallyFollowUp(deliveries, rows => rows.every(row => row.channel === 'email' ? Boolean(row.providerAcceptedAt) : row.outcome === 'delivered'), `${name}: all committed transports accept`);
      const mail = f.messages.slice(mailBefore), webhooks = f.webhookRequests.slice(webhookBefore);
      assert.deepEqual(f.mailReceipts.slice(receiptsBefore).map(receipt => receipt.idempotencyKey).sort(), committed.filter(row => row.channel === 'email').map(row => `notification/${row.id}`).sort(), 'provider requests retain the exact committed email delivery identities');
      assert.deepEqual(mail.map(message => message.to).sort(), expected.filter(row => row.channel === 'email').map(row => [row.destination]).sort(), `${name}: exact email destinations, including silence when omitted`);
      for (const message of mail) {
        assert.equal(message.subject, `Synthetic Lamp follow-ups: [${incident.reference}] Post-incident report`);
        for (const value of Object.values(fields)) assert.ok(message.text.includes(value), 'the real mail request carries the saved report');
      }
      const webhookRows = committed.filter(row => row.channel === 'webhook');
      assert.deepEqual(webhooks.map(request => request.body.deliveryId).sort(), webhookRows.map(row => row.id).sort(), `${name}: actual receiver requests match only the committed webhook identities`);
      assert.deepEqual(requests.slice(requestsBefore).map(request => [request.body.deliveryId, request.destination]).sort(), webhookRows.map(row => [row.id, row.destination]).sort(), 'each committed webhook reaches its exact selected endpoint');
      for (const request of webhooks) {
        assert.equal(request.body.event, 'incident.report.published');
        assert.equal(request.body.incident.reference, incident.reference);
        assert.equal(request.body.incident.title, incident.title);
        assert.ok(request.headers['webhook-signature']);
      }
      assert.deepEqual(identities(await deliveries()), identities(committed), 'dispatch retains the committed recipient set');
      const stored = (await f.db.prepare('SELECT id, incident_id FROM incident_reports WHERE incident_id = ?').bind(incident.id).all()).results;
      assert.deepEqual(stored, [{ id: firstSave.id, incident_id: incident.id }], 'one report remains attached to its original incident');
      if (capture && !channels.length) await capture({ fixture: f, permalink, html, fields });
      console.log(`PROBE HIST-002 ${name}: native saved-field readback, public permalink in ${elapsedMs.toFixed(1)} ms, committed=${committed.length}, email=${mail.length}, webhook=${webhooks.length}`);
    }
  } finally { await f.close(); }
}
