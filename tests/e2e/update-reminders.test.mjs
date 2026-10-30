import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openStatusJourney, eventually } from './helpers/status-journey.mjs';
import { followUpsFlow } from './helpers/follow-ups-flow.mjs';
import { trafficAlertsFlow } from './helpers/traffic-alerts-flow.mjs';
import { reportRemindersFlow } from './helpers/report-reminders-flow.mjs';

const hour = 3600000;
test('INCIDENT-010 INCIDENT-011 NOTIFY-006 NOTIFY-008 NOTIFY-016 AGENT-002 — a communication owner keeps a promise, hands it over, receives one private escalation and resolves the customer incident', async () => {
  const channelPosts = [];
  const slack = 'https://hooks.slack.com/services/synthetic-lamp-promises/synthetic-lamp-owner/synthetic-lamp-key';
  const j = await openStatusJourney({ providerEdge: async request => {
    if (request.url === slack) { channelPosts.push(await request.json()); return new Response('ok'); }
  } });
  try {
    const component = await j.component('Sign-in service');
    await j.json('/api/app/channels', 'POST', { kind: 'slack', url: slack, name: 'Communication operators', componentIds: [component.id], operatorAlerts: true }, 201);
    const owner = (await j.json('/api/app/session')).operator;
    const replacementEmail = 'synthetic-lamp-replacement@example.test';
    await j.json('/api/app/operators/invite', 'POST', { email: replacementEmail, displayName: 'Replacement communicator' }, 202);
    await j.signIn(replacementEmail);
    const replacement = (await j.json('/api/app/session')).operator;
    await j.signIn();
    const configuredSender = (await j.json('/api/app/page-settings')).settings.mailFromAddress;
    const customers = ['active', 'pending'].map(state => ({ state, email: [`synthetic-lamp-reminder-${state}`, 'example.test'].join('@') }));
    for (const customer of customers) {
      const added = await j.json('/api/app/subscribers', 'POST', { channel: 'email', email: customer.email, componentIds: [component.id] }, 201);
      customer.id = added.subscriber.id;
      const confirmation = j.messages.filter(message => message.to.includes(customer.email));
      assert.equal(confirmation.length, 1, 'each customer receives its single confirmation');
      assert.deepEqual(confirmation[0].to, [customer.email]);
      assert.equal(confirmation[0].from, configuredSender);
      const link = confirmation[0].text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
      if (customer.state === 'active') assert.equal((await j.raw(link)).status, 200);
    }
    const subscriberInventory = (await j.json('/api/app/subscribers')).subscribers;
    for (const customer of customers) {
      const saved = subscriberInventory.find(row => row.id === customer.id);
      assert.equal(saved.destination, customer.email);
      assert.equal(saved.state, customer.state, 'the controls have independently read active and pending consent');
      assert.deepEqual(saved.componentSelections.map(row => row.componentId), [component.id]);
    }
    const assertEnvelopes = (messages, expectedRecipients, label) => {
      for (const message of messages) {
        assert.equal(message.from, configuredSender, `${label}: configured sender reaches the mail transport`);
        assert.deepEqual(message.cc ?? [], [], `${label}: no copied recipients`);
        assert.deepEqual(message.bcc ?? [], [], `${label}: no hidden recipients`);
      }
      assert.deepEqual(messages.flatMap(message => message.to).sort(), [...expectedRecipients].sort(), `${label}: every envelope contains only the authorized recipients, exactly once`);
    };
    const assignedOperator = async id => {
      const assigned = (await j.read(id)).owner;
      const operators = (await j.json('/api/app/operators')).operators;
      const operator = operators.find(row => row.id === assigned.id);
      assert.ok(operator, 'the assigned identity independently resolves to an active operator');
      return operator;
    };
    const incident = await j.incident('Customer sign-in delays', [component]);
    const endpoint = `/api/app/incidents/${incident.id}`;
    const committed = Date.now() + hour;
    await j.save(incident.id, { nextUpdateAt: new Date(committed).toISOString() }); await j.publish(incident.id, { channels: ['email'] });
    const activeCustomer = customers.find(row => row.state === 'active');
    const customerPublication = await eventually(() => j.messages.filter(message => message.to.includes(activeCustomer.email) && message.subject.includes(incident.reference)), rows => rows.length === 1, 'the active control receives the selected publication');
    assertEnvelopes(customerPublication, [activeCustomer.email], 'active subscriber publication');
    const initialOperator = await assignedOperator(incident.id);
    assert.equal(initialOperator.id, owner.id);
    assert.equal((await j.read(incident.id)).owner.id, owner.id);
    await j.tick(committed - 5 * 60000); await j.tick(committed - 5 * 60000);
    const dueMail = j.messages.filter(row => row.subject.includes(incident.reference) && /update due at/i.test(row.subject));
    assert.equal(dueMail.length, 1); assert.ok(dueMail[0].to.includes(owner.email));
    assertEnvelopes(dueMail, [initialOperator.email], 'initial due reminder');
    const prepared = (await j.read(incident.id)).draft;
    assert.ok(prepared.agentPreparation);
    assert.equal(prepared.nextUpdateAt, new Date(committed).toISOString());
    await j.tick(committed - 5 * 60000);
    assert.deepEqual((await j.read(incident.id)).draft, prepared, 'a repeated clock tick cannot overwrite the saved preparation');
    for (const path of ['/', `/incidents/${incident.reference}`, '/feed.atom', '/api/public/status']) assert.ok(!(await j.publicText(path)).includes(prepared.details), path);
    let revised = committed + hour;
    await j.save(incident.id, { lifecycle: 'Monitoring', nextUpdateAt: new Date(revised).toISOString() }); await j.publish(incident.id);
    await j.tick(committed + 60000);
    assert.equal(j.messages.filter(row => row.subject.includes(incident.reference) && /overdue/i.test(row.subject)).length, 0, 'publishing replaces the earlier commitment');
    await j.signIn(replacementEmail);
    await j.json(`${endpoint}/owner/take-over`, 'POST', {});
    assert.equal((await j.read(incident.id)).owner.id, replacement.id);
    const handedOverOperator = await assignedOperator(incident.id);
    assert.equal(handedOverOperator.id, replacement.id);
    // A saved commitment which has already passed exercises the live operator
    // view as well as Cron's supplied event clock.
    revised = Date.now() - 60000;
    await j.save(incident.id, { lifecycle: 'Monitoring', nextUpdateAt: new Date(revised).toISOString() }); await j.publish(incident.id);
    // A real operator draft wins over deterministic preparation at the deadline.
    await j.save(incident.id, { lifecycle: 'Monitoring', customerImpact: 'Operator-reviewed recovery wording.', details: 'Keep this exact operator draft.', nextUpdateAt: new Date(revised).toISOString() });
    const operatorDraft = (await j.read(incident.id)).draft;
    await j.tick(revised - 5 * 60000); await j.tick(revised + 60000); await j.tick(revised + 2 * 60000);
    const handedOverDue = j.messages.filter(row => row.subject.includes(incident.reference) && /update due at/i.test(row.subject) && !dueMail.includes(row));
    assertEnvelopes(handedOverDue, [handedOverOperator.email], 'handed-over due reminder');
    assert.deepEqual((await j.read(incident.id)).draft, operatorDraft);
    assert.equal((await j.read(incident.id)).overdue, true);
    const overdueMail = j.messages.filter(row => row.subject.includes(incident.reference) && /overdue/i.test(row.subject));
    assert.equal(overdueMail.length, 1); assert.ok(overdueMail[0].to.includes(replacementEmail));
    assertEnvelopes(overdueMail, [handedOverOperator.email], 'handed-over overdue reminder');
    assert.ok(channelPosts.some(row => JSON.stringify(row).includes(incident.reference)));
    await j.tick(revised + 20 * 60000); await j.tick(revised + 21 * 60000);
    const escalated = j.messages.filter(row => row.subject.includes(incident.reference) && /communication escalation/i.test(row.subject));
    assert.equal(escalated.length, 2);
    assert.deepEqual(new Set(escalated.flatMap(row => row.to)), new Set([owner.email, replacementEmail]));
    const activeOperators = (await j.json('/api/app/operators')).operators;
    assert.deepEqual(activeOperators.map(row => row.id).sort(), [owner.id, replacement.id].sort());
    assertEnvelopes(escalated, activeOperators.map(row => row.email), 'all-operator escalation');
    for (const customer of customers) {
      const received = j.messages.filter(message => message.to.includes(customer.email));
      assert.equal(received.length, customer.state === 'active' ? 2 : 1, 'customers receive only their confirmation and eligible public publication, never private reminders');
      assert.equal(received.filter(message => message.text.includes('/confirm-subscription/')).length, 1);
    }
    const publicPage = await j.publicText(`/incidents/${incident.reference}`);
    assert.ok(publicPage.includes(new Date(revised).toISOString()));
    for (const identity of [owner.displayName, replacement.displayName]) assert.ok(!publicPage.includes(identity));
    assert.ok(!publicPage.includes(operatorDraft.details));
    const audit = await j.json('/api/app/audit-log?action=communication-owner-changed&limit=100');
    assert.ok(audit.entries.some(row => row.entityId === incident.id && row.actorId === replacement.id));
    await j.save(incident.id, { lifecycle: 'Resolved', nextUpdateAt: null }); await j.publish(incident.id);
    const count = j.messages.length;
    await j.tick(revised + 2 * hour);
    assert.equal(j.messages.length, count, 'resolution stops deadline mail');
    for (const message of j.messages) assert.equal(message.from, configuredSender, 'every captured notification uses the configured sender');
    await j.json(`${endpoint}/owner/take-over`, 'POST', {}, 409);
    await j.visible(`/incidents/${incident.reference}`, 'Resolved');
  } finally { await j.close(); }
});

test('AUTO-003 — operator follows real scheduled, delivery and import obligations through failures, reasoned dismissal and recovery', followUpsFlow);
test('HIST-006 — independent public readership produces private traffic alerts and recoverable owner actions', async t => trafficAlertsFlow(t));
test('AUTO-004 HIST-003 — a resolved incident needs a reviewed report and weekly reminders stop on publication or reasoned waiver', reportRemindersFlow);
