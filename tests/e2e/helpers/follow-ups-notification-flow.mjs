import assert from "node:assert/strict";
import { eventuallyFollowUp, pageOrigin } from "./follow-ups-runtime.mjs";
import { assertOneOperatorEmail, settleOperatorEmails } from "./operator-email-proof.mjs";

const endpoint = "/api/app/overview/follow-ups";

/** Separate durable channel and terminal-delivery carriers are produced by
 * actual provider rejections, never by fabricated application failure rows. */
export async function followUpsNotificationFlow({ fixture, component, createIncident, publish, operatorEmails, tick, t }) {
  const channel = await fixture.post("/api/app/channels", {
    kind: "slack", name: "Synthetic Lamp failed channel", componentIds: [component.id],
    url: "https://hooks.slack.com/services/synthetic-lamp-1/synthetic-lamp-2/synthetic-lamp-3",
  });
  assert.equal(channel.status, 201, channel.text);
  const incident = await createIncident("Synthetic Lamp failed channel publication");
  await publish(incident.id, { channels: ["chat"] });
  const channelRows = await eventuallyFollowUp(async () => (await fixture.api(endpoint)).body.followUps,
    rows => rows.some(row => row.kind === "channel-notification" && row.failure), "the real Slack rejection becomes a channel follow-up");
  const channelEntry = channelRows.find(row => row.kind === "channel-notification" && row.failure);
  assert.equal(channelEntry.failure.state, "failed");
  assert.ok(fixture.channelRequests.length > 0);
  assert.ok(Number.isFinite(Date.parse(channelEntry.dueAt)));
  assert.ok(channelEntry.stopCondition.trim());
  assert.equal(channelEntry.link, "/app/subscribers?view=log");
  const removed = await fixture.api(`/api/app/channels/${channel.body.channel.id}`, { method: "DELETE" });
  assert.equal(removed.status, 200, removed.text);
  assert.ok(!(await fixture.api(endpoint)).body.followUps.some(row => row.id === channelEntry.id), "removing the failed channel resolves its obligation");

  const email = "synthetic-lamp-rejected@example.test";
  const subscribed = await fixture.runtime.dispatchFetch(pageOrigin + "/subscribe", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: pageOrigin },
    body: new URLSearchParams({ email, componentId: component.id }).toString(),
  });
  assert.equal(subscribed.status, 202, await subscribed.clone().text());
  const invitation = fixture.messages.find(message => message.to.includes(email));
  assert.ok(invitation);
  const confirmation = invitation.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
  assert.equal((await fixture.runtime.dispatchFetch(confirmation)).status, 200);
  const deliveryIncident = await createIncident("Synthetic Lamp terminal provider rejection");
  const update = await publish(deliveryIncident.id, { channels: ["email"] });
  const deliveryRows = await eventuallyFollowUp(async () => (await fixture.api(endpoint)).body.followUps,
    rows => rows.some(row => row.kind === "notification-delivery"), "the real permanent mail rejection becomes a terminal follow-up");
  const delivery = deliveryRows.find(row => row.kind === "notification-delivery");
  assert.equal(delivery.failure.state, "failed");
  const delivered = await fixture.api(`/api/app/deliveries?channel=email&incidentUpdateId=${update.id}`);
  assert.equal(delivered.status, 200, delivered.text);
  const terminal = delivered.body.deliveries.find(row => row.destination === email);
  assert.equal(terminal?.outcome, "failed", "the subscriber notification actually reached terminal failure");
  await tick();
  await settleOperatorEmails(fixture);
  assertOneOperatorEmail(fixture, operatorEmails, /could not deliver a subscriber notification/i, terminal.id);
  // Redeliver the real publication command after its terminal failure, then
  // repeat Cron. No SQL mutation creates or retries the application event.
  const worker = await fixture.runtime.getWorker();
  for (let repeat = 0; repeat < 2; repeat++) {
    const queued = await worker.queue("lamp-follow-ups-jobs", [{ id: `synthetic-lamp-redelivery-${repeat}`, timestamp: new Date(), attempts: 2 + repeat, body: { type: "delivery-dispatch", eventId: update.id } }]);
    assert.equal(queued.outcome, "ok");
  }
  await tick();
  await settleOperatorEmails(fixture);
  assertOneOperatorEmail(fixture, operatorEmails, /could not deliver a subscriber notification/i, terminal.id);
  assert.equal((await fixture.api(`/api/app/deliveries?channel=email&incidentUpdateId=${update.id}`)).body.deliveries.find(row => row.id === terminal.id).outcome, "failed");
  t?.diagnostic("PROBE NOTIFY-006 acceptance-4 terminal notification failure: public email subscription and owner publication receive provider HTTP 400, repeated Queue delivery and Cron -> failed subscriber delivery and exactly one captured email per active operator for that delivery");
  assert.ok(Number.isFinite(Date.parse(delivery.dueAt)));
  assert.ok(delivery.stopCondition.trim());
  assert.equal((await fixture.post(`${endpoint}/retry`, { id: delivery.id, occurrence: delivery.occurrence })).status, 409, "terminal deliveries are not unfinished dispatch jobs");
  const dismissed = await fixture.post(`${endpoint}/dismiss`, { id: delivery.id, occurrence: delivery.occurrence, reason: "Synthetic Lamp operator reviewed the permanent mail rejection" });
  assert.equal(dismissed.status, 200, dismissed.text);
  assert.ok(!(await fixture.api(endpoint)).body.followUps.some(row => row.id === delivery.id));
}
