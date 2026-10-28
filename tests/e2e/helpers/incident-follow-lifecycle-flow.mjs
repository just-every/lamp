import assert from "node:assert/strict";
import { eventuallySubscriber } from "./subscriber-management-fixture.mjs";

const DAY = 86_400_000;

/** Report retention, reopening, deadline and privacy use the same live doors. */
export async function incidentFollowLifecycleFlow(fixture, component) {
  const { api, post, subscribe, list, messagesFor, create, publish, scope, tick, raw } = fixture;
  await fixture.setIncludeReport(true);
  const incident = await create(component, "Synthetic Lamp report-follow incident");
  await publish(incident, "Synthetic Lamp report-follow initial publication.");
  const email = "synthetic-lamp-follow-report@example.test";
  assert.equal((await subscribe(incident.id, { email })).status, 202);
  await fixture.confirm(email);
  const subscriber = (await list()).find(row => row.destination === email);
  assert.ok(subscriber);
  assert.equal((await scope(subscriber.id)).include_report, 1);
  await publish(incident, "Synthetic Lamp report-follow first resolution.", "Resolved");
  assert.equal((await scope(subscriber.id)).ended_at, null, "including the report keeps a delivered-resolution subscription open");
  await publish(incident, "Synthetic Lamp report-follow reopened before ending.", "Investigating");
  assert.ok(messagesFor(email).some(message => message.text.includes("Synthetic Lamp report-follow reopened before ending.")));
  await publish(incident, "Synthetic Lamp report-follow final resolution.", "Resolved");
  const path = `/api/app/incidents/${incident.id}/report`;
  const report = await api(path, { method: "PUT", body: JSON.stringify({
    summary: "Synthetic Lamp incident report delivered to its followers.",
    timeline: "The operator investigated, restored service and verified recovery.",
    cause: "An operator identified an exhausted connection pool.",
    remediation: "The operator restored capacity and added a saturation alert.",
  }) });
  assert.equal(report.status, 200, report.text);
  const reportPublication = await post(`${path}/publish`, { channels: ["email"] });
  assert.equal(reportPublication.status, 200, reportPublication.text);
  const reportRows = (await api("/api/app/deliveries?limit=100")).body.deliveries.filter(row => row.subscriberId === subscriber.id && row.incidentReportId === reportPublication.body.report.id);
  assert.equal(reportRows.length, 1, "one report notification is captured");
  await tick();
  await eventuallySubscriber(() => messagesFor(email), rows => rows.some(message => message.text.includes("Synthetic Lamp incident report delivered to its followers.")), "the report itself reaches its incident follower");
  await fixture.receive(reportRows, "published incident report");
  assert.ok((await scope(subscriber.id)).ended_at, "report publication ends incident following");
  const count = messagesFor(email).length;
  await publish(incident, "Synthetic Lamp update after report ending.", "Investigating");
  assert.equal(messagesFor(email).length, count, "an ended report subscription receives no later publication");
  const endedAt = Date.parse((await scope(subscriber.id)).ended_at);
  await tick(endedAt + DAY);
  await fixture.erased(email, "the published-report subscription is erased within 24 hours");

  const deadlineIncident = await create(component, "Synthetic Lamp thirty-day incident");
  await publish(deadlineIncident, "Synthetic Lamp deadline initial update.");
  const deadlineEmail = "synthetic-lamp-follow-deadline@example.test";
  assert.equal((await subscribe(deadlineIncident.id, { email: deadlineEmail })).status, 202);
  await fixture.confirm(deadlineEmail);
  const deadlineSubscriber = (await list()).find(row => row.destination === deadlineEmail);
  await publish(deadlineIncident, "Synthetic Lamp deadline resolution.", "Resolved");
  const resolvedScope = await scope(deadlineSubscriber.id);
  assert.ok(resolvedScope.resolution_delivered_at, "the resolution has a signed recipient-delivery fact");
  const resolutionAt = Date.parse(resolvedScope.resolution_at);
  await tick(resolutionAt + 30 * DAY - 1);
  assert.equal((await scope(deadlineSubscriber.id)).ended_at, null, "the report window remains open before thirty days");
  await tick(resolutionAt + 30 * DAY);
  const expired = (await list()).find(row => row.id === deadlineSubscriber.id);
  assert.equal(expired.state, "deactivated", "the report window ends at thirty days without a report");
  const deadlineCount = messagesFor(deadlineEmail).length;
  await publish(deadlineIncident, "Synthetic Lamp deadline late reopening.", "Investigating");
  assert.equal(messagesFor(deadlineEmail).length, deadlineCount, "a reopening after thirty-day expiry sends nothing");
  await tick(resolutionAt + 31 * DAY);
  await fixture.erased(deadlineEmail, "the thirty-day deadline address is erased within the next 24 hours");

  const unsubscribeEmail = "synthetic-lamp-follow-unsubscribe@example.test";
  assert.equal((await subscribe(deadlineIncident.id, { email: unsubscribeEmail })).status, 202);
  await fixture.confirm(unsubscribeEmail);
  assert.equal((await subscribe(deadlineIncident.id, { email: unsubscribeEmail })).status, 202);
  const management = messagesFor(unsubscribeEmail).find(message => /\/manage\//.test(message.text));
  assert.ok(management);
  const manageUrl = management.text.match(/https?:\/\/\S+\/manage\/\S+/)[0];
  const managed = await raw(manageUrl);
  assert.equal(managed.status, 200);
  const html = await managed.text();
  assert.ok(html.includes(`Following ${deadlineIncident.reference}`));
  const unsubscribeUrl = new URL(html.match(/action="([^"]*\/unsubscribe\/[^\"]+)"/)[1], fixture.origin).href;
  const unsubscribed = await raw(unsubscribeUrl, { method: "POST", headers: { Origin: fixture.origin, Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded" }, body: "action=unsubscribe" });
  assert.equal(unsubscribed.status, 200);
  assert.equal((await raw(manageUrl)).status, 404, "unsubscribe revokes the management token immediately");
  const unsubscribeCount = messagesFor(unsubscribeEmail).length;
  await publish(deadlineIncident, "Synthetic Lamp update after token unsubscribe.");
  assert.equal(messagesFor(unsubscribeEmail).length, unsubscribeCount);
}
