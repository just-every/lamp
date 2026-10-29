import assert from 'node:assert/strict';
import { eventuallySubscriber, pageOrigin } from './subscriber-management-fixture.mjs';

export async function subscriberQueuedUnsubscribe({ fixture, component, subscriberId, email }) {
  const { api, post, raw } = fixture;
  const unsubscribe = fixture.messagesFor(email).map(message => message.text.match(/https?:\/\/\S+\/unsubscribe\/\S+/)?.[0]).find(Boolean);
  assert.ok(unsubscribe, 'a delivered publication supplies the signed unsubscribe link');
  // Pause the existing Worker effects boundary so both inline dispatch and the
  // Queue consumer retain the committed recipient until the customer opts out.
  const pause = async paused => assert.equal((await raw('/test/effects', { method: 'PUT', body: JSON.stringify({ paused }) })).status, 204);
  await pause(true);
  try {
    const created = await post('/api/app/incidents', { title: 'Queued customer notification', components: [{ componentId: component.id, state: 'Partially unavailable', relationship: 'Primary' }] });
    assert.equal(created.status, 201, created.text);
    const id = created.body.incident.id;
    assert.equal((await api(`/api/app/incidents/${id}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle: 'Identified', affectedAudience: 'API customers', customerImpact: 'Requests are delayed while the queue recovers.', whatStillWorks: '', details: '', nextUpdateAt: new Date(Date.now() + 3600_000).toISOString() }) })).status, 200);
    const published = await post(`/api/app/incidents/${id}/publish`, { channels: ['email'] });
    assert.equal(published.status, 200, published.text);
    const deliveries = async () => {
      const response = await api(`/api/app/deliveries?incidentUpdateId=${published.body.update.id}&limit=100`);
      assert.equal(response.status, 200, response.text);
      return response.body.deliveries.filter(row => row.subscriberId === subscriberId);
    };
    const committed = await deliveries();
    assert.equal(committed.length, 1);
    assert.equal(committed[0].outcome, 'queued', 'the recipient was committed while the subscription was active');
    assert.equal(committed[0].providerAcceptedAt, null, 'dispatch has not crossed the provider edge');
    const before = fixture.messagesFor(email).length;
    const stopped = await raw(unsubscribe, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: pageOrigin }, body: 'List-Unsubscribe=One-Click' });
    assert.equal(stopped.status, 200, await stopped.text());
    assert.equal((await fixture.list()).find(row => row.id === subscriberId).state, 'deactivated');
    await pause(false);
    const redelivery = await (await fixture.runtime.getWorker()).queue('lamp-follow-ups-jobs', [{ id: 'queued-unsubscribe-redelivery', timestamp: new Date(), attempts: 2, body: { type: 'delivery-dispatch', eventId: published.body.update.id } }]);
    assert.equal(redelivery.outcome, 'ok', 'the real Queue entry point consumes the committed notification after unsubscribe');
    const suppressed = await eventuallySubscriber(deliveries, rows => rows.length === 1 && rows[0].outcome === 'suppressed', 'the committed notification is durably suppressed after unsubscribe');
    assert.equal(suppressed[0].id, committed[0].id);
    assert.equal(fixture.messagesFor(email).length, before, 'no send occurs after the committed deactivation');
  } finally {
    await pause(false);
  }
}
