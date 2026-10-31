import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { openSubscriberManagementFixture, eventuallySubscriber } from './subscriber-management-fixture.mjs';

const descendants = node => (node.childNodes ?? []).flatMap(child => [child, ...descendants(child)]);
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join('');

/** Changed windows keep the audience already told, even after their component
 * choices change; a later subscriber does not silently join that audience. */
export async function maintenanceAudienceFlow() {
  const fixture = await openSubscriberManagementFixture({ workerEntry: 'tests/e2e/helpers/automation-clock-worker.ts' });
  const { api, post, raw, db } = fixture;
  const address = number => [`synthetic-lamp-maintenance-audience-${number}`, 'example.test'].join('@');
  const now = Date.now() + 60_000;
  const tick = async () => {
    const result = await (await fixture.runtime.getWorker()).scheduled({ cron: '* * * * *', scheduledTime: now });
    assert.equal(result.outcome, 'ok');
  };
  try {
    assert.equal((await raw('/test/clock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ now }) })).status, 204);
    fixture.recoverWebhook();
    const component = await fixture.createComponent('Synthetic Lamp changed-window service');
    const unrelated = await fixture.createComponent('Synthetic Lamp later selection');
    const add = async (channel, number) => {
      const response = await post('/api/app/subscribers', { channel, componentIds: [component.id], ...(channel === 'email'
        ? { email: address(number) }
        : { destination: 'https://receiver.example.test/synthetic-lamp-1', contactEmail: address(number), webhookFormat: 'lamp' }) });
      assert.equal(response.status, 201, response.text);
      await fixture.confirm(address(number));
      assert.equal((await fixture.list()).find(row => row.id === response.body.subscriber.id).state, 'active');
      return response.body.subscriber;
    };
    const email = await add('email', 1), webhook = await add('webhook', 2);
    const expected = [{ subscriberId: email.id, channel: 'email' }, { subscriberId: webhook.id, channel: 'webhook' }];
    const startsAt = new Date(now + 48 * 3_600_000).toISOString();
    const endsAt = new Date(now + 49 * 3_600_000).toISOString();
    const title = 'Synthetic Lamp rescheduled audience';
    const created = await post('/api/app/maintenance', { title, affectedAudience: 'Customers already told about this window', customerImpact: 'Requests may pause while the service is upgraded.', startsAt, endsAt, componentIds: [component.id], autoStart: false, autoComplete: false });
    assert.equal(created.status, 201, created.text);
    const maintenance = created.body.maintenance;
    const read = async () => {
      const response = await api('/api/app/maintenance');
      assert.equal(response.status, 200, response.text);
      return response.body.maintenance.find(row => row.id === maintenance.id);
    };
    const publicText = async path => {
      const response = await raw(new URL(path, fixture.publicOrigin).href);
      assert.equal(response.status, 200);
      return response.text();
    };
    const assertAudience = async (kind, state, count) => {
      const notices = (await read()).notices.filter(row => row.kind === kind);
      assert.equal(notices.length, 1);
      const recipients = (await db.prepare('SELECT subscriber_id AS subscriberId, channel FROM notification_delivery_records WHERE notification_event_id = ? ORDER BY channel').bind(notices[0].id).all()).results;
      assert.deepEqual(recipients, expected, `${kind} captures exactly the audience already notified`);
      const accepted = await eventuallySubscriber(async () => {
        const response = await api('/api/app/deliveries?limit=100');
        assert.equal(response.status, 200, response.text);
        return response.body.deliveries.filter(row => row.maintenanceId === maintenance.id);
      }, rows => rows.length === count * 2 && rows.every(row => row.channel === 'email' ? Boolean(row.providerAcceptedAt) : row.outcome === 'delivered'), `${kind} reaches both original subscribers`);
      const rows = accepted.filter(row => row.maintenanceNoticeKind === kind);
      assert.deepEqual(rows.map(({ subscriberId, channel }) => ({ subscriberId, channel })).sort((left, right) => left.channel.localeCompare(right.channel)), expected);
      const mail = fixture.messagesFor(address(1)).filter(message => message.subject === `Synthetic Lamp follow-ups: [${maintenance.reference}] ${kind[0].toUpperCase() + kind.slice(1)}: ${title}`);
      assert.equal(mail.length, 1, `the original email subscriber receives ${kind}`);
      assert.ok(mail[0].text.includes(`Status: ${state}`));
      const received = fixture.webhookRequests.filter(request => request.body.maintenance?.id === maintenance.id && request.body.maintenance.notice === kind);
      assert.equal(received.length, 1, `the original webhook subscriber receives ${kind}`);
      assert.equal(received[0].body.deliveryId, rows.find(row => row.channel === 'webhook').id);
      assert.equal(received[0].body.maintenance.state, state);
      return notices[0];
    };

    await tick();
    const scheduled = await assertAudience('scheduled', 'Scheduled', 1);
    const permalink = `/maintenance/${maintenance.reference}`;
    await eventuallySubscriber(() => publicText('/'), html => html.includes(`href="${permalink}"`), 'the upcoming listing initially contains this maintenance');
    // Both original subscribers now follow another service. The already-told
    // audience must survive this change without adding the later subscriber.
    for (const number of [1, 2]) {
      const manageUrl = fixture.messagesFor(address(number))[0].text.match(/https?:\/\/\S+\/manage\/\S+/)?.[0];
      assert.ok(manageUrl);
      const changed = await raw(manageUrl, { method: 'POST', headers: { Origin: fixture.publicOrigin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ componentId: unrelated.id, preferencesPresent: '1', eventKind: 'maintenance' }).toString() });
      assert.equal(changed.status, 200, await changed.text());
      assert.deepEqual((await fixture.list()).find(row => row.id === (number === 1 ? email.id : webhook.id)).componentSelections.map(row => row.componentId), [unrelated.id]);
    }
    await add('email', 3);
    const changedStartsAt = new Date(now + 50 * 3_600_000).toISOString();
    const changedEndsAt = new Date(now + 51 * 3_600_000).toISOString();
    const changed = await api(`/api/app/maintenance/${maintenance.id}/window`, { method: 'PUT', body: JSON.stringify({ startsAt: changedStartsAt, endsAt: changedEndsAt }) });
    assert.equal(changed.status, 200, changed.text);
    assert.equal((await read()).startsAt, changedStartsAt);
    assert.equal((await read()).endsAt, changedEndsAt);
    await tick();
    const rescheduled = await assertAudience('rescheduled', 'Scheduled', 2);
    assert.equal(fixture.messagesFor(address(3)).length, 1, 'the newly eligible subscriber receives no changed-window notice');
    const originalNotices = (await read()).notices;

    const cancelled = await post(`/api/app/maintenance/${maintenance.id}/cancel`);
    const acknowledgedAt = performance.now();
    assert.equal(cancelled.status, 200, cancelled.text);
    await eventuallySubscriber(() => publicText('/'), html => !html.includes(`href="${permalink}"`), 'cancellation removes the prewarmed upcoming listing');
    assert.ok(performance.now() - acknowledgedAt < 10_000, 'the public listing disappears within ten seconds of the successful native cancellation');
    await tick();
    await assertAudience('cancelled', 'Cancelled', 3);
    assert.equal(fixture.messagesFor(address(3)).length, 1, 'cancellation also excludes the later subscriber');
    const retained = await read();
    assert.equal(retained.state, 'Cancelled');
    assert.deepEqual(retained.notices.filter(row => row.id === scheduled.id || row.id === rescheduled.id).sort((left, right) => left.id.localeCompare(right.id)), originalNotices.sort((left, right) => left.id.localeCompare(right.id)), 'cancellation preserves every original notice field');
    const history = await eventuallySubscriber(() => publicText('/history'), html => html.includes(`href="${permalink}"`), 'the cancelled maintenance remains in public history');
    const entry = descendants(parse(history)).find(node => node.tagName === 'article' && node.attrs.some(attr => attr.name === 'class' && attr.value === 'history-item') && descendants(node).some(child => child.tagName === 'a' && child.attrs.some(attr => attr.name === 'href' && attr.value === permalink)));
    assert.ok(entry);
    assert.ok(text(entry).includes(title));
    assert.ok(text(entry).includes('Cancelled'), 'this maintenance is labelled Cancelled in its retained history entry');
    const page = await publicText(permalink);
    assert.ok(page.includes('data-maintenance-state="Cancelled"'));
    const identities = (await db.prepare('SELECT id, subscriber_id, notification_event_id FROM notification_delivery_records WHERE maintenance_id = ? ORDER BY id').bind(maintenance.id).all()).results;
    await tick();
    assert.deepEqual((await db.prepare('SELECT id, subscriber_id, notification_event_id FROM notification_delivery_records WHERE maintenance_id = ? ORDER BY id').bind(maintenance.id).all()).results, identities);
    assert.equal(fixture.webhookRequests.filter(request => request.body.maintenance?.id === maintenance.id).length, 3);
    assert.equal(fixture.messagesFor(address(1)).filter(message => message.subject.includes(`[${maintenance.reference}]`)).length, 3, 'repeated ticks never repeat a changed or cancelled notice');
  } finally { await fixture.close(); }
}
