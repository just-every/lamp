// Wrangler setup can outlast idle HTTP connections; use the shared fixture transport.
import { fixtureFetch as fetch } from "../public-snapshots/fixture-fetch.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

import { legacyApiFixtureSql } from "./fixtures/legacy-api-fixture.mjs";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { appOrigin, pageOrigin } from "./helpers/hosts.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";

const port = Number(process.env.LAMP_INTAKE_PORT ?? await reservePort({ label: "intake" }));
const appUrl = appOrigin(port);
const pageUrl = pageOrigin(port);
const sourceConfigPath = resolve("wrangler.jsonc");
const signingSecret = "lamp-intake-reference-test-secret";
const legacyReferenceSql = `
INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,deleted_at,deletion_reason,peak_impact,created_at,updated_at)
VALUES ('01J00000000000000000000070','INC-1','Legacy short reference','Investigating','2026-09-08T00:03:00.000Z',NULL,'01J00000000000000000000001',NULL,NULL,NULL,'2026-09-08T00:03:00.000Z','2026-09-08T00:03:00.000Z');
INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at)
VALUES ('01J00000000000000000000071','01J00000000000000000000070','01J00000000000000000000011','Public API','Partially unavailable','Primary','2026-09-08T00:03:00.000Z','2026-09-08T00:03:00.000Z','2026-09-08T00:03:00.000Z');
INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at)
VALUES ('01J00000000000000000000072','01J00000000000000000000070','Investigating','Customers using the Public API.','Some API requests may fail.','Other services continue to work.','Engineers are investigating.','2026-09-08T01:03:00.000Z','2026-09-08T00:03:00.000Z','01J00000000000000000000001','2026-09-08T00:03:00.000Z','2026-09-08T00:03:00.000Z');`;

let server;
let serverOutput = "";
let sessionId;
let testStatePath;
let testViteCachePath;

async function appFetch(path, init = {}) {
  return fetch(`${appUrl}${path}`, {
    ...init,
    headers: { Origin:process.env.AUTH_ORIGIN, Cookie: `${sessionCookieName(appUrl)}=${sessionId}`, "Content-Type": "application/json", ...init.headers },
  });
}

async function incidentById(id) {
  const response = await appFetch(`/api/app/incidents/${id}`);
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).incident;
}

