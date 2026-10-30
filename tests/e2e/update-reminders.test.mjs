import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openStatusJourney, eventually } from './helpers/status-journey.mjs';
import { followUpsFlow } from './helpers/follow-ups-flow.mjs';
import { trafficAlertsFlow } from './helpers/traffic-alerts-flow.mjs';
import { reportRemindersFlow } from './helpers/report-reminders-flow.mjs';

const hour = 3600000;
test('INCIDENT-010 INCIDENT-011 NOTIFY-006 NOTIFY-016 AGENT-002 — a communication owner keeps a promise, hands it over, receives one private escalation and resolves the customer incident', async () => {
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
    const incident = await j.incident('Customer sign-in delays', [component]);
    const endpoint = `/api/app/incidents/${incident.id}`;
    const committed = Date.now() + hour;
    await j.save(incident.id, { nextUpdateAt: new Date(committed).toISOString() }); await j.publish(incident.id);
    assert.equal((await j.read(incident.id)).owner.id, owner.id);
    await j.tick(committed - 5 * 60000); await j.tick(committed - 5 * 60000);
    const dueMail = j.messages.filter(row => row.subject.includes(incident.reference) && /update due at/i.test(row.subject));
    assert.equal(dueMail.length, 1); assert.ok(dueMail[0].to.includes(owner.email));
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
    // A saved commitment which has already passed exercises the live operator
    // view as well as Cron's supplied event clock.
    revised = Date.now() - 60000;
    await j.save(incident.id, { lifecycle: 'Monitoring', nextUpdateAt: new Date(revised).toISOString() }); await j.publish(incident.id);
    // A real operator draft wins over deterministic preparation at the deadline.
    await j.save(incident.id, { lifecycle: 'Monitoring', customerImpact: 'Operator-reviewed recovery wording.', details: 'Keep this exact operator draft.', nextUpdateAt: new Date(revised).toISOString() });
    const operatorDraft = (await j.read(incident.id)).draft;
    await j.tick(revised - 5 * 60000); await j.tick(revised + 60000); await j.tick(revised + 2 * 60000);
    assert.deepEqual((await j.read(incident.id)).draft, operatorDraft);
    assert.equal((await j.read(incident.id)).overdue, true);
    const overdueMail = j.messages.filter(row => row.subject.includes(incident.reference) && /overdue/i.test(row.subject));
    assert.equal(overdueMail.length, 1); assert.ok(overdueMail[0].to.includes(replacementEmail));
    assert.ok(channelPosts.some(row => JSON.stringify(row).includes(incident.reference)));
    await j.tick(revised + 20 * 60000); await j.tick(revised + 21 * 60000);
    const escalated = j.messages.filter(row => row.subject.includes(incident.reference) && /communication escalation/i.test(row.subject));
    assert.equal(escalated.length, 2);
    assert.deepEqual(new Set(escalated.flatMap(row => row.to)), new Set([owner.email, replacementEmail]));
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
    await j.json(`${endpoint}/owner/take-over`, 'POST', {}, 409);
    await j.visible(`/incidents/${incident.reference}`, 'Resolved');
  } finally { await j.close(); }
});

test('AUTO-003 — operator follows real scheduled, delivery and import obligations through failures, reasoned dismissal and recovery', followUpsFlow);
test('HIST-006 — independent public readership produces private traffic alerts and recoverable owner actions', async t => trafficAlertsFlow(t));
test('AUTO-004 HIST-003 — both severe incidents become report-due at seven days and reviewed publication or reasoned waiver stops weekly reminders', reportRemindersFlow);
