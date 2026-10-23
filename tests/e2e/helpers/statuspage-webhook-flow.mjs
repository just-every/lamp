import assert from "node:assert/strict";
import { openSubscriberManagementFixture, eventuallySubscriber, pageOrigin } from "./subscriber-management-fixture.mjs";
import { receiveStatuspageWebhook, expectStatuspageIncident } from "./statuspage-webhook-receiver.mjs";
import { statuspageWebhookMaintenance } from "./statuspage-webhook-maintenance.mjs";

const LINKED_IMPACT = "See https://help.example.com/kb/123.";
const signingSecret = "synthetic-lamp-webhook-1".repeat(4);

/** The frozen independent receiver runs at the paid network boundary and
 * returns 204 only after field-by-field acceptance of the actual wire bytes. */
export async function statuspageWebhookFlow() {
  const accepted = [], receiverErrors = [];
  const contact = "synthetic-lamp-statuspage-contact@example.test";
  let fixture;
  const webhookReceiver = async record => {
    try {
      const received = receiveStatuspageWebhook(record, signingSecret);
      const statusResponse = await fixture.raw(`${pageOrigin}/api/v2/status.json`);
      assert.equal(statusResponse.status, 200);
      const state = await statusResponse.json();
      const maintenance = received.body.incident?.impact === "maintenance";
      const recordsResponse = await fixture.raw(`${pageOrigin}/api/v2/${maintenance ? "scheduled-maintenances" : "incidents"}.json`);
      assert.equal(recordsResponse.status, 200);
      const records = await recordsResponse.json();
      const incident = records[maintenance ? "scheduled_maintenances" : "incidents"].find(row => row.id === received.body.incident?.id);
      assert.ok(incident, "the receiver's record ID is the same stable public API ID");
      expectStatuspageIncident(received.body, {
        page: { id: state.page.id, status_indicator: state.status.indicator, status_description: state.status.description },
        incident, updates: incident.incident_updates, maintenance, ...(!maintenance ? { literalText: LINKED_IMPACT } : {}),
      });
      assert.ok(!record.rawBody.includes(contact), "no subscriber contact address reaches the webhook receiver");
      assert.ok(!accepted.some(previous => previous.deliveryId === received.deliveryId), "a delivery ID is accepted at most once");
      accepted.push(received);
      return new Response(null, { status: 204 });
    } catch (cause) {
      receiverErrors.push(cause);
      return new Response("Statuspage receiver refused the delivery", { status: 400 });
    }
  };
  fixture = await openSubscriberManagementFixture({ webhookReceiver });
  fixture.recoverWebhook();
  try {
    const { api, post, raw } = fixture;
    const component = await fixture.createComponent("Synthetic Lamp Statuspage API");
    const added = await post("/api/app/subscribers", { channel: "webhook", destination: "https://receiver.example.test/synthetic-lamp-1", contactEmail: contact, componentIds: [component.id], webhookFormat: "statuspage" });
    assert.equal(added.status, 201, added.text);
    assert.equal(added.body.subscriber.webhookFormat, "statuspage");
    assert.equal(added.body.subscriber.state, "pending");
    assert.equal(fixture.messagesFor(contact).length, 1);
    await fixture.confirm(contact);
    const message = fixture.messagesFor(contact)[0];
    const manageUrl = message.text.match(/https?:\/\/\S+\/manage\/\S+/)?.[0];
    assert.ok(manageUrl, "the real confirmation message supplies the subscriber's scoped management link");
    const manage = await raw(manageUrl);
    assert.equal(manage.status, 200);
    const html = await manage.text();
    assert.match(html, /name="webhookFormat"/);
    const changeFormat = (format, url = manageUrl) => raw(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: new URL(url).origin }, body: new URLSearchParams({ componentId: component.id, webhookFormat: format }).toString() });
    assert.equal((await changeFormat("invalid-statuspage-format")).status, 400);
    assert.equal((await changeFormat("lamp")).status, 200);
    assert.equal((await fixture.list()).find(row => row.id === added.body.subscriber.id).webhookFormat, "lamp");
    assert.equal((await changeFormat("statuspage")).status, 200);
    assert.equal((await fixture.list()).find(row => row.id === added.body.subscriber.id).webhookFormat, "statuspage");
    assert.equal((await changeFormat("lamp", manageUrl + "tampered")).status, 404);
    const invalid = await post("/api/app/subscribers/webhook", { destination: "https://receiver.example.test/synthetic-lamp-invalid", contactEmail: contact, componentIds: [component.id], webhookFormat: "invalid" });
    assert.equal(invalid.status, 400, invalid.text);
    const defaultComponent = await fixture.createComponent("Synthetic Lamp default-format API");
    const defaulted = await post("/api/app/subscribers/webhook", { destination: "https://receiver.example.test/synthetic-lamp-default", contactEmail: "synthetic-lamp-default-contact@example.test", componentIds: [defaultComponent.id] });
    assert.equal(defaulted.status, 201, defaulted.text);
    assert.equal(defaulted.body.subscriber.webhookFormat, "lamp", "existing creation callers retain Lamp's format");
    assert.equal((await api(`/api/app/subscribers/${defaulted.body.subscriber.id}`, { method: "DELETE" })).status, 204);

    const created = await post("/api/app/incidents", { title: "Synthetic Lamp compatible incident", components: [{ componentId: component.id, state: "Partially unavailable", relationship: "Primary" }] });
    assert.equal(created.status, 201, created.text);
    const incident = created.body.incident;
    for (const [index, lifecycle] of ["Identified", "Monitoring", "Resolved"].entries()) {
      const saved = await api(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle, affectedAudience: "Synthetic Lamp API customers", customerImpact: LINKED_IMPACT, whatStillWorks: "Dashboard access remains available.", details: lifecycle === "Resolved" ? "Operators verified recovery." : "Operators are investigating.", nextUpdateAt: lifecycle === "Resolved" ? null : new Date(Date.now() + 3_600_000).toISOString() }) });
      assert.equal(saved.status, 200, saved.text);
      const published = await post(`/api/app/incidents/${incident.id}/publish`, { channels: ["webhook"], ...(lifecycle === "Resolved" ? { overrideReason: "Synthetic Lamp operator checked recovery" } : {}) });
      assert.equal(published.status, 200, published.text);
      await eventuallySubscriber(() => {
        if (receiverErrors[0]) throw receiverErrors[0];
        return accepted;
      }, rows => rows.length === index + 1, "the strict Statuspage receiver accepts the published incident update");
      const body = accepted[index].body;
      assert.equal(body.incident.status, lifecycle.toLowerCase());
      assert.equal(body.incident.incident_updates.length, index + 1);
      assert.equal(body.incident.id, accepted[0].body.incident.id, "all updates retain the same public incident ID");
      const deliveries = await api(`/api/app/deliveries?incidentUpdateId=${published.body.update.id}&channel=webhook&limit=100`);
      assert.equal(deliveries.status, 200, deliveries.text);
      await eventuallySubscriber(async () => (await api(`/api/app/deliveries?incidentUpdateId=${published.body.update.id}&channel=webhook&limit=100`)).body.deliveries,
        rows => rows.length === 1 && rows[0].outcome === "delivered", "receiver acceptance is recorded as actual webhook delivery");
    }
    await statuspageWebhookMaintenance({ fixture, component, accepted, receiverErrors });
    const unsubscribe = accepted[0].body.meta.unsubscribe;
    const stopped = await raw(unsubscribe, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: new URL(unsubscribe).origin }, body: "List-Unsubscribe=One-Click" });
    assert.equal(stopped.status, 200, await stopped.clone().text());
    assert.equal((await raw(manageUrl)).status, 404, "unsubscribe revokes the existing management token");
    assert.equal((await changeFormat("lamp")).status, 404);
    assert.equal((await fixture.list()).find(row => row.id === added.body.subscriber.id).state, "deactivated");
    assert.equal(receiverErrors.length, 0);
    // Standalone component changes have no carrier yet. The frozen component
    // validator is deliberately not exercised using a fabricated delivery.
  } finally { await fixture.close(); }
}
