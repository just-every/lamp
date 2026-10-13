import { requestHeaders } from "../helpers/request-headers.mjs";
import { withDraftVersion } from "../e2e/draft-version-helper.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before } from "node:test";

import { contract } from "../contract.mjs";
import { insertRealOperatorSession } from "../e2e/real-session-helper.mjs";
import { startIncidentWorker, stopIncidentWorker } from "./incident-worker.mjs";
import { loadTypescript, migrate, openRuntime } from "./runtime.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";

const testPort = process.env.LAMP_INCIDENT_PORT === undefined ? undefined : Number(process.env.LAMP_INCIDENT_PORT);
const testDirectory = mkdtempSync(join(tmpdir(), "lamp-incident-"));
const statePath = join(testDirectory, "worker-state");
const viteCachePath = join(testDirectory, "vite-cache");
let baseUrl;
let sessionId;
let server;
let deliveryRuntime;
let deliveryDb;
let createDeliveryRepository;
let serverOutput = "";

const { renderIncidentUpdate } = await loadTypescript("src/core/features/incidents/renderer.ts");
const { createDeliveriesService } = await loadTypescript("src/core/features/deliveries/service.ts");
({ createDeliveryRepository } = await loadTypescript("src/core/features/deliveries/repository.ts"));

async function appFetch(path, init = {}) {
  init = await withDraftVersion(path, init, appFetch);
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: requestHeaders({ Connection: "close", Cookie: `${sessionCookieName(baseUrl)}=${sessionId}`, "Content-Type": "application/json" }, init.headers),
  });
}

async function expectStatus(response, status) {
  if (response.status !== status) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return response;
}

function executeFixtureSql(statement) {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", statePath, "--command", statement], { cwd: process.cwd(), stdio: "pipe" });
}

