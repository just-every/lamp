import assert from 'node:assert/strict';
import { openSubscriberManagementFixture, eventuallySubscriber } from './subscriber-management-fixture.mjs';

/** One real publication, five deadline-bound retries, then a visible terminal
 * failure. Only Worker time and the receiver's HTTP response are controlled. */
export async function deliveryRetryFlow(t) {
  const destination = 'https://receiver.example.test/synthetic-lamp-retry';
  const requests = [];
  const fixture = await openSubscriberManagementFixture({
    workerEntry: 'tests/e2e/helpers/automation-clock-worker.ts',
    providerEdge: async request => {
      if (request.url !== destination) return;
      requests.push({ headers: Object.fromEntries(request.headers), body: await request.json() });
      return new Response(null, { status: 503 });
    },
  });
  try {
    const { api, post, raw, db } = fixture;
    const worker = await fixture.runtime.getWorker();
    const advance = async now => assert.equal((await raw('/test/clock', { method: 'PUT', body: JSON.stringify({ now }) })).status, 204);
    const initialAt = Date.now() + 10_000;
    await advance(initialAt);
    const component = await fixture.createComponent('Synthetic Lamp retry API');
    const contact = ['synthetic-lamp-retry-contact', 'example.test'].join('@');
    const added = await post('/api/app/subscribers', { channel: 'webhook', destination, contactEmail: contact, componentIds: [component.id] });
    assert.equal(added.status, 201, added.text);
    const subscriberId = added.body.subscriber.id;
    await fixture.confirm(contact);
    assert.equal((await fixture.list()).find(row => row.id === subscriberId).state, 'active');
    const created = await post('/api/app/incidents', { title: 'Synthetic Lamp retry incident', components: [{ componentId: component.id, state: 'Partially unavailable', relationship: 'Primary' }] });
    assert.equal(created.status, 201, created.text);
    const incidentId = created.body.incident.id;
    const saved = await api(`/api/app/incidents/${incidentId}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle: 'Identified', affectedAudience: 'Synthetic Lamp customers', customerImpact: 'Requests are delayed.', whatStillWorks: 'Reads continue.', details: 'Operators are investigating.', nextUpdateAt: new Date(initialAt + 7_200_000).toISOString() }) });
    assert.equal(saved.status, 200, saved.text);
    const published = await post(`/api/app/incidents/${incidentId}/publish`, { channels: ['webhook'] });
    assert.equal(published.status, 200, published.text);
    const updateId = published.body.update.id;
    const read = async () => {
      const response = await api(`/api/app/deliveries?incidentUpdateId=${updateId}&limit=100`);
      assert.equal(response.status, 200, response.text);
      assert.equal(response.body.deliveries.length, 1, 'publication captures only the intended recipient');
      return response.body.deliveries[0];
    };
    const first = await eventuallySubscriber(read, row => row.outcome === 'queued' && requests.length === 1 && row.latestError === 'Webhook destination returned 503.', 'inline publication records the initial failed receiver request');
    assert.equal(first.subscriberId, subscriberId);
    assert.equal(first.incidentUpdateId, updateId);
    const attempts = async () => (await db.prepare('SELECT attempt_number,attempted_at,error FROM notification_attempt_records WHERE delivery_id=? ORDER BY attempt_number').bind(first.id).all()).results;
    const outbox = async () => db.prepare("SELECT available_at,completed_at,failed_at FROM notification_outbox WHERE kind='delivery-dispatch' AND aggregate_id=?").bind(updateId).first();
    const queue = async number => worker.queue('lamp-follow-ups-jobs', [{ id: `synthetic-lamp-retry-${number}`, timestamp: new Date(), attempts: number, body: { type: 'delivery-dispatch', eventId: updateId } }]);
    const cron = async now => {
      const result = await worker.scheduled({ cron: '* * * * *', scheduledTime: now });
      assert.equal(result.outcome, 'ok', 'the native Cron handler completes');
    };
    // Independent expected instants: doubling gaps normalized to one hour,
    // written here without importing or reading the production retry policy.
    const offsets = [0, 116_129, 348_387, 812_903, 1_741_935, 3_600_000];
    for (let retry = 1; retry <= 5; retry++) {
      const deadline = initialAt + offsets[retry];
      await eventuallySubscriber(outbox, row => row.available_at === new Date(deadline).toISOString(), 'all dispatch doors persist the same next wakeup');
      await advance(deadline - 1);
      await cron(deadline - 1);
      await queue(retry * 10);
      await queue(retry * 10 + 1);
      assert.equal(requests.length, retry, 'Cron and repeated early Queue delivery cannot consume a retry');
      assert.equal((await attempts()).length, retry, 'no fictitious attempt is recorded before eligibility');
      assert.equal((await read()).outcome, 'queued');
      await advance(deadline);
      // Alternate the actual dispatch door. A second door at the same instant
      // must observe the committed attempt rather than sending it again.
      if (retry % 2) await queue(retry * 10 + 2); else await cron(deadline);
      const expectedOutcome = retry === 5 ? 'failed' : 'queued';
      await eventuallySubscriber(read, row => row.outcome === expectedOutcome && requests.length === retry + 1, 'the receiver is attempted exactly at eligibility');
      await cron(deadline);
      await queue(retry * 10 + 3);
      assert.equal(requests.length, retry + 1, 'the competing dispatch door cannot send another request at this instant');
      assert.deepEqual((await attempts()).map(row => row.attempted_at), offsets.slice(0, retry + 1).map(offset => new Date(initialAt + offset).toISOString()));
    }
    const failed = await read();
    assert.equal(failed.id, first.id);
    assert.equal(failed.subscriberId, subscriberId);
    assert.equal(failed.incidentUpdateId, updateId);
    assert.equal(failed.outcome, 'failed');
    assert.equal(failed.outcomeAt, new Date(initialAt + 3_600_000).toISOString());
    assert.equal(failed.latestError, 'Webhook destination returned 503.');
    assert.deepEqual((await attempts()).map(row => row.attempt_number), [1, 2, 3, 4, 5, 6]);
    assert.ok((await attempts()).every(row => row.error === 'Webhook destination returned 503.'));
    assert.equal(requests.length, 6, 'one initial receiver request plus exactly five actual webhook retries');
    for (const request of requests) {
      assert.equal(request.headers['webhook-id'], first.id);
      assert.equal(request.body.deliveryId, first.id);
      assert.equal(request.body.updates.at(-1).id, updateId);
      assert.equal(request.body.incident.reference, created.body.incident.reference);
    }
    const failures = await (await raw('/test/delivery-failures')).json();
    assert.deepEqual(failures, [{ deliveryId: first.id, subscriberId, notificationEventId: updateId, failedAt: failed.outcomeAt }], 'the real failure event retains the original subscriber and update identity');
    assert.ok((await outbox()).completed_at, 'exhausted delivery leaves no retrying event work');
    const before = await attempts();
    await advance(initialAt + 7_200_000);
    await cron(initialAt + 7_200_000);
    await queue(99);
    assert.equal(requests.length, 6, 'later Cron and Queue replay remain silent after terminal failure');
    assert.deepEqual(await attempts(), before, 'terminal replay creates no additional attempt');
    assert.deepEqual(await (await raw('/test/delivery-failures')).json(), failures, 'terminal replay emits no duplicate failure event');
    const filtered = await api(`/api/app/deliveries?channel=webhook&outcome=failed&incidentUpdateId=${updateId}`);
    assert.equal(filtered.status, 200, filtered.text);
    assert.deepEqual(filtered.body.deliveries.map(row => row.id), [first.id], 'the operator can find this subscriber and update terminal failure');
    t.diagnostic(`PROBE NOTIFY-003 1: native publish and actual Queue and Cron receiver dispatch -> six HTTP 503 requests, attempts 1 through 6.`);
    t.diagnostic(`PROBE NOTIFY-003 2: controlled Worker clock -> no early requests; exact offsets ${offsets.join(',')} ms; final retry at one hour.`);
    t.diagnostic('PROBE NOTIFY-003 3: native delivery log and failure event -> original subscriber and update, failed at one hour, later replay silent.');
  } finally { await fixture.close(); }
}
