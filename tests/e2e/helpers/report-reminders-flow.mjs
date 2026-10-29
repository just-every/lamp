import assert from "node:assert/strict";
import { openFollowUpsRuntime, eventuallyFollowUp, pageOrigin } from "./follow-ups-runtime.mjs";

/** HIST-003 and AUTO-004: the real report and scheduled doors share a controlled
 * clock, with fake Resend, Slack and Teams edges. No report obligation, reminder,
 * outbox or delivery record is manufactured. */
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
  const advanceClock = async time => {
    const changed = await fixture.raw("/test/clock", { method: "PUT", body: JSON.stringify({ now: time }) });
    assert.equal(changed.status, 204, await changed.text());
    // Cross-day reads use a newly issued native session at the controlled time.
    await fixture.signIn(undefined, { fresh: true });
  };
  const tick = async time => {
    await advanceClock(time);
    const result = await (await runtime.getWorker()).scheduled({ cron: "* * * * *", scheduledTime: time });
    assert.equal(result.outcome, "ok");
  };
  try {
    const startedAt = Date.UTC(2030, 0, 15, 12);
    await advanceClock(startedAt);
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
    const confirmed = await fixture.raw(invitation.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0]);
    assert.equal(confirmed.status, 200);
    const createIncident = async (title, state) => {
      const created = await post("/api/app/incidents", { title, components: [{ componentId: component.id, state, relationship: "Primary" }] });
      assert.equal(created.status, 201, created.text);
      const incident = created.body.incident;
      const assigned = await api(`/api/app/incidents/${incident.id}/owner`, { method: "PUT", body: JSON.stringify({ operatorId: owner.id }) });
      assert.equal(assigned.status, 200, assigned.text);
      const saved = await api(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle: "Investigating", affectedAudience: "Synthetic Lamp readers", customerImpact: "Requests were unavailable.", whatStillWorks: "", details: "Operators are investigating.", nextUpdateAt: new Date(startedAt + 3_600_000).toISOString() }) });
      assert.equal(saved.status, 200, saved.text);
      const published = await post(`/api/app/incidents/${incident.id}/publish`, { channels: [] });
      assert.equal(published.status, 200, published.text);
      return incident;
    };
    const majorCase = await createIncident("synthetic-lamp-12", "Major outage");
    const partialCase = await createIncident("synthetic-lamp-13", "Partially unavailable");
    await advanceClock(startedAt + 1000);
    const resolveIncident = async (incident, state) => {
      const saved = await api(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle: "Resolved", affectedAudience: "Synthetic Lamp readers", customerImpact: "Requests were unavailable.", whatStillWorks: "", details: "Service has recovered.", nextUpdateAt: null }) });
      assert.equal(saved.status, 200, saved.text);
      const published = await post(`/api/app/incidents/${incident.id}/publish`, { channels: [] });
      assert.equal(published.status, 200, published.text);
      const read = await api(`/api/app/incidents/${incident.id}`);
      assert.equal(read.status, 200, read.text);
      assert.equal(read.body.incident.lifecycle, "Resolved");
      assert.equal(read.body.incident.impact, state, "resolution retains the incident's severe claim");
      return read.body.incident;
    };
    const incident = await resolveIncident(majorCase, "Major outage");
    const partial = await resolveIncident(partialCase, "Partially unavailable");
    const resolvedAt = Date.parse(incident.resolvedAt);
    assert.equal(partial.resolvedAt, incident.resolvedAt, "both severe cases resolve at the controlled instant");
    const DAY = 86_400_000;
    const dueAt = new Date(resolvedAt + 7 * DAY).toISOString();
    const assertReportState = async due => {
      const owing = await api("/api/app/reports/owing");
      assert.equal(owing.status, 200, owing.text);
      const overview = await api("/api/app/overview/follow-ups");
      assert.equal(overview.status, 200, overview.text);
      for (const record of [incident, partial]) {
        assert.equal(owing.body.incidentIds.includes(record.id), due, `${record.impact} report-due listing at the seven-day boundary`);
        const followUp = overview.body.followUps.find(row => row.id === `report:${record.id}`);
        assert.ok(followUp, `${record.impact} has an Overview report obligation`);
        assert.equal(followUp.dueAt, dueAt);
        assert.equal(followUp.link, `/app/incidents/${record.id}#post-incident-report`);
        assert.deepEqual(followUp.owner, { id: owner.id, displayName: owner.displayName });
        if (due) {
          assert.equal(followUp.failure?.state, "failed", "Overview marks the report overdue at the same instant");
          assert.equal(followUp.failure.occurredAt, dueAt);
        } else assert.equal(followUp.failure, null, "Overview does not mark a report overdue before seven days");
      }
    };
    const assertExcluded = async records => {
      const owing = await api("/api/app/reports/owing");
      assert.equal(owing.status, 200, owing.text);
      const overview = await api("/api/app/overview/follow-ups");
      assert.equal(overview.status, 200, overview.text);
      for (const record of records) {
        assert.ok(!owing.body.incidentIds.includes(record.id), "published or waived reports are absent from the report-due listing");
        for (const kind of ["report", "report-reminder"]) assert.ok(!overview.body.followUps.some(row => row.id === `${kind}:${record.id}`), "publication or waiver removes the Overview obligation");
      }
    };
    const reportSubject = `Lamp report follow-up: ${incident.reference}`;
    const reportMail = () => fixture.messages.filter(message => message.subject === reportSubject);
    const visibleText = row => row.url === teams
      ? row.body.attachments[0].content.body.map(block => block.text).join("\n").replace(/\\(.)/g, "$1")
      : row.body.text;
    const reportPosts = () => posts.filter(row => visibleText(row).includes(reportSubject));
    const assertReminders = async count => {
      await eventuallyFollowUp(reportMail, rows => rows.length === count, `${count} report email acceptances`);
      await eventuallyFollowUp(reportPosts, rows => rows.length === count * 2, `${count} report acceptances per operator channel`);
      for (const message of reportMail()) assert.deepEqual(message.to, [owner.email], "only the communication owner receives report email");
      for (const url of [slack, teams]) assert.equal(reportPosts().filter(row => row.url === url).length, count);
      for (const row of reportPosts()) {
        const body = visibleText(row);
        assert.ok(body.includes(incident.reference));
        assert.ok(body.includes(`${fixture.appOrigin}/app/incidents/${incident.id}#post-incident-report`));
        assert.ok(!body.includes(subscriber), "report alerts contain no subscriber destination");
      }
      assert.equal(posts.filter(row => row.url === publicationOnly).length, 0, "publication-only channels receive no report reminder");
      assert.equal(fixture.messages.filter(message => message.to.includes(subscriber)).length, 1, "report reminders send no subscriber mail");
    };
    await advanceClock(resolvedAt + 7 * DAY - 1);
    await assertReportState(false);
    await advanceClock(resolvedAt + 7 * DAY);
    await assertReportState(true);
    await tick(resolvedAt + 7 * DAY);
    await assertReminders(1);
    const partialMail = () => fixture.messages.filter(message => message.subject === `Lamp report follow-up: ${partial.reference}`);
    await eventuallyFollowUp(partialMail, rows => rows.length === 1, "the partial outage also receives its due-day reminder");
    const reportPath = `/api/app/incidents/${partial.id}/report`;
    const savedReport = await api(reportPath, { method: "PUT", body: JSON.stringify({ summary: "Synthetic Lamp requests failed and recovered.", timeline: "Operators investigated and resolved the incident.", cause: "An operator traced a configuration fault.", remediation: "The operator corrected the configuration and verified recovery." }) });
    assert.equal(savedReport.status, 200, savedReport.text);
    const publishedReport = await post(`${reportPath}/publish`, { channels: [] });
    assert.equal(publishedReport.status, 200, publishedReport.text);
    assert.ok(publishedReport.body.report.publishedAt);
    await assertExcluded([partial]);
    await tick(resolvedAt + 7 * DAY);
    await assertReminders(1);
    await tick(resolvedAt + 14 * DAY);
    await assertReminders(2);
    assert.equal(partialMail().length, 1, "report publication stops weekly email");
    await assertExcluded([partial]);
    const waiverPath = `/api/app/incidents/${incident.id}/report/waive`;
    const refused = await post(waiverPath, { reason: "  " });
    assert.equal(refused.status, 400, refused.text);
    assert.equal((await api(`/api/app/incidents/${incident.id}/report`)).body.waiver, null);
    await tick(resolvedAt + 14 * DAY);
    await assertReminders(2);
    const waived = await post(waiverPath, { reason: "Synthetic Lamp customer review already covers this report." });
    assert.equal(waived.status, 200, waived.text);
    await tick(resolvedAt + 21 * DAY);
    await assertReminders(2);
    assert.equal(partialMail().length, 1, "published report stays silent in later weeks");
    assert.ok(!(await api("/api/app/reports/owing")).body.incidentIds.includes(incident.id));
    await assertExcluded([incident, partial]);
    const entries = (await api("/api/app/audit-log?action=report.waived&limit=100")).body.entries.filter(row => row.entityId === incident.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actorId, owner.id);
    assert.equal(entries[0].reason, "Synthetic Lamp customer review already covers this report.");
  } finally { await fixture.close(); }
}