async function eventually(read, predicate, description) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}. Worker output:\n${serverOutput}`);
}

async function createIncident(title, componentId) {
  const response = await appFetch("/api/app/incidents", {
    method: "POST",
    body: JSON.stringify({ title, components: [{ componentId, state: "Major outage", relationship: "Primary" }] }),
  });
  await expectStatus(response, 201);
  return (await response.json()).incident;
}

async function saveDraft(incidentId, input) {
  return expectStatus(await appFetch(`/api/app/incidents/${incidentId}/draft`, { method: "PUT", body: JSON.stringify(input) }), 200);
}

async function publish(incidentId) {
  return appFetch(`/api/app/incidents/${incidentId}/publish`, { method: "POST", body: JSON.stringify({ channels: [] }) });
}

function renderInput(overrides = {}) {
  return {
    incidentReference: "INC-legacy",
    incidentTitle: "Legacy resolution",
    lifecycle: "Resolved",
    affectedAudience: "All customers",
    customerImpact: "Service restored",
    whatStillWorks: "",
    details: "",
    nextUpdateAt: null,
    ...overrides,
  };
}

before(async () => {
  deliveryRuntime = openRuntime(join(testDirectory, "mail-capture"));
  deliveryDb = await deliveryRuntime.getD1Database("DB");
  await migrate(deliveryDb);
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", statePath], { cwd: process.cwd(), stdio: "pipe" });
  ({ server, baseUrl } = await startIncidentWorker({
    port: testPort, statePath, viteCachePath,
    onOutput: (chunk) => { serverOutput += chunk; },
  }));
  sessionId = await insertRealOperatorSession({ persistTo: statePath });
  executeFixtureSql(`INSERT INTO components (id,group_id,name,description,internal,display_order,note,created_at,updated_at)
    VALUES ('01J00000000000000000000011',NULL,'resolution component','Incident-domain integration fixture',0,1,'','2026-10-06T00:00:00.000Z','2026-10-06T00:00:00.000Z')`);
});

after(async () => {
  await stopIncidentWorker(server);
  if (deliveryRuntime) await deliveryRuntime.dispose();
  rmSync(testDirectory, { recursive: true, force: true });
});

contract("UPDATE-001", "resolved publication accepts no next time while active publication still rejects it without side effects", async () => {
  const invalidTitle = await appFetch("/api/app/incidents", {
    method: "POST",
    body: JSON.stringify({ title: " ", components: [{ componentId: "01J00000000000000000000011", state: "Major outage", relationship: "Primary" }] }),
  });
  assert.equal(invalidTitle.status, 400);
  const missingComponent = await appFetch("/api/app/incidents", {
    method: "POST",
    body: JSON.stringify({ title: "Invalid component should not reserve", components: [{ componentId: "01J00000000000000000000999", state: "Major outage", relationship: "Primary" }] }),
  });
  assert.equal(missingComponent.status, 409);

  const active = await createIncident("Active update still needs a commitment", "01J00000000000000000000011");
  assert.equal(active.reference, "INC-1", "invalid creation inputs must not reserve a reference");
  const activeDraft = {
    lifecycle: "Identified",
    affectedAudience: "Affected customers",
    customerImpact: "Some requests may fail",
    whatStillWorks: "Reads work",
    details: "",
  };
  const savedActive = await (await saveDraft(active.id, activeDraft)).json();
  assert.equal(savedActive.draft.nextUpdateAt, null);
  const activePreview = await appFetch(`/api/app/incidents/${active.id}/draft/preview`, { method: "POST", body: JSON.stringify(activeDraft) });
  await expectStatus(activePreview, 200);
  assert.equal((await activePreview.json()).preview.public.fields.some((field) => field.label === "Next update by" && field.value === "Not yet committed"), true);
  assert.equal((await publish(active.id)).status, 400);
  const unchanged = await (await appFetch(`/api/app/incidents/${active.id}`)).json();
  assert.equal(unchanged.incident.lifecycle, "Investigating");
  assert.equal(unchanged.incident.updates.length, 0);
  assert.equal((await (await appFetch(`/api/app/deliveries?incidentUpdateId=${savedActive.draft.id}`)).json()).deliveries.length, 0);

  const resolved = await createIncident("Resolve without a next commitment", "01J00000000000000000000011");
  assert.equal(resolved.reference, "INC-2");
  const activeNextUpdate = new Date(Date.now() + 60 * 60_000).toISOString();
  await saveDraft(resolved.id, {
    lifecycle: "Identified",
    affectedAudience: "Affected customers",
    customerImpact: "Some requests may fail",
    whatStillWorks: "Reads work",
    details: "Mitigation is underway",
    nextUpdateAt: activeNextUpdate,
  });
  await expectStatus(await publish(resolved.id), 200);
  await eventually(async () => (await (await appFetch("/api/app/components")).json()).components[0]?.publicState, (state) => state === "Major outage", "published incident component claim");

  const resolvedDraft = {
    lifecycle: "Resolved",
    affectedAudience: "Affected customers",
    customerImpact: "Service is restored",
    whatStillWorks: "All services work",
    details: "The issue is resolved",
  };
  const savedResolved = await (await saveDraft(resolved.id, resolvedDraft)).json();
  assert.equal(savedResolved.draft.nextUpdateAt, null);
  const previewResponse = await appFetch(`/api/app/incidents/${resolved.id}/draft/preview`, { method: "POST", body: JSON.stringify(resolvedDraft) });
  await expectStatus(previewResponse, 200);
  const preview = (await previewResponse.json()).preview;
  assert.equal(preview.public.fields.some((field) => field.label === "Next update by"), false);
  assert.doesNotMatch(preview.email.plainText, /Next update by|Not yet committed/);

  const published = await publish(resolved.id);
  await expectStatus(published, 200);
  const resolvedUpdate = (await published.json()).update;
  assert.equal(resolvedUpdate.lifecycle, "Resolved");
  assert.equal(resolvedUpdate.nextUpdateAt, null);
  const view = (await (await appFetch(`/api/app/incidents/${resolved.id}`)).json()).incident;
  assert.equal(view.lifecycle, "Resolved");
  assert.equal(typeof view.resolvedAt, "string");
  assert.equal(view.updates.find((update) => update.lifecycle === "Resolved").nextUpdateAt, null);
  assert.equal(view.updates.find((update) => update.lifecycle === "Identified").nextUpdateAt, activeNextUpdate, "published active history remains immutable");
  await eventually(async () => (await (await appFetch("/api/app/components")).json()).components[0]?.publicState, (state) => state === "Operational", "resolved incident component claim release");

  const parallel = await Promise.all([
    createIncident("Concurrent reference A", "01J00000000000000000000011"),
    createIncident("Concurrent reference B", "01J00000000000000000000011"),
  ]);
  assert.deepEqual(parallel.map((incident) => incident.reference).sort(), ["INC-3", "INC-4"]);
});

contract("UPDATE-001", "the shared renderer suppresses null and legacy resolved promises but keeps active history", () => {
  for (const nextUpdateAt of [null, "2026-10-06T16:00:00.000Z"]) {
    const rendered = renderIncidentUpdate(renderInput({ nextUpdateAt, nextUpdateDisplay: "Tuesday, 16:00 UTC+00:00" }));
    assert.equal(rendered.public.fields.some((field) => field.label === "Next update by"), false);
    assert.doesNotMatch(rendered.email.plainText, /Next update by|Tuesday, 16:00/);
  }
  const active = renderIncidentUpdate(renderInput({ lifecycle: "Identified", nextUpdateAt: "2026-10-06T16:00:00.000Z", nextUpdateDisplay: "Tuesday, 16:00 UTC+00:00" }));
  assert.equal(active.public.fields.some((field) => field.label === "Next update by" && field.value === "Tuesday, 16:00 UTC+00:00"), true);
  assert.match(active.email.plainText, /Next update by: Tuesday, 16:00 UTC\+00:00/);
});

contract("UPDATE-002", "a resolved notification is captured without a provider receipt or duplicate retry", async () => {
  const sent = [];
  const now = "2026-10-06T00:00:00.000Z";
  const ids = {
    operator: "01J00000000000000000000101",
    incident: "01J00000000000000000000102",
    update: "01J00000000000000000000103",
    subscriber: "01J00000000000000000000104",
    delivery: "01J00000000000000000000105",
  };
  await deliveryDb.batch([
    deliveryDb.prepare("INSERT INTO operators (id,email,display_name,is_setup_operator,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(ids.operator, "capture-operator@example.test", "Capture Operator", 1, now, now),
    deliveryDb.prepare("INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,deleted_at,deletion_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(ids.incident, "INC-42", "Resolved notification", "Resolved", now, now, ids.operator, null, null, now, now),
    deliveryDb.prepare("INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(ids.update, ids.incident, "Resolved", "Affected customers", "Service restored", "All services work", "The issue is resolved", null, now, ids.operator, now, now),
    deliveryDb.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(ids.subscriber, "email", "customer@example.test", null, "active", "all", "capture-subscriber-token", now, now),
    deliveryDb.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(ids.delivery, ids.subscriber, ids.update, "email", "queued", now, now, now, ids.update, "incident-update"),
  ]);
  const mail = {
    configured: true,
    async send(message) { sent.push(message); return { disposition: "captured", captureId: "capture-receipt-42" }; },
  };
  const service = createDeliveriesService(createDeliveryRepository(deliveryDb), {
    mail,
    fromAddress: "status@example.test",
    subscriberTokenSecret: "local-test-subscriber-token-secret",
  });

  await service.dispatchDelivery(ids.delivery, "https://status.example.test");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].idempotencyKey, `notification/${ids.delivery}`);
  assert.match(sent[0].text, /Status: Resolved/);
  assert.doesNotMatch(sent[0].text, /Next update by|Not yet committed/);
  const attempt = await deliveryDb.prepare("SELECT provider_message_id AS providerMessageId, local_capture_id AS localCaptureId, error FROM notification_delivery_attempts WHERE delivery_id = ?").bind(ids.delivery).first();
  assert.deepEqual(attempt, { providerMessageId: null, localCaptureId: "capture-receipt-42", error: null });
  assert.equal((await deliveryDb.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind(ids.delivery).first()).outcome, "queued", "a local capture is not provider acceptance or confirmed delivery");
  const frozen = await deliveryDb.prepare("SELECT mail_payload_json AS payload FROM notification_deliveries WHERE id = ?").bind(ids.delivery).first();
  assert.equal(JSON.parse(frozen.payload).text, sent[0].text);

  await service.dispatchDelivery(ids.delivery, "https://status.example.test");
  assert.equal(sent.length, 1, "a captured delivery cannot be retried into a duplicate local envelope");
  assert.equal(await deliveryDb.prepare("SELECT COUNT(*) AS count FROM notification_delivery_attempts WHERE delivery_id = ?").bind(ids.delivery).first().then((row) => row.count), 1);
});
