import assert from "node:assert/strict";
import { openSubscriberManagementFixture, eventuallySubscriber, pageOrigin } from "./subscriber-management-fixture.mjs";

/** SUB-016: preferences are chosen and changed through public doors; actual
 * publication and maintenance notices cross only the recorded provider edge. */
export async function subscriberPreferencesFlow() {
  const fixture = await openSubscriberManagementFixture();
  fixture.recoverWebhook();
  const thresholdEmail = "synthetic-lamp-threshold@example.test";
  const maintenanceEmail = "synthetic-lamp-maintenance@example.test";
  try {
    const { api, post, raw } = fixture;
    const component = await fixture.createComponent("Synthetic Lamp preference API");
    const subscribe = async (email, eventKinds, minimumImpact) => {
      const form = new URLSearchParams({ email, componentId: component.id, preferencesPresent: "1" });
      for (const eventKind of eventKinds) form.append("eventKind", eventKind);
      if (minimumImpact) form.set("minimumImpact", minimumImpact);
      const response = await raw(`${pageOrigin}/subscribe`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: pageOrigin, Accept: "text/html" }, body: form.toString() });
      assert.equal(response.status, 202, await response.text());
    };
    await subscribe(thresholdEmail, ["incidents"], "Partially unavailable");
    await fixture.confirm(thresholdEmail);
    await subscribe(maintenanceEmail, ["incidents", "maintenance"]);
    await fixture.confirm(maintenanceEmail);
    // An established reader receives the same public answer plus their own
    // management link. Editing it needs no operator cookie or session.
    await subscribe(maintenanceEmail, ["incidents", "maintenance"]);
    const managedMail = fixture.messagesFor(maintenanceEmail).find(message => /\/manage\//.test(message.text));
    assert.ok(managedMail, "the real mail adapter carries a subscriber management link");
    const manageUrl = managedMail.text.match(/https?:\/\/\S+\/manage\/\S+/)[0];
    const managed = await raw(manageUrl);
    assert.equal(managed.status, 200);
    assert.match(await managed.text(), /name="eventKind"/);
    const changed = await raw(manageUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: pageOrigin }, body: new URLSearchParams({ componentId: component.id, preferencesPresent: "1", eventKind: "maintenance" }).toString() });
    assert.equal(changed.status, 200, await changed.text());
    const webhook = await post("/api/app/subscribers/webhook", { destination: "https://receiver.example.test/synthetic-lamp-1", contactEmail: "synthetic-lamp-preferences-contact@example.test", componentIds: [component.id], eventKinds: ["maintenance"] });
    assert.equal(webhook.status, 201, webhook.text);
    const subscribers = await fixture.list();
    const threshold = subscribers.find(row => row.destination === thresholdEmail);
    const maintenance = subscribers.find(row => row.destination === maintenanceEmail);
    assert.ok(threshold && maintenance);
    const wantedIds = [threshold.id, maintenance.id, webhook.body.subscriber.id];
    const deliveriesFor = async updateId => {
      const response = await api(`/api/app/deliveries?incidentUpdateId=${updateId}&limit=100`);
      assert.equal(response.status, 200, response.text);
      return response.body.deliveries.filter(row => wantedIds.includes(row.subscriberId));
    };
    const created = await post("/api/app/incidents", { title: "Synthetic Lamp preference incident", components: [{ componentId: component.id, state: "Degraded performance", relationship: "Primary" }] });
    assert.equal(created.status, 201, created.text);
    const incident = created.body.incident;
    const publish = async (customerImpact, state) => {
      const saved = await api(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle: "Identified", affectedAudience: "Synthetic Lamp API readers", customerImpact, whatStillWorks: "Dashboard access remains available.", details: "Operators are investigating.", nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString(), ...(state ? { componentChanges: [{ componentId: component.id, state, relationship: "Primary" }] } : {}) }) });
      assert.equal(saved.status, 200, saved.text);
      const published = await post(`/api/app/incidents/${incident.id}/publish`, { channels: ["email", "webhook"] });
      assert.equal(published.status, 200, published.text);
      // The immutable public generation is a readiness signal for this exact
      // update; no sleep is used as evidence of notification suppression.
      await eventuallySubscriber(async () => {
        const response = await raw(`${pageOrigin}/incidents/${incident.reference}`);
        assert.equal(response.status, 200);
        return response.text();
      }, html => html.includes(customerImpact), "the exact published update reaches its public permalink");
      return published.body.update;
    };
    const mailBeforeIncident = fixture.messages.length;
    const hooksBeforeIncident = fixture.webhookRequests.length;
    const degraded = await publish("Synthetic Lamp preference degradation.");
    assert.deepEqual(await deliveriesFor(degraded.id), [], "threshold and maintenance-only subscribers receive no Degraded incident update");
    assert.equal(fixture.messages.length, mailBeforeIncident, "no incident mail crosses the recorded provider edge");
    assert.equal(fixture.webhookRequests.length, hooksBeforeIncident, "maintenance-only webhook receives no incident");
    const escalated = await publish("Synthetic Lamp preference partial outage.", "Partially unavailable");
    const delivered = await eventuallySubscriber(() => deliveriesFor(escalated.id), rows => rows.length === 1 && Boolean(rows[0].providerAcceptedAt), "the threshold subscriber receives the escalated incident through the real mail adapter");
    assert.equal(delivered[0].subscriberId, threshold.id);
    assert.ok(fixture.messagesFor(thresholdEmail).some(message => message.text.includes("Synthetic Lamp preference partial outage.")));
    assert.ok(!fixture.messagesFor(maintenanceEmail).some(message => message.text.includes("Synthetic Lamp preference partial outage.")));
    assert.equal(fixture.webhookRequests.length, hooksBeforeIncident);

    const startsAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const window = await post("/api/app/maintenance", { title: "Synthetic Lamp preference maintenance", startsAt, endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(), componentIds: [component.id], autoStart: false, autoComplete: false });
    assert.equal(window.status, 201, window.text);
    const drainMaintenance = async () => {
      const followUps = await api("/api/app/overview/follow-ups");
      assert.equal(followUps.status, 200, followUps.text);
      const dispatch = followUps.body.followUps.filter(row => row.kind === "notification-dispatch");
      for (const row of dispatch) {
        const retry = await post("/api/app/overview/follow-ups/retry", { id: row.id, occurrence: row.occurrence });
        assert.equal(retry.status, 202, retry.text);
      }
      await eventuallySubscriber(async () => (await api("/api/app/overview/follow-ups")).body.followUps,
        rows => !rows.some(row => dispatch.some(item => item.id === row.id)), "maintenance notices finish through the ordinary Queue retry door");
    };
    await drainMaintenance();
    const mailsBeforeStart = fixture.messagesFor(maintenanceEmail).length;
    const thresholdBeforeStart = fixture.messagesFor(thresholdEmail).length;
    const hooksBeforeStart = fixture.webhookRequests.length;
    const started = await post(`/api/app/maintenance/${window.body.maintenance.id}/start`);
    assert.equal(started.status, 200, started.text);
    await drainMaintenance();
    assert.equal(fixture.messagesFor(maintenanceEmail).length, mailsBeforeStart + 1, "maintenance-only email receives the start notice once");
    assert.equal(fixture.messagesFor(thresholdEmail).length, thresholdBeforeStart, "incident-only email receives no maintenance notice");
    assert.equal(fixture.webhookRequests.length, hooksBeforeStart + 1, "maintenance-only webhook receives the start notice once");
    assert.equal(fixture.webhookRequests.at(-1).body.event, "maintenance.notice.published");
    assert.equal(fixture.webhookRequests.at(-1).body.maintenance.notice, "started");
  } finally { await fixture.close(); }
}
