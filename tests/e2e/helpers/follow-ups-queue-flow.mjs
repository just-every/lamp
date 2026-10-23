import assert from "node:assert/strict";
import { eventuallyFollowUp } from "./follow-ups-runtime.mjs";

const endpoint = "/api/app/overview/follow-ups";

/** A real failed webhook delivery leaves an unfinished outbox. The existing
 * proxy then rejects the actual JOBS.send made by the operator Retry action. */
export async function followUpsQueueFlow({ fixture, component, createIncident, publish }) {
  const { api, post } = fixture;
  const before = new Set((await api(endpoint)).body.followUps.map(row => row.id));
  const subscribed = await post("/api/app/subscribers/webhook", {
    destination: "https://receiver.example.test/synthetic-lamp-1",
    contactEmail: "synthetic-lamp-webhook-contact@example.test", componentIds: [component.id],
  });
  assert.equal(subscribed.status, 201, subscribed.text);
  const incident = await createIncident("Synthetic Lamp queued dispatch");
  await publish(incident.id, { channels: ["webhook"] });
  await eventuallyFollowUp(() => fixture.webhookRequests.length, count => count > 0, "publication reaches the failing webhook network edge");
  const pending = await eventuallyFollowUp(async () => (await api(endpoint)).body.followUps,
    rows => rows.some(row => row.kind === "notification-dispatch" && !before.has(row.id)), "real unfinished subscriber outbox appears");
  const dispatch = pending.find(row => row.kind === "notification-dispatch" && !before.has(row.id));
  const queue = async outage => {
    const result = await fixture.raw("/test/queue", { method: "PUT", body: JSON.stringify({ outage }) });
    assert.equal(result.status, 204);
  };
  await queue(true);
  const attemptsBefore = (await (await fixture.raw("/test/queue")).json()).attempts;
  const retry = occurrence => post(`${endpoint}/retry`, { id: dispatch.id, occurrence });
  const rejected = await retry(dispatch.occurrence);
  assert.equal(rejected.status, 503, rejected.text);
  assert.equal((await (await fixture.raw("/test/queue")).json()).attempts, attemptsBefore + 1, "Retry exercised the failing real Queue boundary");
  const failed = (await api(endpoint)).body.followUps.find(row => row.id === dispatch.id);
  assert.equal(failed?.failure?.state, "failed");
  assert.ok(failed.failure.message.trim());
  assert.ok(Number.isFinite(Date.parse(failed.failure.occurredAt)));
  assert.deepEqual((await api(endpoint)).body.followUps.find(row => row.id === dispatch.id), failed, "failure persists across reads without being silently discarded");
  const dismiss = (occurrence, reason) => post(`${endpoint}/dismiss`, { id: dispatch.id, occurrence, reason });
  assert.equal((await dismiss(failed.occurrence, "   ")).status, 400);
  assert.equal((await dismiss(`${failed.occurrence}:stale`, "Synthetic Lamp stale dismissal")).status, 409);
  const reason = "Synthetic Lamp operator investigated the failed Queue dispatch";
  assert.equal((await dismiss(failed.occurrence, reason)).status, 200);
  assert.ok(!(await api(endpoint)).body.followUps.some(row => row.id === dispatch.id));
  const audit = await api("/api/app/audit-log?action=follow-up.dismissed&limit=100");
  assert.equal(audit.status, 200, audit.text);
  assert.ok(audit.body.entries.some(entry => entry.reason === reason && entry.actorId), "reasoned dismissal has an attributed audit entry");
  assert.equal((await retry(failed.occurrence)).status, 503, "another real Queue failure is a new occurrence after dismissal");
  const recurrence = (await api(endpoint)).body.followUps.find(row => row.id === dispatch.id);
  assert.equal(recurrence?.failure?.state, "failed");
  assert.notEqual(recurrence.occurrence, failed.occurrence);
  assert.equal((await dismiss(failed.occurrence, "Synthetic Lamp old occurrence")).status, 409);
  await queue(false);
  fixture.recoverWebhook();
  const accepted = await retry(recurrence.occurrence);
  assert.equal(accepted.status, 202, accepted.text);
  await eventuallyFollowUp(async () => (await api(endpoint)).body.followUps,
    rows => !rows.some(row => row.id === dispatch.id), "the real healthy Queue consumer completes dispatch and removes its follow-up");
  const delivered = await api("/api/app/deliveries?channel=webhook&limit=100");
  assert.ok(delivered.body.deliveries.some(row => row.subscriberId === subscribed.body.subscriber.id && row.outcome === "delivered"));
  assert.ok(fixture.webhookRequests.length >= 2, "the recovered endpoint received the real queued notification");
  assert.equal((await retry(recurrence.occurrence)).status, 409, "a completed dispatch cannot be retried as unfinished work");
}
