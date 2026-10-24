import assert from "node:assert/strict";
import { openFollowUpsRuntime, eventuallyFollowUp, pageOrigin } from "./follow-ups-runtime.mjs";

/** AUTO-004: the real report and scheduled doors, with fake Resend, Slack and
 * Teams edges. No reminder, outbox or delivery record is manufactured. */
export async function reportRemindersFlow() {
  const posts = [];
  const slack = "https://hooks.slack.com/services/synthetic-lamp-11/synthetic-lamp-12/synthetic-lamp-13";
  const teams = "https://synthetic-lamp-11.logic.azure.com/workflows/synthetic-lamp-12/triggers/manual/paths/invoke?sig=synthetic-lamp-13";
  const publicationOnly = "https://hooks.slack.com/services/synthetic-lamp-14/synthetic-lamp-15/synthetic-lamp-16";
  const fixture = await openFollowUpsRuntime({ providerEdge: async request => {
    if ([slack, teams, publicationOnly].includes(request.url)) {
      posts.push({ url: request.url, body: await request.json() });
      return new Response(request.url === teams ? "" : "ok", { status: 200 });
    }
  } });
  const { post, api, runtime } = fixture;
  const tick = async time => {
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
    const subscriber = "synthetic-lamp-report-private@example.test";
    const subscription = await fixture.raw(pageOrigin + "/subscribe", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: subscriber, componentId: component.id }) });
    assert.equal(subscription.status, 202);
    const invitation = fixture.messages.find(message => message.to.includes(subscriber));
    assert.ok(invitation, "the subscriber's consent mail crosses the provider edge");
    const confirmed = await fixture.raw(invitation.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0]);
    assert.equal(confirmed.status, 200);
    const created = await post("/api/app/incidents", { title: "synthetic-lamp-12", components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }] });
    assert.equal(created.status, 201, created.text);
    const incident = created.body.incident;
    const assigned = await api(`/api/app/incidents/${incident.id}/owner`, { method: "PUT", body: JSON.stringify({ operatorId: owner.id }) });
    assert.equal(assigned.status, 200, assigned.text);
    const saved = await api(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle: "Resolved", affectedAudience: "Synthetic Lamp readers", customerImpact: "Requests were unavailable.", whatStillWorks: "", details: "Service has recovered.", nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() }) });
    assert.equal(saved.status, 200, saved.text);
    const published = await post(`/api/app/incidents/${incident.id}/publish`, { channels: [] });
    assert.equal(published.status, 200, published.text);
    const resolvedAt = Date.parse((await api(`/api/app/incidents/${incident.id}`)).body.incident.resolvedAt);
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
    const DAY = 86_400_000;
    await tick(resolvedAt + 7 * DAY);
    await assertReminders(1);
    await tick(resolvedAt + 7 * DAY);
    await assertReminders(1);
    await tick(resolvedAt + 14 * DAY);
    await assertReminders(2);
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
    assert.ok(!(await api("/api/app/reports/owing")).body.incidentIds.includes(incident.id));
    const entries = (await api("/api/app/audit-log?action=report.waived&limit=100")).body.entries.filter(row => row.entityId === incident.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actorId, owner.id);
    assert.equal(entries[0].reason, "Synthetic Lamp customer review already covers this report.");
  } finally { await fixture.close(); }
}
