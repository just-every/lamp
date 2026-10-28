import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openSubscriberManagementFixture, eventuallySubscriber } from "./subscriber-management-fixture.mjs";

const receiptKey = Buffer.from("synthetic-lamp-subscriber-receipts");

/** Native HTTP/Queue/Cron doors. Only provider requests cross a recorded edge. */
export async function openIncidentFollowFixture({ receipts = true, ...options } = {}) {
  console.log("SUB-019: opening native Worker fixture");
  const fixture = await openSubscriberManagementFixture({ ...options, extraBindings: { ...options.extraBindings, ...(!receipts ? { RESEND_WEBHOOK_SECRET: "" } : {}) } });
  console.log("SUB-019: native Worker signed in");
  fixture.recoverWebhook();
  const { api, post, raw, db } = fixture;
  const origin = fixture.publicOrigin;
  const setIncludeReport = async includeReport => {
    const response = await api("/api/app/incident-follow-settings", { method: "PATCH", body: JSON.stringify({ includeReport }) });
    assert.equal(response.status, 200, response.text);
  };
  const tick = async (scheduledTime = Date.now()) => {
    const result = await (await fixture.runtime.getWorker()).scheduled({ cron: "* * * * *", scheduledTime });
    assert.equal(result.outcome, "ok", "the native scheduled trigger completes");
  };
  let requestNumber = 0;
  const subscribe = async (incidentId, input, headers = {}) => {
    const response = await raw(`${origin}/subscribe/incident`, {
      method: "POST",
      headers: { Origin: origin, Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded",
        "CF-Connecting-IP": `192.0.2.${++requestNumber}`, ...headers },
      body: new URLSearchParams({ incidentId, channel: "email", ...input }).toString(),
    });
    return { status: response.status, text: await response.text(), headers: response.headers };
  };
  const create = async (component, title) => {
    const response = await post("/api/app/incidents", { title, components: [{ componentId: component.id, state: "Partially unavailable", relationship: "Primary" }] });
    assert.equal(response.status, 201, response.text);
    console.log(`SUB-019: created ${response.body.incident.reference}`);
    return response.body.incident;
  };
  const deliveries = async updateId => {
    const result = await api(`/api/app/deliveries?incidentUpdateId=${updateId}&limit=100`);
    assert.equal(result.status, 200, result.text);
    return result.body.deliveries;
  };
  const receive = async (rows, description) => {
    for (const delivery of rows.filter(row => row.channel === "email" && row.outcome !== "delivered")) {
      const receipt = fixture.mailReceipts.find(row => row.idempotencyKey === `notification/${delivery.id}`);
      assert.ok(receipt, `${description}: provider accepted the exact committed delivery`);
      const id = `synthetic-lamp-follow-receipt-${delivery.id}`;
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: "email.delivered", data: { email_id: receipt.id } });
      const signature = createHmac("sha256", receiptKey).update(`${id}.${timestamp}.${body}`).digest("base64url");
      const response = await raw(`${origin}/api/intake/mail-events`, { method: "POST",
        headers: { "Content-Type": "application/json", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` }, body });
      assert.equal(response.status, 200, await response.text());
    }
  };
  const publish = async (incident, impact, lifecycle = "Identified", channels = ["email", "webhook"]) => {
    const saved = await api(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({
      lifecycle, affectedAudience: "Synthetic Lamp incident followers", customerImpact: impact,
      whatStillWorks: "The status page remains available.", details: "The operator reviewed this update.",
      nextUpdateAt: lifecycle === "Resolved" ? null : new Date(Date.now() + 3_600_000).toISOString(),
    }) });
    assert.equal(saved.status, 200, saved.text);
    const published = await post(`/api/app/incidents/${incident.id}/publish`, { channels });
    assert.equal(published.status, 200, published.text);
    await eventuallySubscriber(async () => {
      const response = await raw(`${origin}/incidents/${incident.reference}`);
      assert.equal(response.status, 200);
      return response.text();
    }, html => html.includes(impact), "the exact published update reaches its immutable public permalink");
    const rows = await eventuallySubscriber(() => deliveries(published.body.update.id),
      rows => rows.every(row => row.outcome === "delivered" || row.channel === "email" && row.providerAcceptedAt),
      "the exact publication's provider acceptances finish");
    if (receipts) {
      await receive(rows, incident.reference);
      await eventuallySubscriber(() => deliveries(published.body.update.id), rows => rows.every(row => row.outcome === "delivered"), "signed receipts establish recipient delivery");
    }
    console.log(`SUB-019: published and ${receipts ? "delivered" : "provider-accepted"} ${incident.reference} ${lifecycle}: ${impact}`);
    return published.body.update;
  };
  const scope = async subscriberId => db.prepare("SELECT * FROM incident_subscriptions WHERE subscriber_id=?").bind(subscriberId).first();
  const erased = async (address, message) => {
    for (const [table, json] of await fixture.databaseState()) assert.ok(!json.includes(address), `${message}: ${table} retains no address`);
  };
  const assertProductUnchanged = async before => {
    const after = await fixture.databaseState();
    assert.deepEqual([...after.keys()], [...before.keys()], "a refused request creates no application table");
    for (const [table, rows] of before) {
      // BASE-ACCESS counts attempted public writes. This is the sole allowed
      // bookkeeping change; all subscriptions, tokens, audit and delivery stay.
      if (table === "request_rate_windows") continue;
      assert.equal(after.get(table), rows, `a refused request changed ${table}`);
    }
  };
  return { ...fixture, origin, subscribe, create, publish, deliveries, receive, scope, erased, tick, setIncludeReport, assertProductUnchanged };
}
