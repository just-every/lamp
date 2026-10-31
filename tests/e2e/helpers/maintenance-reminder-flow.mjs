import assert from 'node:assert/strict';
import { openSubscriberManagementFixture, eventuallySubscriber } from './subscriber-management-fixture.mjs';

const HOUR = 3_600_000;
const iso = instant => new Date(instant).toISOString();

/** Native scheduling, Cron, recipient capture and real subscriber transports
 * share the Worker's clock; only the external provider edges are recorded. */
export async function maintenanceReminderFlow() {
  const fixture = await openSubscriberManagementFixture({ workerEntry: 'tests/e2e/helpers/automation-clock-worker.ts' });
  const { api, post, raw, db } = fixture;
  const clock = async now => {
    const response = await raw('/test/clock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ now }) });
    assert.equal(response.status, 204, await response.text());
  };
  const tick = async now => {
    await clock(now);
    const result = await (await fixture.runtime.getWorker()).scheduled({ cron: '* * * * *', scheduledTime: now });
    assert.equal(result.outcome, 'ok', 'the real scheduled handler finishes at the controlled Worker instant');
  };
  const address = number => [`synthetic-lamp-maintenance-${number}`, 'example.test'].join('@');
  try {
    const now = Date.now() + 60_000;
    await clock(now);
    fixture.recoverWebhook();
    const component = await fixture.createComponent('Synthetic Lamp reminder service');
    const unrelated = await fixture.createComponent('Synthetic Lamp unrelated service');
    const recipients = [];
    for (const [channel, number, selected] of [['email', 1, component], ['webhook', 2, component], ['email', 3, unrelated]]) {
      const added = await post('/api/app/subscribers', {
        channel, componentIds: [selected.id],
        ...(channel === 'email' ? { email: address(number) } : {
          destination: 'https://receiver.example.test/synthetic-lamp-1', contactEmail: address(number), webhookFormat: 'lamp',
        }),
      });
      assert.equal(added.status, 201, added.text);
      await fixture.confirm(address(number));
      const saved = (await fixture.list()).find(row => row.id === added.body.subscriber.id);
      assert.equal(saved.state, 'active');
      assert.deepEqual(saved.componentSelections.map(row => row.componentId), [selected.id]);
      if (selected.id === component.id) recipients.push({ subscriberId: saved.id, channel });
    }
    const expectedRecipients = recipients.sort((left, right) => left.channel.localeCompare(right.channel));
    const startsAt = now + 48 * HOUR;
    const endsAt = startsAt + HOUR;
    const reminderAt = startsAt - 24 * HOUR;
    const title = 'Synthetic Lamp future reminder window';
    const created = await post('/api/app/maintenance', {
      title, affectedAudience: 'Customers of the reminder service', customerImpact: 'Requests may pause during this window.',
      startsAt: iso(startsAt), endsAt: iso(endsAt), componentIds: [component.id], autoStart: true, autoComplete: true,
    });
    assert.equal(created.status, 201, created.text);
    const maintenance = created.body.maintenance;
    const read = async () => {
      const response = await api('/api/app/maintenance');
      assert.equal(response.status, 200, response.text);
      const record = response.body.maintenance.find(row => row.id === maintenance.id);
      assert.ok(record, 'native readback retains this future maintenance');
      return record;
    };
    const deliveries = async () => {
      const response = await api('/api/app/deliveries?limit=100');
      assert.equal(response.status, 200, response.text);
      return response.body.deliveries.filter(row => row.maintenanceId === maintenance.id);
    };
    const mail = () => fixture.messages.filter(message => message.subject.includes(`[${maintenance.reference}]`));
    const webhooks = () => fixture.webhookRequests.filter(request => request.body.maintenance?.id === maintenance.id);
    const snapshot = async () => ({
      notices: (await read()).notices.sort((left, right) => left.id.localeCompare(right.id)),
      recipients: (await db.prepare('SELECT id, subscriber_id, channel, notification_event_id, queued_at FROM notification_delivery_records WHERE maintenance_id = ? ORDER BY id').bind(maintenance.id).all()).results,
      outbox: (await db.prepare('SELECT id, kind, aggregate_id FROM notification_outbox WHERE aggregate_id IN (SELECT id FROM maintenance_notices WHERE maintenance_id = ?) ORDER BY id').bind(maintenance.id).all()).results,
      mail: mail(), webhooks: webhooks(),
    });
    const assertNotice = async (kind, at, state, count) => {
      const record = await read();
      assert.equal(record.state, state);
      const notices = record.notices.filter(row => row.kind === kind);
      assert.equal(notices.length, 1, `exactly one ${kind} notice is committed`);
      const notice = notices[0];
      assert.equal(notice.publishedAt, iso(at), `${kind} uses the independently chosen Worker instant`);
      const committed = (await db.prepare('SELECT subscriber_id AS subscriberId, channel, queued_at AS queuedAt FROM notification_delivery_records WHERE notification_event_id = ? ORDER BY channel').bind(notice.id).all()).results;
      assert.deepEqual(committed.map(({ subscriberId, channel }) => ({ subscriberId, channel })), expectedRecipients, `${kind} captures exactly the two eligible subscribers`);
      assert.ok(committed.every(row => row.queuedAt === iso(at)), `${kind} captures its recipients at the event boundary`);
      const accepted = await eventuallySubscriber(deliveries, rows => rows.length === count * 2 && rows.every(row =>
        row.channel === 'email' ? Boolean(row.providerAcceptedAt) : row.outcome === 'delivered'), `${kind} crosses both actual subscriber transport adapters`);
      const rows = accepted.filter(row => row.maintenanceNoticeKind === kind);
      assert.deepEqual(rows.map(({ subscriberId, channel }) => ({ subscriberId, channel })).sort((left, right) => left.channel.localeCompare(right.channel)), expectedRecipients);
      const emailDelivery = rows.find(row => row.channel === 'email');
      const receipt = fixture.mailReceipts.find(row => row.idempotencyKey === `notification/${emailDelivery.id}`);
      assert.ok(receipt, `${kind} has an actual provider acceptance identity for its committed delivery`);
      assert.equal(emailDelivery.providerAcceptedAt, iso(at));
      const email = mail().filter(message => message.subject === `Synthetic Lamp follow-ups: [${maintenance.reference}] ${kind[0].toUpperCase() + kind.slice(1)}: ${title}`);
      assert.equal(email.length, 1, `${kind} produces one real serialized email`);
      assert.deepEqual(email[0].to, [address(1)]);
      assert.ok(email[0].text.includes(`Status: ${state}`));
      const received = webhooks().filter(request => request.body.maintenance.notice === kind);
      assert.equal(received.length, 1, `${kind} produces one accepted webhook`);
      assert.equal(received[0].body.event, 'maintenance.notice.published');
      assert.equal(received[0].body.deliveryId, rows.find(row => row.channel === 'webhook').id);
      assert.deepEqual(received[0].body.maintenance, { id: maintenance.id, reference: maintenance.reference, title, state, notice: kind });
      assert.equal(mail().length, count);
      assert.equal(webhooks().length, count);
      assert.equal(fixture.messagesFor(address(3)).length, 1, 'the unrelated confirmed subscriber receives only its confirmation');
      return notice;
    };

    await tick(now);
    await assertNotice('scheduled', now, 'Scheduled', 1);
    assert.deepEqual((await read()).notices.map(row => row.kind), ['scheduled']);
    const scheduled = await snapshot();

    await tick(reminderAt - 1);
    await fixture.signIn(undefined, { fresh: true });
    assert.deepEqual(await snapshot(), scheduled, 'one millisecond before start minus twenty-four hours there is no reminder notice, recipient, outbox job or send');

    await tick(reminderAt);
    await assertNotice('reminder', reminderAt, 'Scheduled', 2);
    const reminded = await snapshot();
    await tick(reminderAt);
    await tick(reminderAt + 60_000);
    assert.deepEqual(await snapshot(), reminded, 'repeated scheduled ticks preserve all notice, recipient and dispatch identities without another transport request');

    await tick(startsAt);
    await fixture.signIn(undefined, { fresh: true });
    await assertNotice('started', startsAt, 'In progress', 3);
    await tick(endsAt);
    await assertNotice('completed', endsAt, 'Completed', 4);
    const completed = await snapshot();
    assert.deepEqual(completed.notices.map(row => row.kind).sort(), ['completed', 'reminder', 'scheduled', 'started']);
    await tick(endsAt);
    assert.deepEqual(await snapshot(), completed, 'completed maintenance cannot publish or send any repeated reminder or lifecycle notice');
  } finally { await fixture.close(); }
}
