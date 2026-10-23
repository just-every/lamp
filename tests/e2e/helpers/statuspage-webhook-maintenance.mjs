import assert from "node:assert/strict";
import { eventuallySubscriber, pageOrigin } from "./subscriber-management-fixture.mjs";

/** Maintenance has real durable notices but no immediate request dispatcher.
 * Use the owner's existing retry door and real Queue consumer to deliver them. */
export async function statuspageWebhookMaintenance({ fixture, component, accepted, receiverErrors }) {
  const { api, post } = fixture;
  const before = accepted.length;
  const startsAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const endsAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const created = await post("/api/app/maintenance", { affectedAudience: "Customers using the scheduled service.", customerImpact: "Requests may be interrupted during this maintenance window.", title: "Synthetic Lamp compatible maintenance", startsAt, endsAt, componentIds: [component.id], autoStart: false, autoComplete: false });
  assert.equal(created.status, 201, created.text);
  const maintenance = created.body.maintenance;
  const deliver = async (count, status) => {
    await eventuallySubscriber(async () => {
      if (receiverErrors[0]) throw receiverErrors[0];
      const response = await fixture.raw(`${pageOrigin}/api/v2/scheduled-maintenances.json`);
      assert.equal(response.status, 200);
      return (await response.json()).scheduled_maintenances.find(row => row.shortlink.endsWith(`/maintenance/${maintenance.reference}`));
    }, row => row?.incident_updates.length === count && row.status === status, "maintenance notice is present in its immutable public generation");
    const pending = await api("/api/app/overview/follow-ups");
    assert.equal(pending.status, 200, pending.text);
    const dispatch = pending.body.followUps.filter(row => row.kind === "notification-dispatch");
    assert.equal(dispatch.length, 1, "this fixture has exactly the maintenance notice's unfinished dispatch");
    const retry = await post("/api/app/overview/follow-ups/retry", { id: dispatch[0].id, occurrence: dispatch[0].occurrence });
    assert.equal(retry.status, 202, retry.text);
    await eventuallySubscriber(() => {
      if (receiverErrors[0]) throw receiverErrors[0];
      return accepted.filter(record => record.body.incident?.id && record.body.incident.shortlink.endsWith(`/maintenance/${maintenance.reference}`));
    }, records => records.length === count, "the strict receiver accepts the maintenance notice through the real Queue consumer");
    assert.equal(accepted.at(-1).body.incident.status, status);
    assert.equal(accepted.at(-1).body.incident.incident_updates.length, count);
    await eventuallySubscriber(async () => (await api("/api/app/overview/follow-ups")).body.followUps,
      rows => !rows.some(row => row.id === dispatch[0].id), "the maintenance dispatch completes before its next lifecycle event");
  };
  await deliver(1, "scheduled");
  const extendedEnd = new Date(Date.parse(endsAt) + 3_600_000).toISOString();
  const rescheduled = await api(`/api/app/maintenance/${maintenance.id}/window`, { method: "PUT", body: JSON.stringify({ startsAt, endsAt: extendedEnd }) });
  assert.equal(rescheduled.status, 200, rescheduled.text);
  await deliver(2, "scheduled");
  assert.equal((await post(`/api/app/maintenance/${maintenance.id}/start`)).status, 200);
  await deliver(3, "in_progress");
  assert.equal((await post(`/api/app/maintenance/${maintenance.id}/complete`)).status, 200);
  await deliver(4, "completed");
  assert.equal(accepted.length, before + 4);
}
