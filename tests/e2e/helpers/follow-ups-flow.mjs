import assert from "node:assert/strict";
import { openFollowUpsRuntime, eventuallyFollowUp, pageOrigin } from "./follow-ups-runtime.mjs";
import { followUpsImport } from "./follow-ups-import.mjs";
import { followUpsQueueFlow } from "./follow-ups-queue-flow.mjs";
import { followUpsNotificationFlow } from "./follow-ups-notification-flow.mjs";

const endpoint = "/api/app/overview/follow-ups";
const iso = value => new Date(value).toISOString();
const hour = 3_600_000;

/** AUTO-003 public-door journey composed into the existing reminder case.
 * No SQL seeds or mutations create an obligation or its failure state. */
export async function followUpsFlow() {
  const fixture = await openFollowUpsRuntime();
  const { api, post, request } = fixture;
  try {
    assert.equal((await fixture.raw(endpoint)).status, 401, "follow-ups require an operator session");
    assert.equal((await fixture.runtime.dispatchFetch(pageOrigin + endpoint)).status, 404, "follow-ups are absent from the public host");
    const owner = (await api("/api/app/session")).body.operator;
    const componentResponse = await post("/api/app/components", { groupId: null, name: "Synthetic Lamp follow-up API", description: "", internal: false, displayOrder: 0, note: "" });
    assert.equal(componentResponse.status, 201, componentResponse.text);
    const component = componentResponse.body.component;
    const createIncident = async title => {
      const created = await post("/api/app/incidents", { title, components: [{ componentId: component.id, state: "Partially unavailable", relationship: "Primary" }] });
      assert.equal(created.status, 201, created.text);
      return created.body.incident;
    };
    const saveDraft = async (id, overrides = {}) => {
      const saved = await api(`/api/app/incidents/${id}/draft`, { method: "PUT", body: JSON.stringify({
        lifecycle: "Identified", affectedAudience: "Synthetic Lamp customers", customerImpact: "Requests are delayed.",
        whatStillWorks: "", details: "Operators are investigating.", nextUpdateAt: iso(Date.now() + hour), ...overrides,
      }) });
      assert.equal(saved.status, 200, saved.text);
      return saved.body.draft;
    };
    const publish = async (id, { channels = [], lifecycle = "Identified", nextUpdateAt = iso(Date.now() + hour) } = {}) => {
      await saveDraft(id, { lifecycle, nextUpdateAt: lifecycle === "Resolved" ? null : nextUpdateAt });
      const published = await post(`/api/app/incidents/${id}/publish`, { channels, ...(lifecycle === "Resolved" ? { overrideReason: "Synthetic Lamp operator verified the fixture recovery" } : {}) });
      assert.equal(published.status, 200, published.text);
      return published.body.update;
    };
    const read = async () => {
      const result = await api(endpoint);
      assert.equal(result.status, 200, result.text);
      for (const row of result.body.followUps) {
        assert.ok(row.id && row.kind && row.title && row.occurrence);
        assert.ok(Number.isFinite(Date.parse(row.dueAt)), `${row.kind} has its actual due instant`);
        assert.ok(row.stopCondition.trim(), `${row.kind} states how the obligation stops`);
        assert.ok(row.link.startsWith("/app/"), `${row.kind} has a stable operator link`);
        assert.ok(row.owner === null || (row.owner.id && row.owner.displayName));
        assert.ok(row.failure === null || (row.failure.state === "failed" && row.failure.message && Number.isFinite(Date.parse(row.failure.occurredAt))));
      }
      return result.body.followUps;
    };
    const find = (rows, kind, record) => rows.find(row => row.kind === kind && (row.id.endsWith(`:${record.id}`) || row.link.includes(record.id)));
    const expectAbsent = async ids => {
      const rows = await read();
      for (const id of ids) assert.ok(!rows.some(row => row.id === id), `completed obligation ${id} is absent`);
    };
    const committed = iso(Date.now() + 2 * hour);
    const incident = await createIncident("Synthetic Lamp committed update");
    const update = await publish(incident.id, { nextUpdateAt: committed });
    const scheduledIncident = await createIncident("Synthetic Lamp scheduled update");
    await saveDraft(scheduledIncident.id, { nextUpdateAt: iso(Date.now() + 2 * hour) });
    const scheduledAt = iso(Date.now() + hour);
    const scheduled = await post(`/api/app/incidents/${scheduledIncident.id}/draft/schedule`, { publishAt: scheduledAt, channels: [] });
    assert.equal(scheduled.status, 202, scheduled.text);
    const maintenance = async (title, startsAt, endsAt, autoStart, autoComplete) => {
      const created = await post("/api/app/maintenance", { title, startsAt, endsAt, autoStart, autoComplete, componentIds: [component.id] });
      assert.equal(created.status, 201, created.text);
      return created.body.maintenance;
    };
    const future = await maintenance("Synthetic Lamp upcoming window", iso(Date.now() + 23 * hour), iso(Date.now() + 24 * hour), true, true);
    const startDue = await maintenance("Synthetic Lamp manual start due", iso(Date.now() - hour), iso(Date.now() + hour), false, false);
    const overrun = await maintenance("Synthetic Lamp manual completion due", iso(Date.now() - 2 * hour), iso(Date.now() - hour), false, false);
    assert.equal((await post(`/api/app/maintenance/${overrun.id}/start`)).status, 200);
    const imported = await followUpsImport(fixture);
    const reports = [];
    for (let number = 1; number <= 2; number++) {
      const reportIncident = await createIncident(`Synthetic Lamp native report ${number}`);
      await publish(reportIncident.id, { lifecycle: "Resolved" });
      reports.push((await api(`/api/app/incidents/${reportIncident.id}`)).body.incident);
    }
    const rows = await read();
    for (const historical of imported.reports) {
      assert.ok(find(rows, "report", historical), "silent imported history can still owe an operator report");
      assert.equal(find(rows, "report-reminder", historical), undefined, "MOVE-002 historical imports create no automatic reminder obligation");
    }
    const promise = rows.find(row => row.id === `next-update:${update.id}`);
    assert.equal(promise?.dueAt, committed);
    assert.deepEqual(promise.owner, { id: owner.id, displayName: owner.displayName });
    assert.equal(promise.failure, null);
    const publication = rows.find(row => row.id === `scheduled-publication:${scheduled.body.draft.id}`);
    assert.equal(publication?.dueAt, scheduledAt);
    assert.equal(publication.owner.id, owner.id);
    assert.equal((await post(`${endpoint}/dismiss`, { id: promise.id, occurrence: promise.occurrence, reason: "Synthetic Lamp cannot dismiss unfinished nonfailure work" })).status, 409);
    const futureStart = find(rows, "maintenance-start", future);
    const futureEnd = find(rows, "maintenance-end", future);
    const reminder = find(rows, "maintenance-reminder", future);
    assert.equal(futureStart?.dueAt, future.startsAt);
    assert.equal(futureEnd?.dueAt, future.endsAt);
    assert.equal(reminder?.dueAt, iso(Date.parse(future.startsAt) - 24 * hour));
    const manualStart = find(rows, "maintenance-start", startDue);
    assert.equal(manualStart?.dueAt, startDue.startsAt);
    assert.equal(manualStart.failure.state, "failed", "an opted-out start stays visible when its actual start passes");
    const runningEnd = find(rows, "maintenance-end", overrun);
    const overrunEntry = find(rows, "maintenance-overrun", overrun);
    assert.equal(runningEnd?.dueAt, overrun.endsAt);
    assert.equal(overrunEntry?.dueAt, iso(Date.parse(overrun.endsAt) + 15 * 60_000));
    assert.equal(overrunEntry.failure.state, "failed");
    for (const report of reports) {
      assert.equal(find(rows, "report", report)?.dueAt, iso(Date.parse(report.resolvedAt) + 7 * 24 * hour));
      assert.equal(find(rows, "report-reminder", report)?.dueAt, iso(Date.parse(report.resolvedAt) + 7 * 24 * hour));
    }
    const invitation = find(rows, "imported-invitation", imported.subscriber);
    assert.equal(invitation?.dueAt, iso(Date.parse(imported.subscriber.createdAt) + 72 * hour));
    assert.equal(invitation.owner, null);
    assert.ok(invitation.link.includes(imported.jobId));
    const privateMetadata = JSON.stringify(rows);
    assert.ok(!privateMetadata.includes(imported.subscriber.destination), "imported addresses are absent from follow-up metadata");

    await publish(incident.id, { lifecycle: "Resolved" });
    assert.equal((await post(`/api/app/incidents/${scheduledIncident.id}/publish`, { channels: [] })).status, 200);
    await expectAbsent([promise.id, publication.id]);
    assert.equal((await post(`/api/app/maintenance/${future.id}/cancel`)).status, 200);
    await expectAbsent([futureStart.id, futureEnd.id, reminder.id]);
    assert.equal((await post(`/api/app/maintenance/${startDue.id}/start`)).status, 200);
    await expectAbsent([manualStart.id]);
    assert.equal((await post(`/api/app/maintenance/${startDue.id}/complete`)).status, 200);
    assert.equal((await post(`/api/app/maintenance/${overrun.id}/complete`)).status, 200);
    await expectAbsent([runningEnd.id, overrunEntry.id, `maintenance-end:${startDue.id}`]);
    const [waived, written] = reports;
    assert.equal((await post(`/api/app/incidents/${waived.id}/report/waive`, { reason: "Synthetic Lamp report is covered by the combined investigation" })).status, 200);
    const savedReport = await api(`/api/app/incidents/${written.id}/report`, { method: "PUT", body: JSON.stringify({ summary: "Requests failed and recovered.", timeline: "The historical incident was resolved.", cause: "An operator traced a configuration fault.", remediation: "The operator corrected the configuration and verified recovery." }) });
    assert.equal(savedReport.status, 200, savedReport.text);
    const publishedReport = await post(`/api/app/incidents/${written.id}/report/publish`, { channels: [] });
    assert.equal(publishedReport.status, 200, publishedReport.text);
    await expectAbsent(reports.flatMap(report => [`report:${report.id}`, `report-reminder:${report.id}`]));
    const invited = await post(`/api/app/statuspage-import/jobs/${imported.jobId}/send-invitations`);
    assert.equal(invited.status, 200, invited.text);
    const invitationMail = fixture.messages.find(message => message.to.includes(imported.subscriber.destination));
    assert.ok(invitationMail, "the explicit owner action sends the real confirmation email");
    const confirmation = invitationMail.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
    assert.equal((await fixture.runtime.dispatchFetch(confirmation)).status, 200);
    await expectAbsent([invitation.id]);
    await followUpsQueueFlow({ fixture, component, createIncident, publish });
    await followUpsNotificationFlow({ fixture, component, createIncident, publish });
    // Public-page requests cannot turn the operator-only dismissal into a write.
    assert.equal((await fixture.runtime.dispatchFetch(pageOrigin + `${endpoint}/dismiss`, { method: "POST", body: JSON.stringify({ id: promise.id, occurrence: promise.occurrence, reason: "Synthetic Lamp public rejection" }) })).status, 404);
    const denied = await request(`${endpoint}/dismiss`, { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" }, body: JSON.stringify({ id: promise.id, occurrence: promise.occurrence, reason: "Synthetic Lamp cross-site rejection" }) });
    assert.equal(denied.status, 403);
  } finally { await fixture.close(); }
}
