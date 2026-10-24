import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { eventuallySubscriber, pageOrigin } from "./subscriber-management-fixture.mjs";

/** Extend the existing real Statuspage receiver journey, never fabricate bodies. */
export async function componentNotificationFlow({ fixture, component, subscriber, manageUrl, accepted, lampAccepted, receiverErrors }) {
  const { api, post, raw } = fixture;
  const choose = async kinds => {
    const body = new URLSearchParams({ componentId: component.id, webhookFormat: "statuspage", preferencesPresent: "1" });
    for (const kind of kinds) body.append("eventKind", kind);
    const response = await raw(manageUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: new URL(manageUrl).origin }, body: body.toString() });
    assert.equal(response.status, 200, await response.text());
  };
  await choose(["components"]);
  assert.deepEqual((await fixture.list()).find(row => row.id === subscriber.id).preferences.eventKinds, ["components"], "the token-authorized management door saves component-only selection");
  const lampContact = "synthetic-lamp-components-contact@example.test";
  const lampAdded = await post("/api/app/subscribers", { channel: "webhook", destination: "https://receiver.example.test/synthetic-lamp-components", contactEmail: lampContact, componentIds: [component.id] });
  assert.equal(lampAdded.status, 201, lampAdded.text);
  await fixture.confirm(lampContact);
  assert.ok((await fixture.list()).find(row => row.id === lampAdded.body.subscriber.id).preferences.eventKinds.includes("components"), "webhook subscriptions select component changes by default");
  const lampManageUrl = fixture.messagesFor(lampContact)[0].text.match(/https?:\/\/\S+\/manage\/\S+/)?.[0];
  assert.ok(lampManageUrl);
  const componentBodies = () => accepted.filter(record => record.body.component_update);
  const lampComponentBodies = () => lampAccepted.filter(record => record.body.event === "component.changed");
  const flush = async (expected, expectedLamp) => {
    const response = await api("/api/app/overview/follow-ups");
    assert.equal(response.status, 200, response.text);
    for (const row of response.body.followUps.filter(row => row.kind === "notification-dispatch")) {
      const retry = await post("/api/app/overview/follow-ups/retry", { id: row.id, occurrence: row.occurrence });
      assert.equal(retry.status, 202, retry.text);
    }
    await eventuallySubscriber(() => {
      if (receiverErrors[0]) throw receiverErrors[0];
      return componentBodies();
    }, rows => rows.length === expected, "one strict receiver component_update is accepted for each committed public state change");
    await eventuallySubscriber(async () => (await api("/api/app/overview/follow-ups")).body.followUps,
      rows => !rows.some(row => row.kind === "notification-dispatch"), "all component deliveries finish through the real queue consumer");
    assert.equal(lampComponentBodies().length, expectedLamp, "Lamp format sends one component.changed per selected change and suppresses a duplicate incident carrier");
  };
  const count = accepted.length;
  const email = "synthetic-lamp-no-component-email@example.test";
  const emailAdded = await post("/api/app/subscribers", { channel: "email", email, componentIds: [component.id] });
  assert.equal(emailAdded.status, 201, emailAdded.text);
  await fixture.confirm(email);
  const beforeEmail = fixture.messagesFor(email).length;
  const claim = state => api(`/api/app/components/${component.id}/standing-claim`, { method: "PUT", body: JSON.stringify({ state }) });
  assert.equal((await claim("Degraded performance")).status, 200);
  await flush(1, 1);
  assert.equal(accepted.length, count + 1);
  assert.equal(fixture.messagesFor(email).length, beforeEmail, "an email subscriber without component changes selected receives nothing");
  const first = componentBodies()[0].body;
  assert.equal(first.component_update.old_status, "operational");
  assert.equal(first.component_update.new_status, "degraded_performance");
  assert.equal(first.component_update.claimant_kind, "standing-claim");
  const history = await api(`/api/app/components/${component.id}/history`);
  assert.equal(history.status, 200, history.text);
  const committed = history.body.history.find(row => row.newState === "Degraded performance" && row.causeType === "standing-claim");
  assert.ok(committed);
  assert.equal(first.component_update.created_at, committed.changedAt);
  assert.equal(JSON.stringify(first).includes("operatorId"), false, "component notifications carry no operator identity");
  assert.equal((await claim("Degraded performance")).status, 200);
  await flush(1, 1);
  assert.equal(fixture.messagesFor(email).length, beforeEmail);
  assert.equal((await api(`/api/app/subscribers/${emailAdded.body.subscriber.id}`, { method: "DELETE" })).status, 204);

  const internal = await fixture.createComponent("Synthetic Lamp internal no notification", true);
  assert.equal((await api(`/api/app/components/${internal.id}/standing-claim`, { method: "PUT", body: JSON.stringify({ state: "Major outage" }) })).status, 200);
  const correction = await post(`/api/app/components/${component.id}/history-corrections`, { state: "Operational", startsAt: new Date(Date.now() - 120_000).toISOString(), endsAt: new Date(Date.now() - 60_000).toISOString(), reason: "Synthetic historical correction" });
  assert.equal(correction.status, 204, correction.text);
  await flush(1, 1);
  const componentEmail = "synthetic-lamp-opted-component@example.test";
  const optedEmail = await post("/api/app/subscribers", { channel: "email", email: componentEmail, componentIds: [component.id], eventKinds: ["components"] });
  assert.equal(optedEmail.status,201,optedEmail.text);
  await fixture.confirm(componentEmail);
  const emailBeforeChange=fixture.messagesFor(componentEmail).length;
  assert.equal((await claim(null)).status, 200);
  await flush(2, 2);
  const emailDeliveries=async()=>{
    const response=await api("/api/app/deliveries?limit=100");assert.equal(response.status,200,response.text);
    return response.body.deliveries.filter(row=>row.subscriberId===optedEmail.body.subscriber.id);
  };
  const [emailDelivery]=await eventuallySubscriber(emailDeliveries,rows=>rows.length===1 && Boolean(rows[0].providerAcceptedAt),"an explicitly selected component email crosses the real mail adapter once");
  assert.equal(fixture.messagesFor(componentEmail).length,emailBeforeChange+1);
  assert.ok(fixture.messagesFor(componentEmail).at(-1).text.includes(component.name));
  const receipt=fixture.mailReceipts.find(row=>row.idempotencyKey===`notification/${emailDelivery.id}`);assert.ok(receipt);
  const receiptId=`synthetic-lamp-component-receipt-${emailDelivery.id}`,timestamp=String(Math.floor(Date.now()/1000));
  const receiptBody=JSON.stringify({type:"email.delivered",data:{email_id:receipt.id}});
  const signature=createHmac("sha256",Buffer.from("synthetic-lamp-subscriber-receipts")).update(`${receiptId}.${timestamp}.${receiptBody}`).digest("base64url");
  for(let replay=0;replay<2;replay++){
    const response=await raw(`${pageOrigin}/api/intake/mail-events`,{method:"POST",headers:{"Content-Type":"application/json","svix-id":receiptId,"svix-timestamp":timestamp,"svix-signature":`v1,${signature}`},body:receiptBody});
    assert.equal(response.status,200,"a signed component receipt and its replay retain the same delivery authority");
  }
  await eventuallySubscriber(emailDeliveries,rows=>rows.length===1 && rows[0].outcome==="delivered","the signed receipt reaches the component delivery's retained outcome");
  assert.equal((await fixture.db.prepare("SELECT COUNT(*) n FROM component_delivery_attempts WHERE delivery_id=?").bind(emailDelivery.id).first()).n,1,"receipt replay does not resend component mail");
  assert.deepEqual(await fixture.db.prepare("SELECT delivery_id,component_delivery_id FROM mail_provider_webhook_events WHERE provider_event_id=?").bind(receiptId).first(),{delivery_id:null,component_delivery_id:emailDelivery.id});
  assert.equal((await api(`/api/app/subscribers/${optedEmail.body.subscriber.id}`,{method:"DELETE"})).status,204);
  const erasedComponent=await fixture.db.prepare("SELECT outcome,mail_payload_json FROM component_notification_deliveries WHERE id=?").bind(emailDelivery.id).first();
  assert.equal(erasedComponent.outcome,"delivered");assert.ok(!erasedComponent.mail_payload_json.includes(componentEmail),"erasure scrubs the component partition's frozen recipient while retaining its outcome");

  // Only component events were selected. An incident first publish and its
  // resolution each emit one old-to-new body without an incident carrier.
  const created = await post("/api/app/incidents", { title: "Synthetic Lamp component-only incident", components: [{ componentId: component.id, state: "Partially unavailable", relationship: "Primary" }] });
  assert.equal(created.status, 201, created.text);
  let incident = created.body.incident;
  const publish = async lifecycle => {
    const draft = await api(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle, affectedAudience: "Synthetic customers", customerImpact: "See https://help.example.com/kb/123.", whatStillWorks: "", details: "Synthetic operator update", nextUpdateAt: lifecycle === "Resolved" ? null : new Date(Date.now() + 3_600_000).toISOString() }) });
    assert.equal(draft.status, 200, draft.text);
    const response = await post(`/api/app/incidents/${incident.id}/publish`, { channels: ["webhook"], ...(lifecycle === "Resolved" ? { overrideReason: "Synthetic operator verified recovery" } : {}) });
    assert.equal(response.status, 200, response.text);
    await eventuallySubscriber(async () => {
      if (receiverErrors[0]) throw receiverErrors[0];
      const deliveries = await api(`/api/app/deliveries?incidentUpdateId=${response.body.update.id}&limit=100`);
      assert.equal(deliveries.status, 200, deliveries.text);
      return deliveries.body.deliveries;
    }, rows => rows.every(row => row.outcome === "delivered"), "the incident's own after-publication dispatcher finishes before component dispatch is requested");
    return response.body.update;
  };
  await publish("Identified"); await flush(3, 2);
  await publish("Monitoring"); await flush(3, 2);
  await publish("Resolved"); await flush(4, 2);
  assert.equal(componentBodies()[2].body.component_update.old_status, "operational");
  assert.equal(componentBodies()[2].body.component_update.new_status, "partial_outage");
  assert.equal(componentBodies()[2].body.component_update.claimant_kind, "incident");
  assert.equal(componentBodies()[3].body.component_update.old_status, "partial_outage");
  assert.equal(componentBodies()[3].body.component_update.new_status, "operational");

  assert.equal(lampAccepted.filter(record => record.body.event === "incident.update.published").length, 3, "a Lamp subscriber selecting incidents receives the update without a duplicate component event");
  assert.deepEqual(lampComponentBodies()[0].body.component, { id: component.id, name: component.name, previousState: "Operational", state: "Degraded performance", changedAt: committed.changedAt, claimantKind: "standing-claim" });
  const lampPreferences = new URLSearchParams({ componentId: component.id, webhookFormat: "lamp", preferencesPresent: "1", eventKind: "components" });
  assert.equal((await raw(lampManageUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: new URL(lampManageUrl).origin }, body: lampPreferences.toString() })).status, 200);
  await choose(["incidents", "maintenance", "components"]);
  const maintenance = await post("/api/app/maintenance", { affectedAudience: "Customers using the scheduled service.", customerImpact: "Requests may be interrupted during this maintenance window.", title: "Synthetic Lamp component claimant", startsAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: new Date(Date.now() + 7_200_000).toISOString(), componentIds: [component.id], autoStart: false, autoComplete: false });
  assert.equal(maintenance.status, 201, maintenance.text);
  await flush(4, 2);
  assert.equal((await post(`/api/app/maintenance/${maintenance.body.maintenance.id}/start`)).status, 200);
  await flush(5, 3);
  assert.equal(componentBodies()[4].body.component_update.new_status, "under_maintenance");
  assert.equal(componentBodies()[4].body.component_update.claimant_kind, "maintenance");
  assert.equal((await post(`/api/app/maintenance/${maintenance.body.maintenance.id}/complete`)).status, 200);
  await flush(6, 4);
  assert.equal(componentBodies()[5].body.component_update.old_status, "under_maintenance");
  assert.equal(componentBodies()[5].body.component_update.new_status, "operational");
  // A Statuspage subscription explicitly keeping component events gets one
  // component_update beside the incident; a component-only Lamp subscription
  // gets exactly that change and none of the incident updates.
  const second = await post("/api/app/incidents", { title: "Synthetic Lamp opted-in component incident", components: [{ componentId: component.id, state: "Partially unavailable", relationship: "Primary" }] });
  assert.equal(second.status, 201, second.text);
  incident = second.body.incident;
  const beforeIncidentCarriers = accepted.filter(record => record.body.incident).length;
  await publish("Identified"); await flush(7, 5);
  await publish("Monitoring"); await flush(7, 5);
  await publish("Resolved"); await flush(8, 6);
  assert.equal(accepted.filter(record => record.body.incident).length, beforeIncidentCarriers + 3);
  assert.equal(lampAccepted.filter(record => record.body.event === "incident.update.published").length, 3, "component-only selection does not receive incident updates");
  const anchor = await fixture.createComponent("Synthetic Lamp attachment anchor");
  const attaching = await post("/api/app/incidents", { title: "Synthetic Lamp live attachment claimant", components: [{ componentId: anchor.id, state: "Major outage", relationship: "Primary" }] });
  assert.equal(attaching.status, 201, attaching.text);
  incident = attaching.body.incident;
  await publish("Identified"); await flush(8, 6);
  const attached = await post(`/api/app/incidents/${incident.id}/components`, { componentId: component.id, state: "Major outage", relationship: "Primary" });
  assert.equal(attached.status, 201, attached.text);
  await flush(9, 7);
  assert.equal(componentBodies().at(-1).body.component_update.old_status, "operational");
  assert.equal(componentBodies().at(-1).body.component_update.new_status, "major_outage");
  const detached = await api(`/api/app/incidents/${incident.id}/components/${component.id}`, { method: "DELETE" });
  assert.equal(detached.status, 200, detached.text);
  await flush(10, 8);
  assert.equal(componentBodies().at(-1).body.component_update.old_status, "major_outage");
  assert.equal(componentBodies().at(-1).body.component_update.new_status, "operational");
  assert.equal((await fixture.list()).find(row => row.id === subscriber.id).state, "active");
}