async function signedAlert(sourceId, body) {
  const timestamp = new Date().toISOString();
  const signature = createHmac("sha256", signingSecret).update(`${timestamp}.${body}`).digest("base64url");
  return fetch(`${pageUrl}/api/intake/${sourceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-lamp-timestamp": timestamp, "x-lamp-signature": signature },
    body,
  });
}

function executeD1(command) {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", sourceConfigPath, "--persist-to", testStatePath, "--command", command], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
}

async function createMaintenance(title, componentId, startOffsetHours = 2) {
  const startsAt = new Date(Date.now() + startOffsetHours * 60 * 60_000).toISOString();
  const endsAt = new Date(Date.now() + (startOffsetHours + 1) * 60 * 60_000).toISOString();
  const response = await appFetch("/api/app/maintenance", {
    method: "POST",
    body: JSON.stringify({ affectedAudience: "Customers using the scheduled service.", customerImpact: "Requests may be interrupted during this maintenance window.", title, startsAt, endsAt, componentIds: [componentId] }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).maintenance;
}

before(async () => {
  testStatePath = await mkdtemp(join(tmpdir(), "lamp-intake-d1-"));
  testViteCachePath = await mkdtemp(join(tmpdir(), "lamp-intake-vite-"));
  execFileSync("pnpm", ["run", "migrate:local"], {
    cwd: process.cwd(),
    stdio: "pipe",
    env: { ...process.env, LAMP_WORKERS_STATE_PATH: testStatePath },
  });
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", sourceConfigPath, "--persist-to", testStatePath, "--command", `${legacyApiFixtureSql()}\n${legacyReferenceSql}`], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
  server = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "pipe",
    env: { ...process.env, LAMP_DISABLE_INSPECTOR: "true", LAMP_WORKERS_STATE_PATH: testStatePath, LAMP_VITE_CACHE_DIR: testViteCachePath },
  });
  server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });
  await waitForWorker({ origin: appUrl, child: server, output: () => `${serverOutput}\nState: ${testStatePath}`, label: "Lamp intake reference Worker" });
  sessionId = await insertRealOperatorSession({ persistTo: testStatePath, configPath: sourceConfigPath });
});

after(async () => {
  if (server && server.exitCode === null) {
    const closed = new Promise((resolveClose) => server.once("close", resolveClose));
    try { process.kill(-server.pid, "SIGTERM"); }
    catch (cause) { if (cause.code !== "ESRCH") throw cause; }
    await closed;
  }
  await Promise.all([testStatePath, testViteCachePath].filter(Boolean).map((path) => rm(path, { recursive: true, force: true })));
});

test("INTAKE-001/003 and MAINT-001 keep short durable references, deduplication, and legacy permalinks on real D1", async () => {
  const legacyShort = await appFetch("/api/app/incidents/01J00000000000000000000070");
  assert.equal(legacyShort.status, 200, await legacyShort.clone().text());
  assert.equal((await legacyShort.json()).incident.reference, "INC-1");
  const legacyPermalink = await fetch(`${pageUrl}/incidents/INC-1`);
  assert.equal(legacyPermalink.status, 200, await legacyPermalink.clone().text());
  assert.match(await legacyPermalink.text(), /Legacy short reference/);
  const legacyTimestampPermalink = await fetch(`${pageUrl}/incidents/INC-4821`);
  assert.equal(legacyTimestampPermalink.status, 200, await legacyTimestampPermalink.clone().text());
  assert.match(await legacyTimestampPermalink.text(), /Elevated API error rates/);

  const legacyRecords = await Promise.all([
    appFetch("/api/app/incidents/01J00000000000000000000020"),
    appFetch("/api/app/maintenance"),
  ]);
  assert.equal((await legacyRecords[0].json()).incident.reference, "INC-4821");
  assert.ok((await legacyRecords[1].json()).maintenance.some((record) => record.reference === "SCH-144"));

  const sourceResponse = await appFetch("/api/app/intake/sources", {
    method: "POST",
    body: JSON.stringify({
      name: "reference monitor",
      credentialKind: "hmac-sha256",
      signingSecret,
      deduplicationPath: "$.event.key",
      titlePath: "$.event.summary",
      statePath: "$.event.state",
      recoveredValue: "recovered",
    }),
  });
  assert.equal(sourceResponse.status, 201, await sourceResponse.clone().text());
  const source = (await sourceResponse.json()).source;

  const bodyA = JSON.stringify({ event: { key: "lamp-dedup-a", summary: "First alert", state: "firing" } });
  const invalidSignature = await fetch(`${pageUrl}${source.endpointPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-lamp-timestamp": new Date().toISOString(), "x-lamp-signature": "invalid" },
    body: bodyA,
  });
  assert.equal(invalidSignature.status, 401);
  const invalidMapping = await signedAlert(source.id, JSON.stringify({ event: { summary: "Missing key", state: "firing" } }));
  assert.equal(invalidMapping.status, 400);

  executeD1(`CREATE TRIGGER lamp_reject_inc2 BEFORE INSERT ON reference_allocations
    WHEN NEW.namespace = 'INC' AND NEW.reference = 'INC-2'
    BEGIN SELECT RAISE(ABORT, 'reference unavailable'); END;`);
  const allocationFailure = await signedAlert(source.id, bodyA);
  assert.equal(allocationFailure.status, 500, await allocationFailure.clone().text());
  executeD1("DROP TRIGGER lamp_reject_inc2;");

  const acceptedA = await signedAlert(source.id, bodyA);
  assert.equal(acceptedA.status, 202, await acceptedA.clone().text());
  const first = await acceptedA.json();
  assert.equal((await incidentById(first.incidentId)).reference, "INC-2");

  const replayA = await signedAlert(source.id, bodyA);
  assert.equal(replayA.status, 202, await replayA.clone().text());
  const replay = await replayA.json();
  assert.equal(replay.replayed, true);
  assert.equal(replay.incidentId, first.incidentId);

  const duplicateKey = await signedAlert(source.id, JSON.stringify({ event: { key: "lamp-dedup-a", summary: "Same unresolved alert", state: "firing", attempt: 2 } }));
  assert.equal(duplicateKey.status, 202, await duplicateKey.clone().text());
  assert.equal((await duplicateKey.json()).incidentId, first.incidentId);

  const acceptedB = await signedAlert(source.id, JSON.stringify({ event: { key: "lamp-dedup-b", summary: "Second alert", state: "firing" } }));
  assert.equal(acceptedB.status, 202, await acceptedB.clone().text());
  const secondAlert = await acceptedB.json();
  const secondReference = (await incidentById(secondAlert.incidentId)).reference;
  assert.equal(secondReference, "INC-3", "replay and open-key dedup must not reserve a reference");

  const concurrentDedup = await Promise.all([
    signedAlert(source.id, JSON.stringify({ event: { key: "lamp-concurrent-dedup", summary: "Concurrent dedup alert A", state: "firing", attempt: 1 } })),
    signedAlert(source.id, JSON.stringify({ event: { key: "lamp-concurrent-dedup", summary: "Concurrent dedup alert B", state: "firing", attempt: 2 } })),
  ]);
  for (const response of concurrentDedup) assert.equal(response.status, 202, await response.clone().text());
  const dedupBodies = await Promise.all(concurrentDedup.map((response) => response.json()));
  assert.equal(dedupBodies[0].incidentId, dedupBodies[1].incidentId, "a concurrent firing key must attach to one unresolved incident");

  const concurrentAlerts = await Promise.all([
    signedAlert(source.id, JSON.stringify({ event: { key: "lamp-concurrent-a", summary: "Concurrent alert A", state: "firing" } })),
    signedAlert(source.id, JSON.stringify({ event: { key: "lamp-concurrent-b", summary: "Concurrent alert B", state: "firing" } })),
  ]);
  for (const response of concurrentAlerts) assert.equal(response.status, 202, await response.clone().text());
  const concurrentBodies = await Promise.all(concurrentAlerts.map((response) => response.json()));
  const concurrentIncidents = await Promise.all(concurrentBodies.map((body) => incidentById(body.incidentId)));
  const concurrentReferences = concurrentIncidents.map((incident) => incident.reference);
  assert.equal(new Set(concurrentReferences).size, 2, "concurrent distinct alerts reserve distinct references");
  assert.ok(concurrentReferences.every((reference) => /^INC-\d+$/.test(reference) && Number(reference.slice(4)) > Number(secondReference.slice(4))));

  executeD1(`CREATE TRIGGER lamp_reject_sch1 BEFORE INSERT ON reference_allocations
    WHEN NEW.namespace = 'SCH' AND NEW.reference = 'SCH-1'
    BEGIN SELECT RAISE(ABORT, 'reference unavailable'); END;`);
  const maintenanceAllocationFailure = await appFetch("/api/app/maintenance", {
    method: "POST",
    body: JSON.stringify({ affectedAudience: "Customers using the scheduled service.", customerImpact: "Requests may be interrupted during this maintenance window.", title: "Allocator failure", startsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(), endsAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(), componentIds: ["01J00000000000000000000013"] }),
  });
  assert.equal(maintenanceAllocationFailure.status, 409, await maintenanceAllocationFailure.clone().text());
  executeD1("DROP TRIGGER lamp_reject_sch1;");

  const invalidMaintenance = await appFetch("/api/app/maintenance", {
    method: "POST",
    body: JSON.stringify({ affectedAudience: "Customers using the scheduled service.", customerImpact: "Requests may be interrupted during this maintenance window.", title: "Missing component", startsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(), endsAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(), componentIds: ["missing-component"] }),
  });
  assert.equal(invalidMaintenance.status, 409, await invalidMaintenance.clone().text());

  const maintenanceOne = await createMaintenance("First maintenance", "01J00000000000000000000013");
  const maintenanceTwo = await createMaintenance("Second maintenance", "01J00000000000000000000014");
  assert.deepEqual([maintenanceOne.reference, maintenanceTwo.reference], ["SCH-1", "SCH-2"]);
  const maintenanceConcurrent = await Promise.all([
    createMaintenance("Concurrent maintenance A", "01J00000000000000000000015", 4),
    createMaintenance("Concurrent maintenance B", "01J00000000000000000000011", 5),
  ]);
  assert.deepEqual(new Set(maintenanceConcurrent.map((record) => record.reference)), new Set(["SCH-3", "SCH-4"]));
});
