import assert from 'node:assert/strict';
import { openSubscriberManagementFixture, eventuallySubscriber } from './subscriber-management-fixture.mjs';

/** Hold only the receiver acknowledgement; publication, recipient capture and
 * competing dispatches all traverse the native HTTP and Worker Queue doors. */
export async function webhookAtMostOnceFlow() {
  let acknowledge, receiverEntered = false;
  const acknowledgement = new Promise(resolve => { acknowledge = resolve; });
  const fixture = await openSubscriberManagementFixture({
    workerEntry: 'tests/e2e/helpers/status-journey.worker.ts',
    webhookReceiver: async () => {
      // Let a duplicate finish so the competing Queue call exposes it promptly.
      if (!receiverEntered) {
        receiverEntered = true;
        await acknowledgement;
      }
      return new Response(null, { status: 204 });
    },
  });
  const pending = [];
  const pause = async paused => assert.equal((await fixture.raw('/test/effects', {
    method: 'PUT', body: JSON.stringify({ paused }),
  })).status, 204);
  try {
    fixture.recoverWebhook();
    const component = await fixture.createComponent('Synthetic Lamp isolated webhook');
    const contact = ['synthetic-lamp-once', 'example.test'].join('@');
    const added = await fixture.post('/api/app/subscribers', {
      channel: 'webhook', destination: 'https://receiver.example.test/synthetic-lamp-1',
      contactEmail: contact, componentIds: [component.id], eventKinds: ['incidents'],
    });
    assert.equal(added.status, 201, added.text);
    assert.equal(added.body.subscriber.state, 'pending');
    await fixture.confirm(contact);
    assert.equal((await fixture.list()).find(row => row.id === added.body.subscriber.id).state, 'active');

    await pause(true);
    const created = await fixture.post('/api/app/incidents', {
      title: 'Synthetic Lamp isolated delivery',
      components: [{ componentId: component.id, state: 'Partially unavailable', relationship: 'Primary' }],
    });
    assert.equal(created.status, 201, created.text);
    const incidentId = created.body.incident.id;
    const saved = await fixture.api(`/api/app/incidents/${incidentId}/draft`, {
      method: 'PUT', body: JSON.stringify({ lifecycle: 'Identified', affectedAudience: 'Synthetic Lamp readers',
        customerImpact: 'Requests are delayed.', whatStillWorks: 'The dashboard is available.',
        details: 'Operators are restoring service.', nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() }),
    });
    assert.equal(saved.status, 200, saved.text);
    const beforePublish = await fixture.api(`/api/app/incidents/${incidentId}`);
    assert.equal(beforePublish.status, 200, beforePublish.text);
    const revision = `${beforePublish.body.incident.draft.id}:${beforePublish.body.incident.updates.length}`;
    const publishPath = `/api/app/incidents/${incidentId}/publish`;
    const publicationRequest = { method: 'POST', headers: { 'If-Match': revision }, body: JSON.stringify({ channels: ['webhook'] }) };
    const published = await fixture.api(publishPath, publicationRequest);
    assert.equal(published.status, 200, published.text);
    const updateId = published.body.update.id;
    assert.equal(updateId, saved.body.draft.id);
    const deliveries = async () => {
      const response = await fixture.api(`/api/app/deliveries?incidentUpdateId=${updateId}&limit=100`);
      assert.equal(response.status, 200, response.text);
      return response.body.deliveries;
    };
    const committed = await deliveries();
    assert.equal(committed.length, 1, 'exactly one selected webhook recipient is committed');
    const deliveryId = committed[0].id;
    assert.equal(committed[0].subscriberId, added.body.subscriber.id);
    assert.equal(committed[0].channel, 'webhook');
    assert.equal(committed[0].outcome, 'queued');
    assert.equal(fixture.webhookRequests.length, 0, 'publication commits before any receiver request');
    const identities = async () => ({
      updates: (await fixture.db.prepare('SELECT id, incident_id FROM incident_updates ORDER BY id').all()).results,
      recipients: (await fixture.db.prepare('SELECT id, notification_event_id, subscriber_id, channel, incident_update_id FROM notification_delivery_records ORDER BY id').all()).results,
      outbox: (await fixture.db.prepare('SELECT id, kind, aggregate_id FROM notification_outbox ORDER BY id').all()).results,
    });
    const original = await identities();
    assert.deepEqual(original.updates, [{ id: updateId, incident_id: incidentId }]);
    assert.deepEqual(original.recipients, [{ id: deliveryId, notification_event_id: updateId,
      subscriber_id: added.body.subscriber.id, channel: 'webhook', incident_update_id: updateId }]);
    assert.equal(original.outbox.filter(row => row.kind === 'delivery-dispatch' && row.aggregate_id === updateId).length, 1);

    const worker = await fixture.runtime.getWorker();
    const dispatch = attempt => {
      const result = worker.queue('lamp-follow-ups-jobs', [{ id: `synthetic-lamp-once-${attempt}`,
        timestamp: new Date(), attempts: attempt, body: { type: 'delivery-dispatch', eventId: updateId } }]);
      pending.push(result);
      return result;
    };
    await pause(false);
    const first = dispatch(1);
    await eventuallySubscriber(() => receiverEntered, Boolean, 'the first real Queue dispatch reaches the receiver');
    const competitors = await Promise.all([dispatch(2), dispatch(3)]);
    for (const result of competitors) assert.equal(result.outcome, 'ok');
    assert.equal(fixture.webhookRequests.length, 1, 'competing Queue dispatches make only one receiver request before acknowledgement');
    assert.equal((await deliveries())[0].outcome, 'queued', 'the receiver has not yet acknowledged success');
    assert.deepEqual(await identities(), original, 'competing dispatches preserve the committed identities');
    acknowledge();
    assert.equal((await first).outcome, 'ok');
    const delivered = await eventuallySubscriber(deliveries, rows => rows.length === 1 && rows[0].outcome === 'delivered', 'receiver acknowledgement completes the exact delivery');
    assert.equal(delivered[0].id, deliveryId);

    assert.equal((await dispatch(4)).outcome, 'ok', 'the real Queue accepts redelivery after success');
    const replay = await fixture.api(publishPath, publicationRequest);
    assert.equal(replay.status, 409, 'the original acknowledged draft revision cannot republish a consumed draft');
    assert.deepEqual(await identities(), original, 'publication retry and Queue redelivery create no update, recipient or outbox identity');
    const incident = await fixture.api(`/api/app/incidents/${incidentId}`);
    assert.equal(incident.status, 200, incident.text);
    assert.deepEqual(incident.body.incident.updates.map(row => row.id), [updateId]);
    assert.deepEqual((await deliveries()).map(row => ({ id: row.id, outcome: row.outcome })), [{ id: deliveryId, outcome: 'delivered' }]);
    assert.equal(fixture.webhookRequests.length, 1, 'the isolated delivery crosses the receiver edge exactly once across every retry');
    const [received] = fixture.webhookRequests;
    assert.equal(received.headers['webhook-id'], deliveryId);
    assert.equal(received.body.deliveryId, deliveryId);
    assert.deepEqual(received.body.updates.map(row => row.id), [updateId], 'the one wire request carries the committed update');
  } finally {
    acknowledge();
    await Promise.allSettled(pending);
    await fixture.close();
  }
}
