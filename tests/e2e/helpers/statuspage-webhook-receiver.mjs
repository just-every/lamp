import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";

// Independent SUB-018 receiver contract. Frozen before delivery implementation:
// field lists come from CONTRACT.md, never the application's webhook mapper.
const componentStatuses = new Set(["operational", "degraded_performance", "partial_outage", "major_outage", "under_maintenance"]);
const incidentStatuses = new Set(["investigating", "identified", "monitoring", "resolved"]);
const maintenanceStatuses = new Set(["scheduled", "in_progress", "verifying", "completed"]);
const impacts = new Set(["none", "minor", "major", "critical", "maintenance"]);
const object = value => assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "a documented object is required");
const text = value => assert.equal(typeof value, "string");
const id = value => { text(value); assert.match(value, /^[a-z0-9]{12}$/, "public IDs use Statuspage's twelve-character vocabulary"); };
const instant = value => { text(value); assert.ok(Number.isFinite(Date.parse(value)), "a valid timestamp is required"); };
const url = value => { text(value); const parsed = new URL(value); assert.ok(["http:", "https:"].includes(parsed.protocol)); return parsed; };

function component(value) {
  object(value);
  id(value.id);
  text(value.name);
  assert.ok(componentStatuses.has(value.status), "a documented component status is required");
  instant(value.created_at);
}

/** Verify the signature over the untouched wire bytes before parsing JSON. */
export function receiveStatuspageWebhook({ rawBody, headers }, secret) {
  text(rawBody);
  const values = new Headers(headers);
  const deliveryId = values.get("webhook-id"), timestamp = values.get("webhook-timestamp"), signatures = values.get("webhook-signature");
  assert.ok(deliveryId, "the signed delivery ID is required");
  assert.match(timestamp ?? "", /^\d+$/);
  assert.ok(Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300, "the signed delivery is fresh");
  const expected = createHmac("sha256", secret).update(`${deliveryId}.${timestamp}.${rawBody}`).digest();
  assert.ok((signatures ?? "").split(/\s+/).some(signature => {
    if (!signature.startsWith("v1=")) return false;
    const candidate = Buffer.from(signature.slice(3), "base64url");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }), "the SUB-009 HMAC authenticates the exact delivered body");
  const body = JSON.parse(rawBody);
  object(body); object(body.meta); object(body.page);
  assert.match(url(body.meta.unsubscribe).pathname, /^\/unsubscribe\/[^/]+$/, "meta carries this subscription's one-click unsubscribe link");
  url(body.meta.documentation);
  id(body.page.id);
  assert.ok(impacts.has(body.page.status_indicator));
  text(body.page.status_description);
  return { body, deliveryId, timestamp };
}

export function expectStatuspageIncident(body, { page, incident, updates, maintenance = false, literalText }) {
  assert.deepEqual(body.page, { id: page.id, status_indicator: page.status_indicator, status_description: page.status_description });
  object(body.incident);
  const value = body.incident;
  id(value.id); text(value.name);
  assert.ok((maintenance ? maintenanceStatuses : incidentStatuses).has(value.status));
  assert.ok(impacts.has(value.impact));
  url(value.shortlink); instant(value.created_at); instant(value.updated_at);
  assert.ok(value.resolved_at === null || typeof value.resolved_at === "string");
  if (value.resolved_at !== null) instant(value.resolved_at);
  assert.ok(Array.isArray(value.components));
  for (const record of value.components) component(record);
  assert.ok(Array.isArray(value.incident_updates));
  assert.equal(value.incident_updates.length, updates.length, "the receiver gets the complete update array");
  assert.equal(new Set(value.incident_updates.map(update => update.id)).size, updates.length);
  for (const update of value.incident_updates) {
    object(update); id(update.id); text(update.body); instant(update.created_at);
    assert.ok((maintenance ? maintenanceStatuses : incidentStatuses).has(update.status));
    assert.doesNotMatch(update.body, /<\/?(?:a|p|div|span|br|strong|em|ul|ol|li)\b/i, "the webhook carries plain update text without rendered HTML");
  }
  for (const field of ["id", "name", "status", "impact", "shortlink", "created_at", "updated_at", "resolved_at"]) assert.deepEqual(value[field], incident[field], `incident ${field} agrees with the public API`);
  assert.deepEqual(value.components.map(record => ({ id: record.id, name: record.name, status: record.status, created_at: record.created_at })), incident.components.map(record => ({ id: record.id, name: record.name, status: record.status, created_at: record.created_at })));
  assert.deepEqual(value.incident_updates.map(update => ({ id: update.id, body: update.body, status: update.status, created_at: update.created_at })), updates.map(update => ({ id: update.id, body: update.body, status: update.status, created_at: update.created_at })));
  if (literalText) assert.ok(value.incident_updates.some(update => update.body.includes(literalText)), "the original linked update text is unchanged");
  if (maintenance) {
    instant(value.scheduled_for); instant(value.scheduled_until);
    assert.equal(value.scheduled_for, incident.scheduled_for);
    assert.equal(value.scheduled_until, incident.scheduled_until);
  }
}

/** Kept frozen for the real standalone-component carrier; its absence remains
 * a clause gap rather than a fabricated delivery in the incident journey. */
export function expectStatuspageComponentChange(body, expected) {
  object(body.component_update); component(body.component);
  const update = body.component_update;
  id(update.id); id(update.component_id); instant(update.created_at);
  assert.ok(componentStatuses.has(update.old_status));
  assert.ok(componentStatuses.has(update.new_status));
  assert.equal(update.component_id, body.component.id);
  assert.equal(update.old_status, expected.oldStatus);
  assert.equal(update.new_status, expected.newStatus);
  assert.equal(body.component.id, expected.component.id);
  assert.equal(body.component.name, expected.component.name);
  assert.equal(body.component.status, expected.newStatus);
}
