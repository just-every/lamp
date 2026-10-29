import assert from 'node:assert/strict';
import { eventuallySubscriber, pageOrigin } from './subscriber-management-fixture.mjs';

export async function subscriberQueuedUnsubscribe({ fixture, component, subscriberId, email }) {
  const { api, post, raw } = fixture;
  const unsubscribe = fixture.messagesFor(email).map(message => message.text.match(/https?:\/\/\S+\/unsubscribe\/\S+/)?.[0]).find(Boolean);
  assert.ok(unsubscribe, 'a delivered publication supplies the signed unsubscribe link');
  assert.equal((await raw('/test/queue', { method: 'PUT', body: JSON.stringify({ outage: true }) })).status, 204);
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
    const before = fixture.messagesFor(email).length;
    const stopped = await raw(unsubscribe, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: pageOrigin }, body: 'List-Unsubscribe=One-Click' });
    assert.equal(stopped.status, 200, await stopped.text());
    assert.equal((await fixture.list()).find(row => row.id === subscriberId).state, 'deactivated');
    assert.equal((await raw('/test/queue', { method: 'PUT', body: JSON.stringify({ outage: false }) })).status, 204);
    const followUps = await api('/api/app/overview/follow-ups');
    assert.equal(followUps.status, 200, followUps.text);
    for (const item of followUps.body.followUps.filter(row => row.kind === 'notification-dispatch')) {
      const retry = await post('/api/app/overview/follow-ups/retry', { id: item.id, occurrence: item.occurrence });
      assert.equal(retry.status, 202, retry.text);
    }
    const suppressed = await eventuallySubscriber(deliveries, rows => rows.length === 1 && rows[0].outcome === 'suppressed', 'the committed notification is durably suppressed after unsubscribe');
    assert.equal(suppressed[0].id, committed[0].id);
    assert.equal(fixture.messagesFor(email).length, before, 'no send occurs after the committed deactivation');
  } finally {
    assert.equal((await raw('/test/queue', { method: 'PUT', body: JSON.stringify({ outage: false }) })).status, 204);
  }
}
