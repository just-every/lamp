import assert from "node:assert/strict";
import { eventuallySubscriber, pageOrigin } from "./subscriber-management-fixture.mjs";

/** A running Queue consumer may already have accepted a newly committed notice.
 * Otherwise drive its durable dispatch through the owner's real retry door. */
export async function statuspageWebhookMaintenance({ fixture, component, accepted, receiverErrors }) {
  const { api, post } = fixture;
  const before = accepted.length;
  const startsAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const endsAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const created = await post("/api/app/maintenance", { title: "Synthetic Lamp compatible maintenance", startsAt, endsAt, componentIds: [component.id], autoStart: false, autoComplete: false });
  assert.equal(created.status, 201, created.text);
  const maintenance = created.body.maintenance;
  const deliver = async (count, status) => {
    await eventuallySubscriber(async () => {
      if (receiverErrors[0]) throw receiverErrors[0];
      const response = await fixture.raw(`${pageOrigin}/api/v2/scheduled-maintenances.json`);
      assert.equal(response.status, 200);
      return (await response.json()).scheduled_maintenances.find(row => row.shortlink.endsWith(`/maintenance/${maintenance.reference}`));
    }, row => row?.incident_updates.length === count && row.status === status, "maintenance notice is present in its immutable public generation");
    const received = () => accepted.filter(record => record.body.incident?.id && record.body.incident.shortlink.endsWith(`/maintenance/${maintenance.reference}`));
    if (received().length < count) {
      const pending = await api("/api/app/overview/follow-ups");
      assert.equal(pending.status, 200, pending.text);
      if (receiverErrors[0]) throw receiverErrors[0];
      // Re-read the receiver after the request: acceptance can precede its reply.
      if (received().length < count) {
        const dispatch = pending.body.followUps.filter(row => row.kind === "notification-dispatch");
        assert.equal(dispatch.length, 1, "the unaccepted maintenance notice has one durable dispatch");
        const retry = await post("/api/app/overview/follow-ups/retry", { id: dispatch[0].id, occurrence: dispatch[0].occurrence });
        assert.equal(retry.status, 202, retry.text);
      }
    }
    await eventuallySubscriber(() => {
      if (receiverErrors[0]) throw receiverErrors[0];
      return received();
    }, records => records.length === count, "the strict receiver accepts the maintenance notice through the real Queue consumer");
    assert.equal(received().at(-1).body.incident.status, status);
    assert.equal(received().at(-1).body.incident.incident_updates.length, count);
    await eventuallySubscriber(async () => (await api("/api/app/deliveries?channel=webhook&limit=100")).body.deliveries.filter(row => row.maintenanceId === maintenance.id),
      rows => rows.length === count && rows.every(row => row.outcome === "delivered"), "every maintenance notice has exactly one completed public delivery record");
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
