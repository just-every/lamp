import assert from "node:assert/strict";
import { openFollowUpsRuntime, eventuallyFollowUp, pageOrigin } from "./follow-ups-runtime.mjs";
import { followUpsImport } from "./follow-ups-import.mjs";

/** AUTO-004: the real report and scheduled doors, with fake Resend, Slack and
 * Teams edges. No reminder, outbox or delivery record is manufactured. */
export async function reportRemindersFlow() {
  const posts = [];
  const slack = "https://hooks.slack.com/services/synthetic-lamp-11/synthetic-lamp-12/synthetic-lamp-13";
  const teams = "https://synthetic-lamp-11.logic.azure.com/workflows/synthetic-lamp-12/triggers/manual/paths/invoke?sig=synthetic-lamp-13";
  const publicationOnly = "https://hooks.slack.com/services/synthetic-lamp-14/synthetic-lamp-15/synthetic-lamp-16";
  const fixture = await openFollowUpsRuntime({ workerEntry: "tests/e2e/helpers/automation-clock-worker.ts", providerEdge: async request => {
    if ([slack, teams, publicationOnly].includes(request.url)) {
      posts.push({ url: request.url, body: await request.json() });
      return new Response(request.url === teams ? "" : "ok", { status: 200 });
    }
  } });
  const { post, api, runtime } = fixture;
  const DAY = 86_400_000;
  let now = Date.now();
  const advance = async time => {
    const response = await fixture.raw("/test/clock", { method: "PUT", body: JSON.stringify({ now: time }) });
    assert.equal(response.status, 204, await response.text());
    now = time;
    // Operator sessions and magic links must use the same days-later clock.
    await fixture.signIn(undefined, { fresh: true });
  };
  const tick = async time => {
    await advance(time);
    const result = await (await runtime.getWorker()).scheduled({ cron: "* * * * *", scheduledTime: time });
    assert.equal(result.outcome, "ok");
  };
  try {
    const owner = (await api("/api/app/session")).body.operator;
    const component = (await post("/api/app/components", { groupId: null, name: "synthetic-lamp-11", description: "", internal: false, displayOrder: 0, note: "" })).body.component;
    for (const [kind, url, operatorAlerts] of [["slack", slack, true], ["teams", teams, true], ["slack", publicationOnly, false]]) {
      const connected = await post("/api/app/channels", { kind, url, name: `synthetic-lamp-11 ${kind}`, componentIds: [component.id], operatorAlerts });
      assert.equal(connected.status, 201, connected.text);
    }
    const subscriber = ["synthetic-lamp-report-private", "example.test"].join("@");
    const subscription = await fixture.raw(pageOrigin + "/subscribe", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: subscriber, componentId: component.id }) });
    assert.equal(subscription.status, 202);
    const invitation = fixture.messages.find(message => message.to.includes(subscriber));
    assert.ok(invitation, "the subscriber's consent mail crosses the provider edge");
    const confirmationLink = invitation.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
    const confirmed = await fixture.raw(confirmationLink);
    assert.equal(confirmed.status, 200);
    const subscriberRecord = (await api("/api/app/subscribers?limit=100")).body.subscribers.find(row => row.destination === subscriber);
    assert.equal(subscriberRecord.state, "active");
    const imported = await followUpsImport(fixture);
    const privateSubscriberData = [subscriber, subscriberRecord.id, confirmationLink, imported.subscriber.id, imported.subscriber.destination];
    const publishUpdate = async (incident, lifecycle) => {
      const saved = await api(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle, affectedAudience: "Synthetic Lamp readers", customerImpact: "Requests were unavailable.", whatStillWorks: "", details: "Service has recovered.", nextUpdateAt: lifecycle === "Resolved" ? null : new Date(now + 3_600_000).toISOString() }) });
      assert.equal(saved.status, 200, saved.text);
      const published = await post(`/api/app/incidents/${incident.id}/publish`, { channels: [] });
      assert.equal(published.status, 200, published.text);
    };
    const createResolved = async title => {
      const created = await post("/api/app/incidents", { title, components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }] });
      assert.equal(created.status, 201, created.text);
      const incident = created.body.incident;
      const assigned = await api(`/api/app/incidents/${incident.id}/owner`, { method: "PUT", body: JSON.stringify({ operatorId: owner.id }) });
      assert.equal(assigned.status, 200, assigned.text);
      await publishUpdate(incident, "Resolved");
      return (await api(`/api/app/incidents/${incident.id}`)).body.incident;
    };
    const publishReport = async incident => {
      const fields = { summary: "Synthetic Lamp requests recovered.", timeline: "Operators restored the service and verified requests.", cause: "A synthetic capacity change exhausted request workers.", remediation: "The capacity change was reverted and worker limits corrected." };
      const saved = await api(`/api/app/incidents/${incident.id}/report`, { method: "PUT", body: JSON.stringify(fields) });
      assert.equal(saved.status, 200, saved.text);
      const published = await post(`/api/app/incidents/${incident.id}/report/publish`, { channels: [] });
      assert.equal(published.status, 200, published.text);
      const stored = (await api(`/api/app/incidents/${incident.id}/report`)).body.report;
      assert.equal(stored.id, published.body.report.id);
      assert.ok(stored.publishedAt);
      const publicPage = await fixture.raw(`${pageOrigin}/incidents/${incident.reference}`);
      assert.equal(publicPage.status, 200);
      assert.ok((await publicPage.text()).includes(fields.remediation), "a waived report can still reach its public incident page");
    };
    await advance(Date.now() + 1_000);
    const incident = await createResolved("synthetic-lamp-12");
    const publicationControl = await createResolved("synthetic-lamp-13");
    assert.equal((await fixture.raw(`/api/app/incidents/${incident.id}/report`)).status, 401, "the report door requires operator authentication");
    assert.equal((await fixture.raw(`${pageOrigin}/api/app/incidents/${incident.id}/report`)).status, 404, "the private report door is absent from the public host");
    const resolvedAt = Date.parse(incident.resolvedAt);
    const visibleText = row => row.url === teams
      ? row.body.attachments[0].content.body.map(block => block.text).join("\n").replace(/\\(.)/g, "$1")
      : row.body.text;
    const subject = record => `Lamp report follow-up: ${record.reference}`;
    const reportMail = record => fixture.messages.filter(message => message.subject === subject(record));
    const reportPosts = record => posts.filter(row => visibleText(row).includes(subject(record)));
    const assertReminders = async (record, count) => {
      await eventuallyFollowUp(() => reportMail(record), rows => rows.length === count, `${count} report email acceptances for ${record.reference}`);
      await eventuallyFollowUp(() => reportPosts(record), rows => rows.length === count * 2, `${count} report acceptances per operator channel for ${record.reference}`);
      const link = `${fixture.appOrigin}/app/incidents/${record.id}#post-incident-report`;
      for (const message of reportMail(record)) {
        assert.deepEqual(message.to, [owner.email], "only the communication owner receives report email");
        assert.equal(message.text, `${record.reference} ${record.title} is owing a post-incident report. Write or waive it here: ${link}`);
        for (const value of privateSubscriberData) assert.ok(!JSON.stringify(message).includes(value), "report email excludes subscriber identity and consent data");
      }
      for (const url of [slack, teams]) assert.equal(reportPosts(record).filter(row => row.url === url).length, count);
      for (const row of reportPosts(record)) {
        const body = visibleText(row);
        assert.ok(body.includes(record.reference));
        assert.ok(body.includes(link));
        for (const value of privateSubscriberData) assert.ok(!JSON.stringify(row.body).includes(value), "report alerts contain no subscriber data");
      }
      assert.equal(posts.filter(row => row.url === publicationOnly).length, 0, "publication-only channels receive no report reminder");
      assert.equal(fixture.messages.filter(message => message.to.includes(subscriber)).length, 1, "report reminders send no subscriber mail");
      assert.equal(fixture.messages.filter(message => message.to.includes(imported.subscriber.destination)).length, 0, "historical import does not mail its pending subscriber");
    };
    const assertHistoricalSilence = async () => {
      const owing = (await api("/api/app/reports/owing")).body.incidentIds;
      const followUps = (await api("/api/app/overview/follow-ups")).body.followUps;
      for (const historical of imported.reports) {
        assert.ok(owing.includes(historical.id), "historical-only imports can owe reports privately");
        assert.ok(followUps.some(row => row.id === `report:${historical.id}`));
        assert.ok(!followUps.some(row => row.id === `report-reminder:${historical.id}`), "historical-only imports create no automatic reminder obligation");
        await assertReminders(historical, 0);
      }
    };
    await tick(resolvedAt + 7 * DAY - 1);
    await assertReminders(incident, 0);
    assert.ok(!(await api("/api/app/reports/owing")).body.incidentIds.includes(incident.id));
    await tick(resolvedAt + 7 * DAY);
    await assertReminders(incident, 1);
    assert.ok((await api("/api/app/reports/owing")).body.incidentIds.includes(incident.id));
    await tick(resolvedAt + 7 * DAY);
    await assertReminders(incident, 1);
    await tick(resolvedAt + 14 * DAY);
    await assertReminders(incident, 2);
    await assertReminders(publicationControl, 2);
    await assertHistoricalSilence();
    await publishReport(publicationControl);
    const waiverPath = `/api/app/incidents/${incident.id}/report/waive`;
    const refused = await post(waiverPath, { reason: "  " });
    assert.equal(refused.status, 400, refused.text);
    assert.equal((await api(`/api/app/incidents/${incident.id}/report`)).body.waiver, null);
    assert.equal((await api(`/api/app/audit-log?action=report.waived&limit=100`)).body.entries.filter(row => row.entityId === incident.id).length, 0);
    await tick(resolvedAt + 14 * DAY);
    await assertReminders(incident, 2);
    const waiverBefore = now;
    await advance(now + 1_000);
    const waived = await post(waiverPath, { reason: "Synthetic Lamp customer review already covers this report." });
    assert.equal(waived.status, 200, waived.text);
    await advance(now + 1_000);
    const waiverAfter = now;
    const storedWaiver = (await api(`/api/app/incidents/${incident.id}/report`)).body.waiver;
    assert.deepEqual(storedWaiver, waived.body.waiver);
    assert.ok(Date.parse(storedWaiver.createdAt) >= waiverBefore && Date.parse(storedWaiver.createdAt) <= waiverAfter, "stored waiver time falls inside independently controlled request bounds");
    await tick(resolvedAt + 21 * DAY);
    await assertReminders(incident, 2);
    await assertReminders(publicationControl, 2);
    assert.ok(!(await api("/api/app/reports/owing")).body.incidentIds.includes(incident.id));
    const entries = (await api("/api/app/audit-log?action=report.waived&limit=100")).body.entries.filter(row => row.entityId === incident.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actorId, owner.id);
    assert.equal(entries[0].reason, "Synthetic Lamp customer review already covers this report.");
    assert.equal(entries[0].createdAt, storedWaiver.createdAt, "one attributed waiver audit carries the persisted waiver instant");
    await publishReport(incident);
    await tick(resolvedAt + 28 * DAY);
    await assertReminders(incident, 2);
    await assertReminders(publicationControl, 2);
    await assertHistoricalSilence();
    const historical = imported.reports[0];
    await publishUpdate(historical, "Identified");
    await advance(now + 1_000);
    await publishUpdate(historical, "Resolved");
    const live = (await api(`/api/app/incidents/${historical.id}`)).body.incident;
    assert.ok(Date.parse(live.resolvedAt) > Date.parse(historical.resolvedAt), "live resolution replaces the imported historical due boundary");
    const dueAt = Date.parse(live.resolvedAt) + 7 * DAY;
    const reminder = (await api("/api/app/overview/follow-ups")).body.followUps.find(row => row.id === `report-reminder:${live.id}`);
    assert.equal(reminder?.dueAt, new Date(dueAt).toISOString(), "a live publication makes the imported incident eligible for automatic report follow-up");
    await tick(dueAt - 1);
    await assertReminders(live, 0);
    await tick(dueAt);
    await assertReminders(live, 1);
    await tick(dueAt);
    await assertReminders(live, 1);
    await assertReminders(imported.reports[1], 0);
    await assertReminders(incident, 2);
    await assertReminders(publicationControl, 2);
  } finally { await fixture.close(); }
}
