import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { openStatusJourney, eventually } from './helpers/status-journey.mjs';
import { followUpsFlow } from './helpers/follow-ups-flow.mjs';
import { trafficAlertsFlow } from './helpers/traffic-alerts-flow.mjs';
import { reportRemindersFlow } from './helpers/report-reminders-flow.mjs';
import { assertOneOperatorEmail, settleOperatorEmails } from './helpers/operator-email-proof.mjs';

const hour = 3600000;
test('INCIDENT-010 INCIDENT-011 NOTIFY-006 NOTIFY-016 AGENT-002 — a communication owner keeps a promise, hands it over, receives one private escalation and resolves the customer incident', async t => {
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
    t.diagnostic('PROBE NOTIFY-006 acceptance-1 next-update due: owner publication with nextUpdateAt and repeated due Cron ticks -> exactly one captured email to the communication owner');
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
    t.diagnostic('PROBE NOTIFY-006 acceptance-2 overdue incident: owner takeover, revised publication and repeated overdue Cron ticks -> exactly one captured email to the replacement owner');
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

test('AUTO-003 NOTIFY-006 — operator follows real scheduled, delivery and import obligations through failures, reasoned dismissal and recovery', followUpsFlow);
test('NOTIFY-006 — repeated scheduled review holds and alert intake email each operator once per obligation while drafts stay private', async t => {
  const j = await openStatusJourney({ workerEntry: 'tests/e2e/helpers/operator-email-worker.ts' });
  try {
    const owner = (await j.json('/api/app/session')).operator;
    const colleague = 'synthetic-lamp-email-operator@example.test';
    await j.json('/api/app/operators/invite', 'POST', { email: colleague, displayName: 'Review operator' }, 202);
    await j.signIn(colleague); await j.signIn();
    const operators = [owner.email, colleague];
    const component = await j.component('Synthetic Lamp scheduled email API');
    let clock = Date.now() + 1000;
    const advance = async at => {
      clock = at;
      assert.equal((await j.raw('/test/clock', { method: 'PUT', body: JSON.stringify({ now: clock }) })).status, 204);
    };
    await advance(clock);
    const publishAt = new Date(clock + 60000).toISOString();
    const held = [];
    for (const title of ['Synthetic Lamp held API update', 'Synthetic Lamp held worker update']) {
      const incident = await j.incident(title, [component]);
      await j.save(incident.id, { nextUpdateAt: new Date(clock + hour).toISOString() });
      await j.json(`/api/app/incidents/${incident.id}/draft/schedule`, 'POST', { publishAt, channels: ['email'] }, 202);
      held.push({ incident, draft: (await j.read(incident.id)).draft });
    }
    await j.tick(clock);
    for (const { incident } of held) assert.equal(j.messages.filter(message => /held.*review/i.test(message.subject) && message.text.includes(incident.id)).length, 0, 'no review-hold email before publication is due');
    await advance(Date.parse(publishAt) + 1000);
    await j.tick(clock);
    await settleOperatorEmails(j);
    for (const { incident } of held) assertOneOperatorEmail(j, operators, /held.*review/i, incident.id);
    await j.tick(clock); await j.tick(clock);
    await settleOperatorEmails(j);
    for (const { incident, draft } of held) {
      assertOneOperatorEmail(j, operators, /held.*review/i, incident.id);
      const current = await j.read(incident.id);
      assert.deepEqual(current.draft, draft, 'an unreviewed scheduled update stays the same saved draft');
      assert.equal(current.updates.length, 0);
      assert.ok(!(await j.publicText('/')).includes(incident.title));
    }
    t.diagnostic('PROBE NOTIFY-006 acceptance-3 scheduled review hold: owner schedules two unreviewed drafts, advances Worker Date and repeats Cron -> each draft stays private and each event sends exactly one captured email to each active operator');

    const secret = 'synthetic-lamp-operator-email-source';
    const source = (await j.json('/api/app/intake/sources', 'POST', {
      name: 'Synthetic Lamp operator email monitor', credentialKind: 'hmac-sha256', signingSecret: secret,
      deduplicationPath: '$.alert.id', titlePath: '$.alert.title', statePath: '$.alert.state', recoveredValue: 'recovered', componentId: component.id,
    }, 201)).source;
    const alert = async payload => {
      const body = JSON.stringify(payload), at = new Date(clock).toISOString();
      const response = await j.raw(new URL(`/api/intake/${source.id}`, j.publicOrigin).href, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'x-lamp-timestamp': at,
        'x-lamp-signature': createHmac('sha256', secret).update(`${at}.${body}`).digest('base64url'),
      }, body });
      assert.equal(response.status, 202, await response.clone().text());
      return response.json();
    };
    for (const id of ['synthetic-lamp-api-alert', 'synthetic-lamp-worker-alert']) {
      const payload = { alert: { id, title: `PRIVATE ${id}`, state: 'firing' } };
      const created = await alert(payload);
      assert.ok(created.incidentId); assert.equal(created.replayed, false);
      await j.tick(clock);
      await settleOperatorEmails(j);
      assertOneOperatorEmail(j, operators, /alert intake.*draft/i, created.incidentId);
      const replay = await alert(payload);
      assert.equal(replay.incidentId, created.incidentId); assert.equal(replay.replayed, true);
      const repeated = await alert({ alert: { ...payload.alert, title: `PRIVATE repeated ${id}` } });
      assert.equal(repeated.incidentId, created.incidentId); assert.equal(repeated.replayed, false);
      await j.tick(clock); await j.tick(clock);
      await settleOperatorEmails(j);
      assertOneOperatorEmail(j, operators, /alert intake.*draft/i, created.incidentId);
      const draft = await j.read(created.incidentId);
      assert.ok(draft.draft); assert.equal(draft.updates.length, 0);
      assert.ok(!(await j.publicText('/')).includes(draft.title));
    }
    t.diagnostic('PROBE NOTIFY-006 acceptance-3 alert-created draft: signed public POST /api/intake/:source for two firing events, exact replay, new receipt for each same incident and repeated Cron -> private drafts and exactly one captured email per operator per incident');
  } finally { await j.close(); }
});
test('HIST-006 — independent public readership produces private traffic alerts and recoverable owner actions', async t => trafficAlertsFlow(t));
test('AUTO-004 HIST-003 — a resolved incident needs a reviewed report and weekly reminders stop on publication or reasoned waiver', reportRemindersFlow);
