import assert from "node:assert/strict";
import { eventuallyFollowUp, pageOrigin } from "./follow-ups-runtime.mjs";

const endpoint = "/api/app/overview/follow-ups";

/** Separate durable channel and terminal-delivery carriers are produced by
 * actual provider rejections, never by fabricated application failure rows. */
export async function followUpsNotificationFlow({ fixture, component, createIncident, publish }) {
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
  assert.equal(channelEntry.link, "/app/deliveries");
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
  await publish(deliveryIncident.id, { channels: ["email"] });
  const deliveryRows = await eventuallyFollowUp(async () => (await fixture.api(endpoint)).body.followUps,
    rows => rows.some(row => row.kind === "notification-delivery"), "the real permanent mail rejection becomes a terminal follow-up");
  const delivery = deliveryRows.find(row => row.kind === "notification-delivery");
  assert.equal(delivery.failure.state, "failed");
  assert.ok(Number.isFinite(Date.parse(delivery.dueAt)));
  assert.ok(delivery.stopCondition.trim());
  assert.equal((await fixture.post(`${endpoint}/retry`, { id: delivery.id, occurrence: delivery.occurrence })).status, 409, "terminal deliveries are not unfinished dispatch jobs");
  const dismissed = await fixture.post(`${endpoint}/dismiss`, { id: delivery.id, occurrence: delivery.occurrence, reason: "Synthetic Lamp operator reviewed the permanent mail rejection" });
  assert.equal(dismissed.status, 200, dismissed.text);
  assert.ok(!(await fixture.api(endpoint)).body.followUps.some(row => row.id === delivery.id));
}
