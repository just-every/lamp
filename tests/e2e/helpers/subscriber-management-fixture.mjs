import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openFollowUpsRuntime, eventuallyFollowUp, pageOrigin } from "./follow-ups-runtime.mjs";

export { eventuallyFollowUp as eventuallySubscriber, pageOrigin };

/** RFC-style quoted CSV is parsed independently of the application's reader.
 * Records may contain quotes, commas and physical newlines inside a field. */
export function subscriberCsvRows(text) {
  const rows = []; let row = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if ((character === "\r" || character === "\n") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(value); rows.push(row); row = []; value = "";
    } else value += character;
  }
  assert.equal(quoted, false, "exported CSV has balanced quoted fields");
  if (row.length || value) { row.push(value); rows.push(row); }
  const [header, ...records] = rows;
  assert.ok(header?.length, "exported CSV has a header");
  assert.equal(new Set(header).size, header.length, "column names are unique");
  return records.map(record => {
    assert.equal(record.length, header.length, "each exported record has every declared column");
    return Object.fromEntries(header.map((name, index) => [name, record[index]]));
  });
}

export const subscriberCsv = (headers, rows) => [headers, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n";

/** Reuse the proven real Worker/auth/provider boundary from AUTO-003. Tests may
 * read migrated storage to prove a dry run wrote nothing; all mutations use HTTP. */
export async function openSubscriberManagementFixture({ webhookReceiver } = {}) {
  const receiptKey = Buffer.from("synthetic-lamp-subscriber-receipts");
  const fixture = await openFollowUpsRuntime({ resendWebhookSecret: `whsec_${receiptKey.toString("base64url")}`, webhookReceiver });
  const db = await fixture.runtime.getD1Database("DB");
  const createComponent = async (name, internal = false) => {
    const response = await fixture.post("/api/app/components", { groupId: null, name, description: "", internal, displayOrder: 1, note: "" });
    assert.equal(response.status, 201, response.text);
    return response.body.component;
  };
  const list = async () => {
    const rows = []; let offset = 0;
    for (;;) {
      const response = await fixture.api(`/api/app/subscribers?limit=100&offset=${offset}`);
      assert.equal(response.status, 200, response.text);
      rows.push(...response.body.subscribers);
      if (!response.body.hasMore) return rows;
      offset += response.body.limit;
    }
  };
  const messagesFor = email => fixture.messages.filter(message => message.to.includes(email));
  const confirm = async email => {
    const message = messagesFor(email).find(message => /\/confirm-subscription\//.test(message.text));
    assert.ok(message, "the actual mail serializer emitted a confirmation link");
    const link = message.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
    assert.equal((await fixture.raw(link)).status, 200, "the public confirmation door activates the subscriber");
  };
  const publish = async (component, title) => {
    const created = await fixture.post("/api/app/incidents", { title, components: [{ componentId: component.id, state: "Partially unavailable", relationship: "Primary" }] });
    assert.equal(created.status, 201, created.text);
    const incident = created.body.incident;
    const draft = await fixture.api(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle: "Identified", affectedAudience: "Synthetic Lamp readers", customerImpact: "Requests are delayed.", whatStillWorks: "", details: "Operators are investigating.", nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() }) });
    assert.equal(draft.status, 200, draft.text);
    const published = await fixture.post(`/api/app/incidents/${incident.id}/publish`, { channels: ["email", "webhook"] });
    assert.equal(published.status, 200, published.text);
    // Provider acceptance and recipient delivery are separate facts. The fake
    // Resend edge returns its real accepted ID, then supplies a signed delivery
    // event through the ordinary public webhook before we assert delivery.
    const accepted = await eventuallyFollowUp(async () => {
      const response = await fixture.api(`/api/app/deliveries?incidentUpdateId=${published.body.update.id}&limit=100`);
      assert.equal(response.status, 200, response.text);
      return response.body.deliveries;
    }, rows => rows.every(row => row.outcome === "delivered" || row.channel === "email" && row.providerAcceptedAt), "real provider acceptance is recorded");
    for (const delivery of accepted.filter(row => row.channel === "email")) {
      const receipt = fixture.mailReceipts.find(row => row.idempotencyKey === `notification/${delivery.id}`);
      assert.ok(receipt, "the provider edge recorded the exact delivery's acceptance ID");
      const id = `synthetic-lamp-receipt-${delivery.id}`;
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: "email.delivered", data: { email_id: receipt.id } });
      const signature = createHmac("sha256", receiptKey).update(`${id}.${timestamp}.${body}`).digest("base64url");
      const event = await fixture.raw(`${pageOrigin}/api/intake/mail-events`, { method: "POST", headers: { "Content-Type": "application/json", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` }, body });
      assert.equal(event.status, 200, "the real adapter accepts the provider's signed delivery receipt");
    }
    // Await actual publication dispatch through its public delivery record,
    // including the empty recipient set in the out-of-scope case.
    await eventuallyFollowUp(async () => {
      const response = await fixture.api(`/api/app/deliveries?incidentUpdateId=${published.body.update.id}&limit=100`);
      assert.equal(response.status, 200, response.text);
      return response.body.deliveries;
    }, rows => rows.every(row => row.outcome === "delivered"), "real publication delivery finishes");
    return { incident, update: published.body.update };
  };
  const databaseState = async () => {
    // D1 owns _cf_* tables and refuses reads of their storage. Snapshot every
    // application table, including the audit and intake sidecars, not D1 internals.
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY name").all()).results;
    const result = new Map();
    for (const { name } of tables) {
      const identifier = `"${name.replaceAll('"', '""')}"`;
      const rows = (await db.prepare(`SELECT * FROM ${identifier}`).all()).results;
      result.set(name, JSON.stringify(rows.map(row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))).sort()));
    }
    return result;
  };
  const assertUnchanged = async before => {
    const after = await databaseState();
    assert.deepEqual([...after.keys()], [...before.keys()], "dry run creates no database table");
    for (const [name, value] of before) assert.ok(after.get(name) === value, `dry run changed ${name}`);
  };
  return { ...fixture, createComponent, list, messagesFor, confirm, publish, databaseState, assertUnchanged };
}
