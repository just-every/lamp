import { availabilityReportFlow } from "./helpers/availability-report-flow.mjs";
import { communicationPerformanceFlow } from "./helpers/communication-performance-flow.mjs";
import { incidentImpactFlow } from "./helpers/incident-impact-flow.mjs";
import { importedTemplateApplyFlow } from "./helpers/imported-template-apply-flow.mjs";
import { reviewUpdateFlow } from "./helpers/review-update-flow.mjs";
import { updateComponentFlow } from "./helpers/update-component-flow.mjs";
import { test } from 'node:test';
import { requestHeaders } from "../helpers/request-headers.mjs";
import { withDraftVersion } from "./draft-version-helper.mjs";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { after, before } from "node:test";
import { createServer as createViteServer } from "vite";

import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { appOrigin, pageOrigin } from "./helpers/hosts.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { assertDraftMetadataIsolation } from "./draft-metadata-regression.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";

let appUrl = "";
let pageUrl = "";
let testPort;
const testStatePath = fileURLToPath(new URL("./.wrangler/publishing-state", import.meta.url));
process.env.MINIFLARE_CACHE_DIR = `${testStatePath}/miniflare-cache`;
const testViteCachePath = fileURLToPath(new URL("./.vite/publishing-contract", import.meta.url));
let server;
let sessionId;
let serverOutput = "";
let degradedHourMinutes;
let pageTimezone;

async function appFetch(path, init = {}) {
  init = await withDraftVersion(path, init, appFetch);
  return fetch(`${appUrl}${path}`, { ...init, headers: requestHeaders({ Connection: "close", Cookie: `${sessionCookieName(appUrl)}=${sessionId}`, "Content-Type": "application/json" }, init.headers) });
}

async function responseBody(response) {
  const body = await response.text();
  throw new Error(`${response.status} ${response.statusText}: ${body}`);
}

async function expectStatus(response, status) {
  if (response.status !== status) await responseBody(response);
  return response;
}

function draftFor(overrides = {}) {
  return { ...validDraft, nextUpdateAt: new Date(Date.now() + 60 * 60_000).toISOString(), ...overrides };
}

async function createIncident(title, options = {}) {
  const response = await appFetch("/api/app/incidents", {
    method: "POST",
    body: JSON.stringify({
      title,
      components: [{ componentId: "01J00000000000000000000011", state: "Major outage", relationship: "Primary" }],
      ...options,
    }),
  });
  await expectStatus(response, 201);
  return (await response.json()).incident;
}

async function createIsolatedComponent(name) {
  const response = await appFetch("/api/app/components", {
    method: "POST",
    body: JSON.stringify({ groupId: null, name, description: "A component isolated to one contract assertion.", internal: false, displayOrder: 1000, note: "" }),
  });
  await expectStatus(response, 201);
  return (await response.json()).component;
}

async function saveDraft(incidentId, overrides = {}) {
  return expectStatus(await appFetch(`/api/app/incidents/${incidentId}/draft`, {
    method: "PUT",
    body: JSON.stringify(draftFor(overrides)),
  }), 200);
}

async function publish(incidentId, options = {}) {
  return appFetch(`/api/app/incidents/${incidentId}/publish`, {
    method: "POST",
    body: JSON.stringify({ channels: [], ...options }),
  });
}

async function incidentView(incidentId) {
  const response = await expectStatus(await appFetch(`/api/app/incidents/${incidentId}`), 200);
  return (await response.json()).incident;
}

async function eventually(read, predicate, description) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}. Worker output:\n${serverOutput}`);
}

function localWallClockInstant(daysAgo, hour, minute, timezone, now = Date.now()) {
  const calendar = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const todayParts = calendar.formatToParts(new Date(now));
  const value = (parts, kind) => Number(parts.find((entry) => entry.type === kind)?.value);
  const today = new Date(Date.UTC(value(todayParts, "year"), value(todayParts, "month") - 1, value(todayParts, "day") - daysAgo));
  const wanted = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hour, minute);
  const wallClock = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let candidate = wanted;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = wallClock.formatToParts(new Date(candidate));
    const represented = Date.UTC(value(parts, "year"), value(parts, "month") - 1, value(parts, "day"), value(parts, "hour"), value(parts, "minute"), value(parts, "second"));
    const adjusted = candidate + wanted - represented;
    if (adjusted === candidate) return new Date(candidate).toISOString();
    candidate = adjusted;
  }
  throw new Error(`could not resolve ${timezone} local wall clock time`);
}

function localDateKey(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp));
  const value = (kind) => parts.find((entry) => entry.type === kind)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// Anchor at the preceding local half-day so the one/two-hour fixture fits one
// date while the two-day coverage assertion still covers at least 48 hours.
function historicalIntervalStart(daysAgo, timezone, now = Date.now()) {
  const anchor = now - daysAgo * 24 * 60 * 60_000;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date(anchor)));
  return localWallClockInstant(0, hour < 12 ? 0 : 12, 0, timezone, anchor);
}

// The retained 1440-minute assertion requires an actual 24-hour calendar day.
// Search only this small historical fixture window; never change the expectation.
function fullDayFixture(timezone, now = Date.now()) {
  for (let daysAgo = 3; daysAgo <= 9; daysAgo += 1) {
    const start = localWallClockInstant(daysAgo, 0, 0, timezone, now);
    const end = localWallClockInstant(daysAgo - 1, 0, 0, timezone, now);
    if (Date.parse(end) - Date.parse(start) === 24 * 60 * 60_000) return { daysAgo, date: localDateKey(start, timezone) };
  }
  throw new Error(`No 24-hour day in the ${timezone} fixture window`);
}

function componentDowntimeMark(name, day, minutes) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<article class="component"><div class="component-name"><h4>${escapedName}</h4>(?:(?!</article>)[\\s\\S])*?aria-label="${day}: Downtime ${minutes} minutes \\(weighted\\)[^"]*"(?:(?!</article>)[\\s\\S])*?</article>`);
}

async function publicArtifact(path, expected, description) {
  return eventually(
    async () => {
      const response = await fetch(`${pageUrl}${path}`);
      return { response, text: await response.text() };
    },
    ({ response, text }) => response.status === 200 && (expected instanceof RegExp ? expected.test(text) : text.includes(expected)),
    description,
  );
}

async function signedIntake(sourceId, secret, payload) {
  const body = JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("base64url");
  return fetch(`${pageUrl}/api/intake/${sourceId}`, { method: "POST", headers: { "Content-Type": "application/json", "x-lamp-timestamp": timestamp, "x-lamp-signature": signature }, body });
}

async function createIntakeSource(name, overrides = {}) {
  const response = await appFetch("/api/app/intake/sources", { method: "POST", body: JSON.stringify({ name, credentialKind: "hmac-sha256", signingSecret: "contract-intake-secret", deduplicationPath: "$.alert.id", titlePath: "$.alert.title", statePath: "$.alert.state", recoveredValue: "recovered", ...overrides }) });
  await expectStatus(response, 201);
  return (await response.json()).source;
}

async function loadMaintenanceRepositoryFactory() {
  const vite = await createIsolatedViteServer();
  try {
    return (await vite.ssrLoadModule("/src/core/features/maintenance/repository.ts")).createMaintenanceRepository;
  } finally {
    await vite.close();
  }
}

function createTransactionalD1Fixture(database) {
  const statement = (sql, values = []) => ({
    bind: (...nextValues) => statement(sql, nextValues),
    run: async () => {
      const result = database.prepare(sql).run(...values);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        database.exec("COMMIT");
        return results;
      } catch (cause) {
        database.exec("ROLLBACK");
        throw cause;
      }
    },
  };
}

async function loadPublicSnapshotServiceFactory() {
  const vite = await createIsolatedViteServer();
  try {
    return (await vite.ssrLoadModule("/src/core/features/public-snapshot/service.ts")).createPublicSnapshotService;
  } finally {
    await vite.close();
  }
}

async function reserveViteHmrPort() {
  return reservePort({ label: "Vite HMR" });
}

async function reserveTestPort() {
  return reserveViteHmrPort();
}

async function createIsolatedViteServer() {
  const hmrPort = await reserveViteHmrPort();
  return createViteServer({ configFile: false, cacheDir: `${testViteCachePath}/isolated-loader`, appType: "custom", server: { middlewareMode: true, hmr: { port: hmrPort } } });
}

function executeFixtureSql(statement) {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", testStatePath, "--command", statement], { cwd: process.cwd(), stdio: "pipe" });
}

function queryD1Sql(persistTo, statement) {
  const output = execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", persistTo, "--command", statement, "--json"], { cwd: process.cwd(), encoding: "utf8" });
  const [result] = JSON.parse(output);
  if (!result?.success) throw new Error(`Local D1 query failed: ${statement}`);
  return result.results;
}

function r2Object(key, input) {
  const action = input === undefined ? "get" : "put";
  return execFileSync("pnpm", ["exec", "wrangler", "r2", "object", action, `lamp-local-snapshots/${key}`, "--local", "--persist-to", testStatePath, "--pipe"], { cwd: process.cwd(), encoding: "utf8", input });
}

before(async () => {
  testPort = await reserveTestPort();
  appUrl = appOrigin(testPort);
  pageUrl = pageOrigin(testPort);
  rmSync(testStatePath, { recursive: true, force: true });
  rmSync(testViteCachePath, { recursive: true, force: true });
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", testStatePath], { cwd: process.cwd(), stdio: "pipe" });
  // Configure this fixture before the Worker builds its initial public snapshot.
  sessionId = await insertRealOperatorSession({ persistTo: testStatePath });
  server = spawn("pnpm", ["exec", "vite", "--configLoader", "native", "--host", "0.0.0.0", "--port", String(testPort), "--strictPort"], { cwd: process.cwd(), stdio: "pipe", detached: true, env: { ...process.env, LAMP_WORKERS_STATE_PATH: testStatePath, LAMP_VITE_CACHE_DIR: testViteCachePath, LAMP_DISABLE_INSPECTOR: "true" } });
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  await waitForWorker({ origin: appUrl, child: server, output: () => `${serverOutput}\nState: ${testStatePath}`, label: "Publishing-contract Worker" });
  const policyLoader = await createIsolatedViteServer();
  try {
    const { createServerExtensionMount } = await policyLoader.ssrLoadModule("/src/core/app/extensions/server.ts");
    degradedHourMinutes = 60 * createServerExtensionMount().publicSnapshotPolicies.uptimeDowntimeWeight("Degraded performance");
  } finally { await policyLoader.close(); }
  const identity = await (await fetch(`${pageUrl}/`)).text();
  assert.match(identity, /id="overall-status" data-overall/, "test listener did not serve Lamp's public snapshot");
  assert.match(identity, /data-generated-at/, "public snapshot must expose its generation time independently of owner branding");
  pageTimezone = (await (await appFetch("/api/app/page-settings")).json()).settings.timezone;
  executeFixtureSql(`INSERT INTO components (id,group_id,name,description,internal,display_order,note,created_at,updated_at) VALUES ('01J00000000000000000000011',NULL,'Contract API','A test-owned public component.',0,1,'','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z'); INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,deactivation_reason,deactivated_at,created_at,updated_at) VALUES ('01J00000000000000000000070','email','contract-subscriber@example.test',NULL,'active','all','contract-token-hash',NULL,NULL,'2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z')`);
});
after(async () => {
  if (server && !server.killed) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    try {
      process.kill(-server.pid, "SIGTERM");
      await stopped;
    } catch (cause) {
      if (cause?.code !== "ESRCH") throw cause;
    }
  }
  rmSync(testStatePath, { recursive: true, force: true });
  rmSync(testViteCachePath, { recursive: true, force: true });
});

const validDraft = {
  lifecycle: "Identified", affectedAudience: "API customers.", customerImpact: "Some requests can fail.", whatStillWorks: "The dashboard remains available.", details: "Engineers are mitigating the condition.", nextUpdateAt: "2026-09-08T04:00:00.000Z",
};

test("UPDATE-001 UPDATE-008 UPDATE-002 UPDATE-003 UPDATE-011 UPDATE-012 UPDATE-013 — Validated publication, shared rendering and resolution", async t => {
  t.diagnostic("UPDATE-001 — invalid required publication fields return 400 and leave the draft unpublished");
  await (async () => {
  const created = await appFetch("/api/app/incidents", { method: "POST", body: JSON.stringify({ title: "Publication transaction test", components: [{ componentId: "01J00000000000000000000011", state: "Major outage", relationship: "Primary" }] }) });
  assert.equal(created.status, 201);
  const incident = (await created.json()).incident;
  const rejected = await appFetch(`/api/app/incidents/${incident.id}/publish`, { method: "POST", body: JSON.stringify({ channels: ["email"] }) });
  assert.equal(rejected.status, 400);
  const before = (await (await appFetch(`/api/app/incidents/${incident.id}`)).json()).incident;
  assert.equal(before.updates.length, 0);
  assert.equal((await (await appFetch(`/api/app/deliveries?incidentUpdateId=${before.draft.id}`)).json()).deliveries.length, 0);

  assert.equal((await appFetch(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify(draftFor()) })).status, 200);
  const published = await appFetch(`/api/app/incidents/${incident.id}/publish`, { method: "POST", body: JSON.stringify({ channels: ["email"] }) });
  if (published.status !== 200) throw new Error(await published.text());
  const update = (await published.json()).update;
  const deliveries = (await (await appFetch(`/api/app/deliveries?incidentUpdateId=${update.id}`)).json()).deliveries;
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].channel, "email");
  const replay = await appFetch(`/api/app/incidents/${incident.id}/publish`, { method: "POST", body: JSON.stringify({ channels: ["email"] }) });
  assert.equal(replay.status, 409);
  assert.equal((await (await appFetch(`/api/app/incidents/${incident.id}`)).json()).incident.updates.length, 1);
})(t);
  t.diagnostic("UPDATE-008 — a repeated publish cannot create a second immutable update or recipient record");
  await (async () => {
  const incident = await createIncident("Recipient snapshot retry");
  await saveDraft(incident.id);
  const first = await publish(incident.id, { channels: ["email"] });
  await expectStatus(first, 200);
  const update = (await first.json()).update;
  const replay = await publish(incident.id, { channels: ["email"] });
  assert.equal(replay.status, 409);
  const deliveries = (await (await appFetch(`/api/app/deliveries?incidentUpdateId=${update.id}`)).json()).deliveries;
  assert.equal(deliveries.length, 1);
  assert.equal((await incidentView(incident.id)).updates.length, 1);
})(t);
  t.diagnostic("UPDATE-002 — preview, public page, Atom feed, and widget retain every populated update field");
  await (async () => {
  const incident = await createIncident("Shared update renderer");
  const draft = draftFor({ affectedAudience: "Regional API customers.", customerImpact: "Regional writes can be delayed.", whatStillWorks: "Reads remain available.", details: "A connection limit is being raised." });
  const preview = await appFetch(`/api/app/incidents/${incident.id}/draft/preview`, { method: "POST", body: JSON.stringify(draft) });
  await expectStatus(preview, 200);
  const rendered = (await preview.json()).preview;
  assert.equal(rendered.public.fields.some((field) => field.label === "Who is affected" && field.value === "Regional API customers."), true);
  const nextUpdate = rendered.public.fields.find((field) => field.label === "Next update by");
  assert.match(nextUpdate?.value ?? "", /UTC[+-]\d{2}:\d{2}/, "preview uses the same configured timezone and offset as the shared public/email renderer");
  assert.notEqual(nextUpdate?.value, draft.nextUpdateAt, "preview must not expose the raw ISO instant shown only in storage");
  assert.match(rendered.email.plainText, /A connection limit is being raised/);
  await saveDraft(incident.id, draft);
  await expectStatus(await publish(incident.id), 200);
  const publicationStarted = performance.now();
  for (const path of [`/incidents/${incident.reference}`, "/feed.atom", "/widget.js"]) {
    const { text: body } = await publicArtifact(path, /Regional API customers/, `published update fields on ${path}`);
    assert.ok(body.includes(incident.title), "public fields must belong to the just-published incident");
    assert.match(body, /Regional API customers/);
    assert.match(body, /Regional writes can be delayed/);
    assert.match(body, /Reads remain available/);
    assert.match(body, /connection limit is being raised/i);
  }
  assert.ok(performance.now() - publicationStarted < 10_000, "all public surfaces must reflect publication within PAGE-007's ten-second window");
})(t);
  t.diagnostic("UPDATE-003 — a resolved publication records the end time and returns the component to its derived public state");
  await (async () => {
  const component = await createIsolatedComponent("Resolution component rollup");
  const incident = await createIncident("Resolution component rollup", { components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }] });
  await saveDraft(incident.id, { lifecycle: "Resolved" });
  await expectStatus(await publish(incident.id), 200);
  const resolved = await incidentView(incident.id);
  assert.equal(resolved.lifecycle, "Resolved");
  assert.equal(typeof resolved.resolvedAt, "string");
  const components = (await (await appFetch("/api/app/components")).json()).components;
  assert.equal(components.find((item) => item.id === component.id).publicState, "Operational");
})(t);
  t.diagnostic("UPDATE-011 UPDATE-012 UPDATE-013 — advisory wording, versioned staged recovery, immutable changes and safe public links");
  const recovery = await updateComponentFlow({ appFetch });
  const html = (await publicArtifact(recovery.publicIncidentPath, /Update publishing API: Major outage/, "immutable public component changes")).text;
  assert.match(html, /href="https:\/\/help\.example\.com\/kb\/123" rel="nofollow noopener ugc"/);
  assert.doesNotMatch(html, /href="(?:https:\/\/x\.test|javascript:|http:\/\/help)/);
  assert.match(html, /&lt;a href=&quot;https:\/\/x\.test&quot;&gt;x&lt;\/a&gt;/);
  for (const path of ["/feed.atom", "/feed.rss"]) {
    const body = await (await fetch(pageUrl + path)).text();
    assert.match(body, /https:\/\/help\.example\.com\/kb\/123/);
    assert.match(body, /nofollow noopener ugc/);
  }
  const native = await (await fetch(pageUrl + "/api/public/v1/incidents")).json();
  const retained = native.data.find(item => item.id === recovery.incident.id).updates.find(item => item.id === recovery.stepDownUpdate.id);
  assert.deepEqual(retained.componentChanges, [{ componentId: recovery.component.id, name: recovery.component.name, previousState: "Major outage", newState: "Degraded performance" }]);
  const compatibility = await (await fetch(pageUrl + "/api/v2/incidents.json")).json();
  const changes = compatibility.incidents.find(item => item.name === recovery.incident.title).incident_updates.flatMap(update => update.affected_components);
  assert.ok(changes.some(change => change.name === recovery.component.name && change.old_status === "major_outage" && change.new_status === "degraded_performance"));
});







test("UPDATE-005 UPDATE-006 UPDATE-007 UPTIME-009 — Private drafts, scheduled publication and independent review", async t => {
  t.diagnostic("UPDATE-005 — a private saved draft survives an operator reload without appearing in the public snapshot");
  await (async () => {
  const incident = await createIncident("Private draft persistence");
  const secret = "synthetic-UNPUBLISHED-DRAFT-TEXT";
  await saveDraft(incident.id, { details: secret });
  const restored = await incidentView(incident.id);
  assert.equal(restored.draft.details, secret);
  for (const path of ["/", "/history", "/feed.atom", "/widget.js"]) {
    assert.doesNotMatch(await (await fetch(`${pageUrl}${path}`)).text(), new RegExp(secret));
  }
})(t);
  t.diagnostic("UPDATE-006 — a future scheduled draft remains private until the scheduled Worker run publishes it");
  await (async () => {
  const incident = await createIncident("Scheduled update privacy");
  const details = "SCHEDULED-UPDATE-PUBLIC-AFTER-RUN";
  await saveDraft(incident.id, { details });
  const pastRequest = await appFetch(`/api/app/incidents/${incident.id}/draft/schedule`, { method: "POST", body: JSON.stringify({ publishAt: new Date(Date.now() - 1000).toISOString(), channels: [] }) });
  await expectStatus(pastRequest, 409);
  assert.match((await pastRequest.json()).error, /must be in the future/);
  // Keep the fixture future-dated through real request and D1 latency.
  const publishAt = new Date(Date.now() + 5000).toISOString();
  await expectStatus(await appFetch(`/api/app/incidents/${incident.id}/draft/schedule`, { method: "POST", body: JSON.stringify({ publishAt, channels: [] }) }), 202);
  assert.doesNotMatch(await (await fetch(`${pageUrl}/`)).text(), new RegExp(details));
  assert.ok(Date.now() < Date.parse(publishAt), "early cron runs before the committed publication time");
  await expectStatus(await fetch(`${pageUrl}/cdn-cgi/local/scheduled`), 200);
  assert.equal((await incidentView(incident.id)).updates.length, 0);
  assert.doesNotMatch(await (await fetch(`${pageUrl}/`)).text(), new RegExp(details));
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(publishAt) - Date.now()) + 100));
  await expectStatus(await fetch(`${pageUrl}/cdn-cgi/local/scheduled`), 200);
  await publicArtifact(`/incidents/${incident.reference}`, details, "scheduled publication");
})(t);
  t.diagnostic("UPDATE-007 — the update review policy can hold publication until a different operator has reviewed the draft");
  await (async () => {
  const { getPlatformProxy } = await import("wrangler");
  const platform = await getPlatformProxy({ configPath: "wrangler.jsonc", persist: { path: `${testStatePath}/v3` }, remoteBindings: false });
  const loader = await createIsolatedViteServer();
  try {
    await reviewUpdateFlow({ vite: loader, bindings: platform.env });
    t.diagnostic("NOTIFY-015 HIST-005 — committed subscriber reach and monthly communication promises use retained facts");
    await communicationPerformanceFlow({ vite: loader, bindings: platform.env });
    t.diagnostic("UPTIME-009 — month and quarter exports match public uptime math and retain all overlapping claims");
    await availabilityReportFlow({ vite: loader, bindings: platform.env, appFetch });
  }
  finally { await platform.dispose(); await loader.close(); }
})(t);
});





test("PAGE-006 UPDATE-009 MOVE-011 — Snapshot outage, private template application and imported Statuspage templates", async t => {
  await importedTemplateApplyFlow({ appFetch, pageUrl, executeFixtureSql });
  t.diagnostic("PAGE-006 — a warmed snapshot remains available and visibly stale when R2 pointer reads fail");
  await (async () => {
  const pointer = r2Object("snapshots/current.json");
  assert.match(pointer, /"version"/);
  const warm = await fetch(`${pageUrl}/`);
  await expectStatus(warm, 200);
  const validator = warm.headers.get("etag");
  try {
    r2Object("snapshots/current.json", "not-json");
    const stale = await fetch(`${pageUrl}/`, { headers: validator ? { "If-None-Match": validator } : {} });
    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get("x-lamp-snapshot-state"), "stale");
    assert.equal(stale.headers.get("etag"), null, "an unverified generation never validates cached current-state bytes");
    const staleBody = await stale.text();
    assert.match(staleBody, /Last known state/);
    const generatedAt = stale.headers.get("x-lamp-snapshot-generated-at");
    assert.ok(generatedAt && Number.isFinite(Date.parse(generatedAt)), "stale content must retain a valid generation instant");
    assert.ok(staleBody.includes(generatedAt), "the visible stale warning must identify its generation instant");
  } finally {
    r2Object("snapshots/current.json", pointer);
  }
})(t);
  t.diagnostic("UPDATE-009 — applying a saved template fills a draft and component claims without publishing");
  await (async () => {
  const template = await appFetch("/api/app/incident-templates", { method: "POST", body: JSON.stringify({ name: "Template contract", lifecycle: "Monitoring", affectedAudience: "Template audience.", customerImpact: "Template impact.", whatStillWorks: "Template works.", details: "TEMPLATE-PRIVATE-DETAIL", nextUpdateOffsetMinutes: 60, components: [{ componentId: "01J00000000000000000000011", state: "Partially unavailable", relationship: "Primary" }] }) });
  await expectStatus(template, 201);
  const incident = await createIncident("Template application");
  await expectStatus(await appFetch(`/api/app/incidents/${incident.id}/templates/${(await template.json()).template.id}/apply`, { method: "POST" }), 200);
  const restored = await incidentView(incident.id);
  assert.equal(restored.draft.lifecycle, "Monitoring");
  assert.equal(restored.draft.details, "TEMPLATE-PRIVATE-DETAIL");
  assert.equal(restored.updates.length, 0);
  assert.doesNotMatch(await (await fetch(`${pageUrl}/`)).text(), /TEMPLATE-PRIVATE-DETAIL/);
})(t);
});



test("INCIDENT-001 INCIDENT-002 INCIDENT-003 INCIDENT-004 INCIDENT-005 INCIDENT-006 INCIDENT-007 INCIDENT-008 INCIDENT-009 — Incident lifecycle, immutable correction, reasoned deletion and historical replay", async t => {
  await incidentImpactFlow({ appFetch, pageUrl });
  t.diagnostic("INCIDENT-001 — an incident begins Investigating and each published update makes its selected lifecycle public");
  await (async () => {
  const incident = await createIncident("Lifecycle publication");
  assert.equal(incident.lifecycle, "Investigating");
  await saveDraft(incident.id, { lifecycle: "Identified", customerImpact: "A bounded customer impact." });
  await expectStatus(await publish(incident.id), 200);
  assert.equal((await incidentView(incident.id)).lifecycle, "Identified");
  await publicArtifact(`/incidents/${incident.reference}`, "Identified", "identified incident page");
  await saveDraft(incident.id, { lifecycle: "Resolved", customerImpact: "The customer impact is over." });
  await expectStatus(await publish(incident.id), 200);
  const resolved = await incidentView(incident.id);
  assert.equal(resolved.lifecycle, "Resolved");
  assert.equal(typeof resolved.resolvedAt, "string");
})(t);
  t.diagnostic("INCIDENT-002 — the incident impact retains the most severe component state it ever claimed");
  await (async () => {
  const incident = await createIncident("Peak impact retention");
  await saveDraft(incident.id, { lifecycle: "Resolved" });
  await expectStatus(await publish(incident.id), 200);
  const resolved = await incidentView(incident.id);
  assert.equal(resolved.impact, "Major outage");
  assert.equal(resolved.components[0].state, "Major outage");
})(t);
  t.diagnostic("INCIDENT-003 — incidents receive a stable numeric reference and public URL");
  await (async () => {
  const first = await createIncident("Stable incident reference");
  const second = await createIncident("Different incident reference");
  assert.match(first.reference, /^INC-\d+$/);
  assert.notEqual(first.reference, second.reference);
  await saveDraft(first.id);
  await expectStatus(await publish(first.id), 200);
  await publicArtifact(`/incidents/${first.reference}`, first.title, "incident public URL");
})(t);
  t.diagnostic("INCIDENT-004 — a correction publishes an immutable update linked to the correction target");
  await (async () => {
  const incident = await createIncident("Correction chain");
  await saveDraft(incident.id, { details: "Initial customer wording." });
  const original = await incidentView(incident.id);
  const consumedVersion = `${original.draft.id}:${original.updates.length}`;
  const first = await publish(incident.id);
  await expectStatus(first, 200);
  const initialUpdate = (await first.json()).update;
  await saveDraft(incident.id, { details: "Corrected customer wording." });
  const reviewed = await assertDraftMetadataIsolation({ baseUrl: appUrl, appFetch, incidentView, executeFixtureSql, incidentId: incident.id, consumedVersion, targetUpdateId: initialUpdate.id });
  await expectStatus(await appFetch(`/api/app/incidents/${incident.id}/draft/correction`, { method: "POST", body: JSON.stringify({ updateId: initialUpdate.id }) }), 200);
  const marked = await incidentView(incident.id);
  assert.deepEqual(marked.draft, { ...reviewed.draft, correctsUpdateId: initialUpdate.id, updatedAt: marked.draft.updatedAt });
  assert.ok(Number.isFinite(Date.parse(marked.draft.updatedAt)));
  assert.deepEqual(marked.updates, reviewed.updates);
  const correction = await publish(incident.id);
  await expectStatus(correction, 200);
  const correctedUpdate = (await correction.json()).update;
  assert.equal(correctedUpdate.correctsUpdateId, initialUpdate.id);
  const updates = await incidentView(incident.id);
  assert.equal(updates.updates.length, 2);
  assert.equal(updates.updates.find((update) => update.id === initialUpdate.id).details, "Initial customer wording.");
})(t);
  t.diagnostic("INCIDENT-005 — a later published update can reopen a resolved incident while retaining both immutable updates");
  await (async () => {
  const incident = await createIncident("Resolution lifecycle update");
  await saveDraft(incident.id, { lifecycle: "Resolved" });
  await expectStatus(await publish(incident.id), 200);
  await saveDraft(incident.id, { lifecycle: "Investigating" });
  await expectStatus(await publish(incident.id), 200);
  const view = await incidentView(incident.id);
  assert.equal(view.lifecycle, "Investigating");
  assert.equal(view.updates.length, 2);
  assert.equal(view.updates.some((update) => update.lifecycle === "Investigating"), true);
  assert.equal(view.updates.some((update) => update.lifecycle === "Resolved"), true);
})(t);
  t.diagnostic("INCIDENT-006 — an overdue next-update commitment is visible to operators and never appears as public incident copy");
  await (async () => {
  const incident = await createIncident("Expired commitment");
  await saveDraft(incident.id, { nextUpdateAt: new Date(Date.now() - 60_000).toISOString() });
  await expectStatus(await publish(incident.id), 200);
  assert.equal((await incidentView(incident.id)).overdue, true);
  const publicPage = await publicArtifact(`/incidents/${incident.reference}`, incident.title, "overdue incident public page");
  assert.doesNotMatch(publicPage.text, /\boverdue\b/i);
})(t);
  t.diagnostic("INCIDENT-007 — deletion requires a reason and removes an incident from public history and the Atom feed");
  await (async () => {
  const incident = await createIncident("Audited deletion");
  await saveDraft(incident.id, { lifecycle: "Resolved" });
  await expectStatus(await publish(incident.id), 200);
  assert.equal((await appFetch(`/api/app/incidents/${incident.id}`, { method: "DELETE", body: JSON.stringify({}) })).status, 400);
  await expectStatus(await appFetch(`/api/app/incidents/${incident.id}`, { method: "DELETE", body: JSON.stringify({ reason: "Duplicate operator report" }) }), 200);
  assert.equal((await appFetch(`/api/app/incidents/${incident.id}`)).status, 404);
  await eventually(
    async () => ({ page: await (await fetch(`${pageUrl}/history`)).text(), feed: await (await fetch(`${pageUrl}/feed.atom`)).text() }),
    ({ page, feed }) => !page.includes(incident.reference) && !feed.includes(incident.reference),
    "deleted incident removal from public artifacts",
  );
})(t);
  t.diagnostic("INCIDENT-008 — an internal note is excluded from every public artifact");
  await (async () => {
  const incident = await createIncident("Internal note isolation");
  const note = "PRIVATE-INCIDENT-NOTE-DO-NOT-RENDER";
  await expectStatus(await appFetch(`/api/app/incidents/${incident.id}/internal-notes`, { method: "POST", body: JSON.stringify({ body: note }) }), 201);
  await saveDraft(incident.id);
  await expectStatus(await publish(incident.id), 200);
  for (const path of ["/", `/incidents/${incident.reference}`, "/feed.atom", "/widget.js"]) {
    const response = await fetch(`${pageUrl}${path}`);
    await expectStatus(response, 200);
    assert.doesNotMatch(await response.text(), new RegExp(note));
  }
})(t);
  t.diagnostic("INCIDENT-007 — deleting an incident releases its source claim before a later retroactive replay");
  await (async () => {
  const component = await createIsolatedComponent("Deleted incident claim release component");
  const deleted = await createIncident("Deleted incident source claim", { components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }] });
  await saveDraft(deleted.id, { lifecycle: "Investigating" });
  await expectStatus(await publish(deleted.id), 200);
  assert.equal((await (await appFetch("/api/app/components")).json()).components.find((entry) => entry.id === component.id)?.publicState, "Major outage");

  await expectStatus(await appFetch(`/api/app/incidents/${deleted.id}`, { method: "DELETE", body: JSON.stringify({ reason: "Regression cleanup" }) }), 200);
  const release = await eventually(
    async () => queryD1Sql(testStatePath, `SELECT changed_at AS changedAt FROM component_claim_events WHERE component_id = '${component.id}' AND cause_type = 'incident' AND cause_id = '${deleted.id}' AND state IS NULL ORDER BY changed_at DESC, created_at DESC, id DESC LIMIT 1`)[0] ?? null,
    Boolean,
    "deleted incident source release",
  );
  await eventually(
    async () => (await (await appFetch("/api/app/components")).json()).components.find((entry) => entry.id === component.id),
    (entry) => entry?.publicState === "Operational",
    "deleted incident present-state release",
  );

  const retroactiveStart = historicalIntervalStart(2, pageTimezone);
  const retroactiveEnd = new Date(Date.parse(retroactiveStart) + 60 * 60_000).toISOString();
  const retroactive = await createIncident("Later replay after deleted source", { openedAt: retroactiveStart, components: [{ componentId: component.id, state: "Degraded performance", relationship: "Primary" }] });
  await saveDraft(retroactive.id, { lifecycle: "Investigating", nextUpdateAt: retroactiveEnd });
  await expectStatus(await publish(retroactive.id, { publishedAt: retroactiveStart }), 200);
  await saveDraft(retroactive.id, { lifecycle: "Resolved", nextUpdateAt: retroactiveEnd });
  await expectStatus(await publish(retroactive.id, { publishedAt: retroactiveEnd }), 200);

  await eventually(
    async () => queryD1Sql(testStatePath, `SELECT new_state AS newState FROM component_state_history WHERE component_id = '${component.id}' AND changed_at = '${release.changedAt}' ORDER BY changed_at ASC, created_at ASC, id ASC`),
    (rows) => rows.at(-1)?.newState === "Operational",
    "deleted source remains released after a retroactive replay",
  );
  assert.equal((await (await appFetch("/api/app/components")).json()).components.find((entry) => entry.id === component.id)?.publicState, "Operational");
  const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: pageTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(retroactiveStart));
  const part = (kind) => dateParts.find((entry) => entry.type === kind)?.value;
  await publicArtifact("/", `${part("year")}-${part("month")}-${part("day")}: Downtime ${degradedHourMinutes} minutes (weighted)`, "retroactive uptime after deleted claim release");
})(t);
  t.diagnostic("INCIDENT-009 — retroactive updates reconstruct historical component state without disturbing a current same-component claim");
  await (async () => {
  const component = await createIsolatedComponent("Retroactive overlap component");
  const initialHistory = await appFetch(`/api/app/components/${component.id}/history`);
  await expectStatus(initialHistory, 200);
  assert.deepEqual((await initialHistory.json()).history.map((entry) => ({ previousState: entry.previousState, newState: entry.newState, causeType: entry.causeType })), [{ previousState: "Operational", newState: "Operational", causeType: "standing-claim" }]);
  assert.equal(queryD1Sql(testStatePath, `SELECT COUNT(*) AS count FROM component_claim_events WHERE component_id = '${component.id}' AND cause_type = 'standing-claim' AND cause_id IS NULL AND state = 'Operational'`)[0]?.count, 1);
  await publicArtifact("/", new RegExp(`<h4>${component.name}</h4>[\\s\\S]*?<span class="uptime-number">(?:100.00% over [^<]+|No data)</span>`), "healthy component initial coverage");
  const historicalStart = historicalIntervalStart(2, pageTimezone);
  const historicalEnd = new Date(Date.parse(historicalStart) + 60 * 60_000).toISOString();
  const current = await createIncident("Current same-component outage", { components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }] });
  await saveDraft(current.id, { lifecycle: "Identified" });
  await expectStatus(await publish(current.id), 200);
  const maintenanceCreated = await appFetch("/api/app/maintenance", { method: "POST", body: JSON.stringify({ title: "Current maintenance provenance", startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 60 * 60_000).toISOString(), componentIds: [component.id] }) });
  await expectStatus(maintenanceCreated, 201);
  const maintenance = (await maintenanceCreated.json()).maintenance;
  await expectStatus(await fetch(`${pageUrl}/cdn-cgi/local/scheduled`), 200);
  await eventually(async () => (await (await appFetch("/api/app/maintenance")).json()).maintenance.find((record) => record.id === maintenance.id), (record) => record?.state === "In progress", "current maintenance start");
  assert.equal(queryD1Sql(testStatePath, `SELECT COUNT(*) AS count FROM component_claim_events WHERE component_id = '${component.id}' AND cause_type = 'maintenance' AND cause_id = '${maintenance.id}' AND state = 'Under maintenance'`)[0]?.count, 1);

  const incident = await createIncident("Retroactive degraded interval", { openedAt: historicalStart, components: [{ componentId: component.id, state: "Degraded performance", relationship: "Primary" }] });
  await saveDraft(incident.id, { lifecycle: "Investigating", nextUpdateAt: historicalEnd });
  const investigatingPublication = await publish(incident.id, { channels: ["email"], publishedAt: historicalStart });
  await expectStatus(investigatingPublication, 200);
  const investigating = (await investigatingPublication.json()).update;
  assert.equal(investigating.publishedAt, historicalStart);
  assert.equal(investigating.isRetroactive, true);

  await saveDraft(incident.id, { lifecycle: "Resolved", nextUpdateAt: historicalEnd });
  const resolvedPublication = await publish(incident.id, { channels: ["email"], publishedAt: historicalEnd });
  await expectStatus(resolvedPublication, 200);
  const resolved = (await resolvedPublication.json()).update;
  assert.equal(resolved.publishedAt, historicalEnd);
  for (const update of [investigating, resolved]) {
    const deliveries = (await (await appFetch(`/api/app/deliveries?incidentUpdateId=${update.id}`)).json()).deliveries;
    assert.equal(deliveries.length, 0);
  }

  const componentHistory = await eventually(
    async () => (await (await appFetch(`/api/app/components/${component.id}/history`)).json()).history,
    (history) => history.some((entry) => entry.changedAt === historicalStart && entry.previousState === "Operational" && entry.newState === "Degraded performance")
      && history.some((entry) => entry.changedAt === historicalEnd && entry.previousState === "Degraded performance" && entry.newState === "Operational"),
    "retroactive component-state reconstruction",
  );
  assert.equal(componentHistory.filter((entry) => entry.changedAt === historicalStart || entry.changedAt === historicalEnd).length, 2);
  const components = (await (await appFetch("/api/app/components")).json()).components;
  assert.equal(components.find((entry) => entry.id === component.id)?.publicState, "Major outage");

  const historicDay = new Intl.DateTimeFormat("en-CA", { timeZone: pageTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(historicalStart));
  const part = (kind) => historicDay.find((entry) => entry.type === kind)?.value;
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  const snapshot = await publicArtifact("/", `${day}: Downtime ${degradedHourMinutes} minutes (weighted)`, "retroactive uptime mark");
  assert.match(snapshot.text, /over 2 whole days/);
  const history = await publicArtifact("/history", incident.reference, "retroactive incident history");
  assert.match(history.text, new RegExp(historicalStart));
  assert.match(history.text, new RegExp(historicalEnd));

  await saveDraft(incident.id, { lifecycle: "Monitoring" });
  const laterPublication = await publish(incident.id, { channels: ["email"] });
  await expectStatus(laterPublication, 200);
  const later = (await laterPublication.json()).update;
  assert.equal(later.isRetroactive, false);
  assert.equal((await (await appFetch(`/api/app/deliveries?incidentUpdateId=${later.id}`)).json()).deliveries.length, 0, "a retroactive incident never delivers a later update");

  const projectionComponent = await createIsolatedComponent("Retroactive boundary replay component");
  const projectionStart = historicalIntervalStart(5, pageTimezone);
  const projectionBaseStart = projectionStart;
  const projectionBoundary = new Date(Date.parse(projectionStart) + 60 * 60_000).toISOString();
  const projectionEnd = new Date(Date.parse(projectionStart) + 120 * 60_000).toISOString();
  executeFixtureSql(`INSERT INTO component_claim_events (id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at) VALUES ('01J00000000000000000000981','${projectionComponent.id}','incident','fixture-base','Degraded performance','${projectionBaseStart}','${projectionBaseStart}','${projectionBaseStart}')`);
  executeFixtureSql(`INSERT INTO component_state_history (id,component_id,previous_state,new_state,cause_type,cause_id,operator_id,changed_at,created_at,updated_at) VALUES ('01J00000000000000000000982','${projectionComponent.id}','Operational','Degraded performance','incident','fixture-base','01J00000000000000000000001','${projectionBaseStart}','${projectionBaseStart}','${projectionBaseStart}')`);
  executeFixtureSql(`INSERT INTO component_claim_events (id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at) VALUES ('01J00000000000000000000983','${projectionComponent.id}','incident','fixture-base',NULL,'${projectionBoundary}','${projectionBoundary}','${projectionBoundary}')`);
  executeFixtureSql(`INSERT INTO component_state_history (id,component_id,previous_state,new_state,cause_type,cause_id,operator_id,changed_at,created_at,updated_at) VALUES ('01J00000000000000000000984','${projectionComponent.id}','Degraded performance','Operational','incident','fixture-base','01J00000000000000000000001','${projectionBoundary}','${projectionBoundary}','${projectionBoundary}')`);
  const projection = await createIncident("Retroactive major interval across a historical boundary", { openedAt: projectionStart, components: [{ componentId: projectionComponent.id, state: "Major outage", relationship: "Primary" }] });
  await saveDraft(projection.id, { lifecycle: "Investigating", nextUpdateAt: projectionEnd });
  await expectStatus(await publish(projection.id, { publishedAt: projectionStart }), 200);
  await saveDraft(projection.id, { lifecycle: "Resolved", nextUpdateAt: projectionEnd });
  await expectStatus(await publish(projection.id, { publishedAt: projectionEnd }), 200);
  const boundaryRows = queryD1Sql(testStatePath, `SELECT previous_state AS previousState,new_state AS newState FROM component_state_history WHERE component_id = '${projectionComponent.id}' AND changed_at = '${projectionBoundary}' ORDER BY changed_at ASC,created_at ASC,id ASC`);
  assert.deepEqual(boundaryRows.at(-1), { previousState: "Major outage", newState: "Major outage" });
  const projectionDay = new Intl.DateTimeFormat("en-CA", { timeZone: pageTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(projectionStart));
  const projectionPart = (kind) => projectionDay.find((entry) => entry.type === kind)?.value;
  const projectionDate = `${projectionPart("year")}-${projectionPart("month")}-${projectionPart("day")}`;
  await publicArtifact("/", `${projectionDate}: Downtime 120 minutes (weighted)`, "retroactive boundary replay uptime");

  const chronologicalComponent = await createIsolatedComponent("Retroactive arrival ordering component");
  const chronologyNow = Date.now();
  const fullDay = fullDayFixture(pageTimezone, chronologyNow);
  const chronologicalLaterPublication = localWallClockInstant(fullDay.daysAgo + 1, 12, 0, pageTimezone, chronologyNow);
  const chronologicalEarlierPublication = localWallClockInstant(fullDay.daysAgo + 2, 12, 0, pageTimezone, chronologyNow);
  const chronological = await createIncident("A current update survives a later-arriving historical update", { openedAt: chronologicalEarlierPublication, components: [{ componentId: chronologicalComponent.id, state: "Major outage", relationship: "Primary" }] });
  await saveDraft(chronological.id, { lifecycle: "Investigating" });
  const currentPublication = await publish(chronological.id, { publishedAt: chronologicalLaterPublication });
  await expectStatus(currentPublication, 200);
  const currentUpdate = (await currentPublication.json()).update;
  await saveDraft(chronological.id, { lifecycle: "Resolved", nextUpdateAt: chronologicalEarlierPublication });
  const historicalPublication = await publish(chronological.id, { publishedAt: chronologicalEarlierPublication });
  await expectStatus(historicalPublication, 200);
  assert.equal((await historicalPublication.json()).update.isRetroactive, true);
  const chronologicalView = await incidentView(chronological.id);
  assert.equal(chronologicalView.lifecycle, "Investigating");
  assert.equal(chronologicalView.resolvedAt, null);
  assert.equal(chronologicalView.updates[0]?.id, currentUpdate.id);
  assert.equal((await (await appFetch("/api/app/components")).json()).components.find((entry) => entry.id === chronologicalComponent.id)?.publicState, "Major outage");
  const chronologicalHistory = await eventually(
    async () => (await (await appFetch(`/api/app/components/${chronologicalComponent.id}/history`)).json()).history,
    (history) => history.some((entry) => entry.changedAt === chronologicalLaterPublication && entry.newState === "Major outage"),
    "newer same-incident state boundary",
  );
  assert.equal(chronologicalHistory.filter((entry) => entry.changedAt === chronologicalLaterPublication).at(-1)?.newState, "Major outage");
  const uninterruptedDate = fullDay.date;
  await publicArtifact("/", `${uninterruptedDate}: Downtime 1440 minutes (weighted)`, "same-incident replay preserves uptime after the newer boundary");

  const splitComponent = await createIsolatedComponent("Cross-midnight split component");
  const splitStart = localWallClockInstant(8, 23, 30, pageTimezone);
  const splitEnd = new Date(Date.parse(splitStart) + 60 * 60_000).toISOString();
  const splitIncident = await createIncident("Degraded interval crosses local midnight", { openedAt: splitStart, components: [{ componentId: splitComponent.id, state: "Degraded performance", relationship: "Primary" }] });
  await saveDraft(splitIncident.id, { lifecycle: "Investigating", nextUpdateAt: splitEnd });
  await expectStatus(await publish(splitIncident.id, { publishedAt: splitStart }), 200);
  await saveDraft(splitIncident.id, { lifecycle: "Resolved", nextUpdateAt: splitEnd });
  await expectStatus(await publish(splitIncident.id, { publishedAt: splitEnd }), 200);
  const splitStartDate = localDateKey(splitStart, pageTimezone);
  const splitEndDate = localDateKey(splitEnd, pageTimezone);
  assert.notEqual(splitStartDate, splitEndDate, "fixture interval crosses the page timezone's local midnight");
  const expectedSplitMark = (day) => componentDowntimeMark(splitComponent.name, day, 15);
  await publicArtifact("/", expectedSplitMark(splitStartDate), "first half of cross-midnight weighted uptime");
  await publicArtifact("/", expectedSplitMark(splitEndDate), "second half of cross-midnight weighted uptime");

  const opaqueComponent = await createIsolatedComponent("Opaque legacy state component");
  executeFixtureSql(`INSERT INTO component_state_history (id,component_id,previous_state,new_state,cause_type,cause_id,operator_id,changed_at,created_at,updated_at) VALUES ('01J00000000000000000000991','${opaqueComponent.id}','Operational','Partially unavailable','standing-claim',NULL,'01J00000000000000000000001','${historicalStart}','${historicalStart}','${historicalStart}')`);
  const opaqueIncident = await createIncident("Opaque historical claim", { openedAt: historicalStart, components: [{ componentId: opaqueComponent.id, state: "Degraded performance", relationship: "Primary" }] });
  await saveDraft(opaqueIncident.id, { lifecycle: "Investigating", nextUpdateAt: historicalEnd });
  const rejected = await publish(opaqueIncident.id, { publishedAt: historicalStart });
  assert.equal(rejected.status, 409);
  assert.match((await rejected.json()).error, /claim provenance/);
  assert.equal((await incidentView(opaqueIncident.id)).updates.length, 0);
})(t);
});



















test("INTAKE-001 INTAKE-002 INTAKE-003 INTAKE-004 INTAKE-005 — Authenticated monitor intake remains private and deduplicated", async t => {
  t.diagnostic("INTAKE-001 — only a current raw-body HMAC is accepted for an alert source");
  await (async () => {
  const source = await appFetch("/api/app/intake/sources", { method: "POST", body: JSON.stringify({ name: "Contract source", credentialKind: "hmac-sha256", signingSecret: "contract-secret", deduplicationPath: "$.alert.id", titlePath: "$.alert.title", statePath: "$.alert.state", recoveredValue: "recovered" }) });
  assert.equal(source.status, 201);
  const sourceId = (await source.json()).source.id;
  const rejected = await fetch(`${pageUrl}/api/intake/${sourceId}`, { method: "POST", headers: { "Content-Type": "application/json", "x-lamp-timestamp": new Date().toISOString(), "x-lamp-signature": "not-a-valid-signature" }, body: JSON.stringify({ alert: { id: "rejected", title: "Rejected", state: "firing" } }) });
  assert.equal(rejected.status, 401);
  const post = async (payload) => {
    const body = JSON.stringify(payload); const timestamp = new Date().toISOString();
    const signature = createHmac("sha256", "contract-secret").update(`${timestamp}.${body}`).digest("base64url");
    return fetch(`${pageUrl}/api/intake/${sourceId}`, { method: "POST", headers: { "Content-Type": "application/json", "x-lamp-timestamp": timestamp, "x-lamp-signature": signature }, body });
  };
  const firing = { alert: { id: "dedup-1", title: "Database alert", state: "firing" } };
  const first = await post(firing); assert.equal(first.status, 202); const accepted = await first.json();
  const replay = await post(firing); assert.equal(replay.status, 202); assert.equal((await replay.json()).incidentId, accepted.incidentId);
  const recovered = await post({ alert: { id: "dedup-1", title: "Database alert", state: "recovered" } }); assert.equal(recovered.status, 202);
  const incident = (await (await appFetch(`/api/app/incidents/${accepted.incidentId}`)).json()).incident;
  assert.equal(incident.lifecycle, "Investigating");
  assert.equal(incident.updates.length, 0);
})(t);
  t.diagnostic("INTAKE-002 — a valid alert creates only a private draft incident");
  await (async () => {
  const source = await createIntakeSource("Private alert source");
  const before = await (await fetch(`${pageUrl}/`)).text();
  const accepted = await signedIntake(source.id, "contract-intake-secret", { alert: { id: "private-alert", title: "PRIVATE-ALERT-NARRATIVE", state: "firing" } });
  await expectStatus(accepted, 202);
  const result = await accepted.json();
  const incident = await incidentView(result.incidentId);
  assert.equal(incident.updates.length, 0);
  assert.doesNotMatch(await (await fetch(`${pageUrl}/`)).text(), /PRIVATE-ALERT-NARRATIVE/);
  assert.equal(before.includes("PRIVATE-ALERT-NARRATIVE"), false);
})(t);
  t.diagnostic("INTAKE-003 — different alert deliveries with one unresolved key attach to exactly one draft incident");
  await (async () => {
  const source = await createIntakeSource("Deduplication source");
  const first = await signedIntake(source.id, "contract-intake-secret", { alert: { id: "same-key", title: "First title", state: "firing" } });
  await expectStatus(first, 202);
  const firstBody = await first.json();
  const second = await signedIntake(source.id, "contract-intake-secret", { alert: { id: "same-key", title: "Changed title", state: "firing" } });
  await expectStatus(second, 202);
  const secondBody = await second.json();
  assert.equal(secondBody.incidentId, firstBody.incidentId);
  assert.equal(secondBody.replayed, false);
})(t);
  t.diagnostic("INTAKE-004 — a recovery records receipt state without resolving or publishing its draft incident");
  await (async () => {
  const source = await createIntakeSource("Recovery source");
  const firing = await signedIntake(source.id, "contract-intake-secret", { alert: { id: "recover-key", title: "Recovery alert", state: "firing" } });
  await expectStatus(firing, 202);
  const incidentId = (await firing.json()).incidentId;
  const recovered = await signedIntake(source.id, "contract-intake-secret", { alert: { id: "recover-key", title: "Recovery alert", state: "recovered" } });
  await expectStatus(recovered, 202);
  const incident = await incidentView(incidentId);
  assert.equal(incident.lifecycle, "Investigating");
  assert.equal(incident.updates.length, 0);
})(t);
  t.diagnostic("INTAKE-005 — a payload missing the configured deduplication value is recorded as an invalid alert");
  await (async () => {
  const source = await createIntakeSource("Invalid mapping source", { deduplicationPath: "$.alert.requiredKey" });
  const response = await signedIntake(source.id, "contract-intake-secret", { alert: { title: "No key", state: "firing" } });
  await expectStatus(response, 400);
  const result = await response.json();
  assert.equal(result.incidentId, null);
  const replay = await signedIntake(source.id, "contract-intake-secret", { alert: { title: "No key", state: "firing" } });
  await expectStatus(replay, 400);
  assert.equal((await replay.json()).replayed, true);
})(t);
});









test("MAINT-002 MAINT-001 MAINT-003 MAINT-004 MAINT-005 MAINT-006 — Scheduled maintenance transitions, notices, extension and cancellation", async t => {
  t.diagnostic("MAINT-002 — the Worker scheduled event starts and completes a recorded maintenance without an operator mutation");
  await (async () => {
  const componentId = "01J00000000000000000000011";
  const end = new Date(Date.now() - 1_000).toISOString();
  const start = new Date(Date.now() - 2_000).toISOString();
  const created = await appFetch("/api/app/maintenance", { method: "POST", body: JSON.stringify({ title: "Automatic transition test", startsAt: start, endsAt: end, componentIds: [componentId] }) });
  if (created.status !== 201) throw new Error(await created.text());
  const maintenance = (await created.json()).maintenance;

  assert.equal((await fetch(`${pageUrl}/cdn-cgi/local/scheduled`)).status, 200);
  const eventually = async (predicate) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const records = (await (await appFetch("/api/app/maintenance")).json()).maintenance;
      const record = records.find((item) => item.id === maintenance.id);
      if (predicate(record)) return record;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  };
  assert.equal((await eventually((record) => record?.state === "In progress"))?.state, "In progress");
  assert.equal((await fetch(`${pageUrl}/cdn-cgi/local/scheduled`)).status, 200);
  assert.equal((await eventually((record) => record?.state === "Completed"))?.state, "Completed");
})(t);
  t.diagnostic("MAINT-001 — scheduled maintenance has its own SCH reference and operator list");
  await (async () => {
  const created = await appFetch("/api/app/maintenance", { method: "POST", body: JSON.stringify({ title: "Distinct maintenance", startsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(), endsAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(), componentIds: ["01J00000000000000000000011"] }) });
  await expectStatus(created, 201);
  const maintenance = (await created.json()).maintenance;
  assert.match(maintenance.reference, /^SCH-\d+$/);
  assert.equal((await (await appFetch("/api/app/maintenance")).json()).maintenance.some((record) => record.id === maintenance.id), true);
})(t);
  t.diagnostic("MAINT-003 — maintenance claims Under maintenance only while its recorded window is in progress");
  await (async () => {
  const component = await createIsolatedComponent("Maintenance component claim");
  const created = await appFetch("/api/app/maintenance", { method: "POST", body: JSON.stringify({ title: "Maintenance component claim", startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 60 * 60_000).toISOString(), componentIds: [component.id] }) });
  await expectStatus(created, 201);
  const maintenance = (await created.json()).maintenance;
  assert.equal((await (await appFetch("/api/app/components")).json()).components.find((item) => item.id === component.id).publicState, "Operational");
  await expectStatus(await fetch(`${pageUrl}/cdn-cgi/local/scheduled`), 200);
  await eventually(async () => (await (await appFetch("/api/app/maintenance")).json()).maintenance.find((record) => record.id === maintenance.id), (record) => record?.state === "In progress", "maintenance start");
  assert.equal((await (await appFetch("/api/app/components")).json()).components.find((item) => item.id === component.id).publicState, "Under maintenance");
  await expectStatus(await appFetch(`/api/app/maintenance/${maintenance.id}/complete`, { method: "POST" }), 200);
  await eventually(async () => (await (await appFetch("/api/app/components")).json()).components.find((item) => item.id === component.id), (item) => item?.publicState === "Operational", "manual maintenance completion");
  assert.equal(queryD1Sql(testStatePath, `SELECT COUNT(*) AS count FROM component_claim_events WHERE component_id = '${component.id}' AND cause_type = 'maintenance' AND cause_id = '${maintenance.id}' AND state IS NULL`)[0]?.count, 1);
  assert.equal(queryD1Sql(testStatePath, `SELECT COUNT(*) AS count FROM maintenance_notices WHERE maintenance_id = '${maintenance.id}' AND kind = 'completed'`)[0]?.count, 1);
  const secondCompletion = await appFetch(`/api/app/maintenance/${maintenance.id}/complete`, { method: "POST" });
  await expectStatus(secondCompletion, 409);
  assert.equal(queryD1Sql(testStatePath, `SELECT COUNT(*) AS count FROM component_claim_events WHERE component_id = '${component.id}' AND cause_type = 'maintenance' AND cause_id = '${maintenance.id}' AND state IS NULL`)[0]?.count, 1);
  assert.equal(queryD1Sql(testStatePath, `SELECT COUNT(*) AS count FROM maintenance_notices WHERE maintenance_id = '${maintenance.id}' AND kind = 'completed'`)[0]?.count, 1);
})(t);
  t.diagnostic("MAINT-003 — a stale maintenance transition cannot reuse an earlier notice guard");
  await (async () => {
  const createMaintenanceRepository = await loadMaintenanceRepositoryFactory();
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE maintenance (id TEXT PRIMARY KEY, state TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE maintenance_notices (id TEXT PRIMARY KEY, maintenance_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, published_at TEXT NOT NULL, author_operator_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE audit_entries (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, operator_id TEXT, reason TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO maintenance (id, state, starts_at, ends_at, completed_at, updated_at) VALUES ('maintenance-guard', 'Scheduled', '2026-09-08T00:00:00.000Z', '2026-09-08T00:30:00.000Z', NULL, '2026-09-08T00:00:00.000Z');
  `);
  const repository = createMaintenanceRepository(createTransactionalD1Fixture(database));
  const notice = { id: "notice-guard", maintenanceId: "maintenance-guard", kind: "started", body: "Started.", publishedAt: "2026-09-08T00:00:01.000Z", authorOperatorId: null, createdAt: "2026-09-08T00:00:01.000Z", updatedAt: "2026-09-08T00:00:01.000Z" };
  const dueWindow = { startsAt: "2026-09-08T00:00:00.000Z", endsAt: "2026-09-08T00:30:00.000Z" };
  assert.equal(await repository.transitionWithNotice("maintenance-guard", "Scheduled", "In progress", null, notice.publishedAt, notice, [], dueWindow), true);
  assert.equal(await repository.transitionWithNotice("maintenance-guard", "Scheduled", "In progress", null, notice.publishedAt, notice, [], dueWindow), false, "the same notice cannot be authorized by its earlier guard");
  const losingNotice = { ...notice, id: "notice-losing", createdAt: "2026-09-08T00:00:02.000Z", updatedAt: "2026-09-08T00:00:02.000Z" };
  assert.equal(await repository.transitionWithNotice("maintenance-guard", "Scheduled", "In progress", null, losingNotice.publishedAt, losingNotice, [], dueWindow), false, "a concurrent loser with a fresh notice cannot write a source event");
  database.prepare("UPDATE maintenance SET ends_at = ? WHERE id = ?").run("2026-09-08T01:00:00.000Z", "maintenance-guard");
  const staleCompletion = { ...notice, id: "notice-stale-completion", kind: "completed", publishedAt: "2026-09-08T00:00:03.000Z", createdAt: "2026-09-08T00:00:03.000Z", updatedAt: "2026-09-08T00:00:03.000Z" };
  assert.equal(await repository.transitionWithNotice("maintenance-guard", "In progress", "Completed", staleCompletion.publishedAt, staleCompletion.publishedAt, staleCompletion, [], dueWindow), false, "a due transition cannot complete a window extended after it was read");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM maintenance_notices").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_entries").get().count, 1);
  database.close();
})(t);
  t.diagnostic("MAINT-004 — an overrun is public after its recorded end, and operators can extend or complete it");
  await (async () => {
  const created = await appFetch("/api/app/maintenance", { method: "POST", body: JSON.stringify({ title: "Manual overrun completion", startsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(), endsAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(), componentIds: ["01J00000000000000000000011"] }) });
  await expectStatus(created, 201);
  const maintenance = (await created.json()).maintenance;
  executeFixtureSql(`UPDATE maintenance SET state = 'In progress', starts_at = '${new Date(Date.now() - 60 * 60_000).toISOString()}', ends_at = '${new Date(Date.now() - 16 * 60_000).toISOString()}' WHERE id = '${maintenance.id}'`);
  const overrunning = (await (await appFetch("/api/app/maintenance")).json()).maintenance.find((record) => record.id === maintenance.id);
  assert.equal(overrunning.overrunning, true);
  await expectStatus(await appFetch(`/api/app/maintenance/${maintenance.id}/complete`, { method: "POST" }), 200);
  assert.equal((await (await appFetch("/api/app/maintenance")).json()).maintenance.find((record) => record.id === maintenance.id).state, "Completed");

  const originalStart = new Date(Date.now() - 60 * 60_000).toISOString();
  const nearThresholdEnd = new Date(Date.now() - 14 * 60_000 - 40_000).toISOString();
  const extensionResponse = await appFetch("/api/app/maintenance", { method: "POST", body: JSON.stringify({ title: "Manual overrun extension", startsAt: originalStart, endsAt: nearThresholdEnd, componentIds: ["01J00000000000000000000011"] }) });
  await expectStatus(extensionResponse, 201);
  const extension = (await extensionResponse.json()).maintenance;
  const thresholdAt = Date.parse(nearThresholdEnd) + 15 * 60_000;
  await expectStatus(await fetch(`${pageUrl}/cdn-cgi/local/scheduled?cron=*+*+*+*+*`), 200);
  const started = (await (await appFetch("/api/app/maintenance")).json()).maintenance.find((record) => record.id === extension.id);
  assert.equal(started.state, "In progress");
  assert.equal(started.startsAt, extension.startsAt);
  assert.equal(started.endsAt, nearThresholdEnd);
  const beforeOverrun = await publicArtifact("/", `data-maintenance-state="In progress" data-maintenance-ends-at="${nearThresholdEnd}"`, "the started maintenance snapshot before the 15-minute overrun boundary");
  const generatedAt = Date.parse(beforeOverrun.response.headers.get("x-lamp-snapshot-generated-at"));
  assert.ok(generatedAt < thresholdAt, "the public artifact was generated before its overrun boundary");
  assert.doesNotMatch(beforeOverrun.text, /Running longer than planned/);
  const priorValidator = beforeOverrun.response.headers.get("etag");
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, thresholdAt - Date.now()) + 100));

  const agedPageResponse = await fetch(`${pageUrl}/`, { headers: priorValidator ? { "If-None-Match": priorValidator } : {} });
  assert.equal(agedPageResponse.status, 200, "the changed serving-time representation must not reuse the earlier validator");
  assert.notEqual(agedPageResponse.headers.get("etag"), priorValidator);
  const agedPage = await agedPageResponse.text();
  assert.match(agedPage, /Running longer than planned/);
  assert.ok(agedPage.includes(`data-maintenance-ends-at="${nearThresholdEnd}"`), "the public page keeps the recorded end beside the overrun message");
  const agedPermalink = await (await fetch(`${pageUrl}/maintenance/${extension.reference}`)).text();
  assert.match(agedPermalink, /Running longer than planned/);
  assert.ok(agedPermalink.includes(`data-maintenance-ends-at="${nearThresholdEnd}"`), "the permanent page keeps the recorded end beside the overrun message");
  assert.equal((await (await appFetch("/api/app/maintenance")).json()).maintenance.find((record) => record.id === extension.id).overrunning, true);

  const laterEnd = new Date(Date.now() + 60 * 60_000).toISOString();
  await expectStatus(await appFetch(`/api/app/maintenance/${extension.id}/window`, { method: "PUT", body: JSON.stringify({ startsAt: originalStart, endsAt: "not-a-date" }) }), 400);
  await expectStatus(await appFetch(`/api/app/maintenance/${extension.id}/window`, { method: "PUT", body: JSON.stringify({ startsAt: new Date(Date.parse(originalStart) + 60_000).toISOString(), endsAt: laterEnd }) }), 409);
  await expectStatus(await appFetch(`/api/app/maintenance/${extension.id}/window`, { method: "PUT", body: JSON.stringify({ startsAt: originalStart, endsAt: new Date(Date.parse(nearThresholdEnd) - 60_000).toISOString() }) }), 409);
  const extendedResponse = await appFetch(`/api/app/maintenance/${extension.id}/window`, { method: "PUT", body: JSON.stringify({ startsAt: originalStart, endsAt: laterEnd }) });
  await expectStatus(extendedResponse, 200);
  const extended = (await extendedResponse.json()).maintenance;
  assert.equal(extended.startsAt, originalStart);
  assert.equal(extended.endsAt, laterEnd);
  assert.equal(extended.overrunning, false);
  const extensionNotice = extended.notices.find((notice) => notice.kind === "rescheduled");
  assert.ok(extensionNotice, "extending the window publishes a rescheduled notice");
  const extensionAudit = queryD1Sql(testStatePath, `SELECT operator_id AS operatorId, created_at AS createdAt FROM audit_entries WHERE entity_type = 'maintenance' AND entity_id = '${extension.id}' AND action = 'notice-published' AND operator_id = '${maintenance.createdByOperatorId}'`);
  assert.equal(extensionAudit.length, 2, "scheduling and extending each retain one attributed audit entry");
  assert.ok(extensionAudit.every(entry => entry.operatorId === maintenance.createdByOperatorId));
  assert.deepEqual(extensionAudit.map(entry => entry.createdAt).sort(), [extended.notices.find(notice => notice.kind === "scheduled").createdAt, extensionNotice.createdAt].sort());
  const updatedPage = await publicArtifact("/", `data-maintenance-ends-at="${laterEnd}"`, "the extended maintenance snapshot");
  assert.doesNotMatch(updatedPage.text, /Running longer than planned/);
  const updatedPermalink = await publicArtifact(`/maintenance/${extension.reference}`, `data-maintenance-ends-at="${laterEnd}"`, "the extended maintenance permalink");
  assert.doesNotMatch(updatedPermalink.text, /Running longer than planned/);

  await expectStatus(await appFetch(`/api/app/maintenance/${extension.id}/complete`, { method: "POST" }), 200);
  const completedPermalink = await publicArtifact(`/maintenance/${extension.reference}`, "Completed", "the completed maintenance permalink");
  assert.doesNotMatch(completedPermalink.text, /Running longer than planned/);
  await expectStatus(await appFetch(`/api/app/maintenance/${extension.id}/window`, { method: "PUT", body: JSON.stringify({ startsAt: originalStart, endsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString() }) }), 409);

  const cancelledResponse = await appFetch("/api/app/maintenance", { method: "POST", body: JSON.stringify({ title: "Cancelled maintenance window", startsAt: new Date(Date.now() + 6 * 60 * 60_000).toISOString(), endsAt: new Date(Date.now() + 7 * 60 * 60_000).toISOString(), componentIds: ["01J00000000000000000000011"] }) });
  await expectStatus(cancelledResponse, 201);
  const cancelled = (await cancelledResponse.json()).maintenance;
  await expectStatus(await appFetch(`/api/app/maintenance/${cancelled.id}/cancel`, { method: "POST" }), 200);
  await expectStatus(await appFetch(`/api/app/maintenance/${cancelled.id}/window`, { method: "PUT", body: JSON.stringify({ startsAt: cancelled.startsAt, endsAt: new Date(Date.parse(cancelled.endsAt) + 60_000).toISOString() }) }), 409);
})(t);
  t.diagnostic("MAINT-005 — scheduled, reminder, start, and completion notices are immutable maintenance events");
  await (async () => {
  const created = await appFetch("/api/app/maintenance", { method: "POST", body: JSON.stringify({ title: "Reminder lifecycle", startsAt: new Date(Date.now() + 23 * 60 * 60_000).toISOString(), endsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(), componentIds: ["01J00000000000000000000011"] }) });
  await expectStatus(created, 201);
  const maintenance = (await created.json()).maintenance;
  assert.equal(maintenance.notices.some((notice) => notice.kind === "scheduled"), true);
  await expectStatus(await fetch(`${pageUrl}/cdn-cgi/local/scheduled`), 200);
  const withReminder = (await (await appFetch("/api/app/maintenance")).json()).maintenance.find((record) => record.id === maintenance.id);
  assert.equal(withReminder.notices.some((notice) => notice.kind === "reminder"), true);
})(t);
  t.diagnostic("MAINT-006 — rescheduling and cancellation create notices and retain a cancelled maintenance record");
  await (async () => {
  const created = await appFetch("/api/app/maintenance", { method: "POST", body: JSON.stringify({ title: "Reschedule and cancel", startsAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(), endsAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString(), componentIds: ["01J00000000000000000000011"] }) });
  await expectStatus(created, 201);
  const maintenance = (await created.json()).maintenance;
  await expectStatus(await appFetch(`/api/app/maintenance/${maintenance.id}/window`, { method: "PUT", body: JSON.stringify({ startsAt: new Date(Date.now() + 5 * 60 * 60_000).toISOString(), endsAt: new Date(Date.now() + 6 * 60 * 60_000).toISOString() }) }), 200);
  await expectStatus(await appFetch(`/api/app/maintenance/${maintenance.id}/cancel`, { method: "POST" }), 200);
  const cancelled = (await (await appFetch("/api/app/maintenance")).json()).maintenance.find((record) => record.id === maintenance.id);
  assert.equal(cancelled.state, "Cancelled");
  assert.equal(cancelled.notices.some((notice) => notice.kind === "rescheduled"), true);
  assert.equal(cancelled.notices.some((notice) => notice.kind === "cancelled"), true);
})(t);
});













test("DRAFT-003 AGENT-005 HIST-002 HIST-003 — Unavailable AI and post-incident reporting", async t => {
  t.diagnostic("DRAFT-003 — without a provider the suggestion route is unavailable while normal publication remains available");
  await (async () => {
  const status = await appFetch("/api/app/ai/status");
  await expectStatus(status, 200);
  assert.equal((await status.json()).configured, false);
  const incident = await createIncident("No provider publication");
  assert.equal((await appFetch(`/api/app/incidents/${incident.id}/ai-suggestion`, { method: "POST" })).status, 404);
  await saveDraft(incident.id);
  await expectStatus(await publish(incident.id), 200);
})(t);
  t.diagnostic("AGENT-005 HIST-002 — a resolved incident drafts from cited evidence, requires human cause and remediation, then publishes one immutable report");
  await (async () => {
  const componentId = "01J00000000000000000000011";
  const source = await createIntakeSource("Report evidence source");
  const accepted = await signedIntake(source.id, "contract-intake-secret", { alert: { id: "report-evidence", title: "Report contract incident\nPayment timeouts observed", state: "firing" } });
  await expectStatus(accepted, 202);
  const incident = await incidentView((await accepted.json()).incidentId);
  const endpoint = `/api/app/incidents/${incident.id}/report`;
  await expectStatus(await appFetch(`${endpoint}/draft`, { method: "POST" }), 409);
  assert.equal((await (await appFetch(endpoint)).json()).report, null, "an unresolved incident gets no report");
  await expectStatus(await appFetch(`/api/app/incidents/${incident.id}/components`, { method: "POST", body: JSON.stringify({ componentId, state: "Major outage", relationship: "Primary" }) }), 201);
  await saveDraft(incident.id, { details: "Published investigation evidence.\nRequests are being checked." });
  await expectStatus(await publish(incident.id), 200);
  await expectStatus(await appFetch(`/api/app/incidents/${incident.id}/internal-notes`, { method: "POST", body: JSON.stringify({ body: "PRIVATE REPORT NOTE — unconfirmed root cause" }) }), 201);
  await expectStatus(await signedIntake(source.id, "contract-intake-secret", { alert: { id: "report-evidence", title: "Payment timeouts recovered", state: "recovered" } }), 202);
  const resolvedDraft = { ...validDraft, lifecycle: "Resolved", nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() };
  await saveDraft(incident.id, resolvedDraft);
  await expectStatus(await publish(incident.id, { overrideReason: "Operator verified payment recovery; proceed before the monitor hold expires." }), 200);
  const brief = (await (await appFetch(`/api/app/incidents/${incident.id}/brief`)).json()).brief;
  const sources = [...brief.whatWeKnow.alerts, ...brief.whatWeKnow.updates];
  const references = new Set(sources.map((item) => item.ref));
  assert.ok(brief.whatWeKnow.alerts.length && brief.whatWeKnow.updates.length, "the draft uses alerts and published updates");
  const attempts = await Promise.all([appFetch(`${endpoint}/draft`, { method: "POST" }), appFetch(`${endpoint}/draft`, { method: "POST" })]);
  assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409], "concurrent drafting creates one private report without replacement");
  const { report: generated, review } = await attempts.find((response) => response.status === 200).json();
  assert.equal(generated.cause, ""); assert.equal(generated.remediation, ""); assert.equal(generated.publishedAt, null);
  assert.equal(review.cause.required, true); assert.equal(review.remediation.required, true);
  assert.ok(review.cause.prompt && review.remediation.prompt);
  assert.deepEqual(new Set(review.evidenceRefs), references);
  const citedRefs = generated.timeline.split("\n").map((line) => {
    const ref = line.match(/\[(A\d+|U\d+)\]$/)?.[1];
    assert.ok(ref && references.has(ref), `timeline line cites a real brief source: ${line}`);
    return ref;
  });
  assert.deepEqual(new Set(citedRefs), references, "every available alert and update is represented");
  assert.equal(citedRefs.length, sources.length, "source newlines cannot create uncited timeline lines");
  assert.ok(generated.summary.includes(brief.incident.openedAt));
  assert.ok(generated.summary.includes(brief.whatWeKnow.updates.at(-1).publishedAt));
  assert.doesNotMatch(JSON.stringify(generated), /PRIVATE REPORT NOTE/);
  for (const path of ["/", `/incidents/${incident.reference}`, "/feed.atom", "/api/public/status", "/api/v2/incidents.json"]) {
    const publicDraft = await fetch(`${pageUrl}${path}`);
    await expectStatus(publicDraft, 200);
    assert.equal((await publicDraft.text()).includes(generated.summary), false, `report draft stays private on ${path}`);
  }
  await expectStatus(await appFetch(`${endpoint}/publish`, { method: "POST", body: JSON.stringify({ channels: ["email"] }) }), 400);
  const { summary, timeline } = generated;
  await expectStatus(await appFetch(endpoint, { method: "PUT", body: JSON.stringify({ summary, timeline, cause: review.cause.prompt, remediation: review.remediation.prompt }) }), 200);
  await expectStatus(await appFetch(`${endpoint}/publish`, { method: "POST", body: JSON.stringify({ channels: [] }) }), 400);
  await expectStatus(await appFetch(endpoint, { method: "PUT", body: JSON.stringify({ summary, timeline, cause: "", remediation: "" }) }), 200);
  const report = { summary, timeline, cause: "A connection pool was exhausted.", remediation: "We raised the pool limit and added alerting." };
  await expectStatus(await appFetch(endpoint, { method: "PUT", body: JSON.stringify({ ...report, remediation: "" }) }), 200);
  await expectStatus(await appFetch(`${endpoint}/publish`, { method: "POST", body: JSON.stringify({ channels: [] }) }), 400);
  await expectStatus(await appFetch(endpoint, { method: "PUT", body: JSON.stringify(report) }), 200);
  await expectStatus(await appFetch(`${endpoint}/draft`, { method: "POST" }), 409);
  const saved = (await (await appFetch(endpoint)).json()).report;
  for (const field of Object.keys(report)) assert.equal(saved[field], report[field], "drafting cannot overwrite operator work");
  const published = await appFetch(`${endpoint}/publish`, { method: "POST", body: JSON.stringify({ channels: ["email"] }) });
  if (published.status !== 200) throw new Error(await published.text());
  const visible = await appFetch(endpoint);
  assert.equal((await visible.json()).report.publishedAt !== null, true);
  await expectStatus(await appFetch(`${endpoint}/draft`, { method: "POST" }), 409);
  await expectStatus(await appFetch(endpoint, { method: "PUT", body: JSON.stringify({ ...report, cause: "Changed after publication" }) }), 409);
  await expectStatus(await appFetch(`${endpoint}/publish`, { method: "POST", body: JSON.stringify({ channels: [] }) }), 409);
  const publicReport = await fetch(`${pageUrl}/incidents/${incident.reference}`);
  assert.equal(publicReport.status, 200);
  assert.match(await publicReport.text(), /connection pool was exhausted/i);
  const deleted = await createIncident("Deleted incident cannot draft report");
  await expectStatus(await appFetch(`/api/app/incidents/${deleted.id}`, { method: "DELETE", body: JSON.stringify({ reason: "Remove private fixture" }) }), 200);
  await expectStatus(await appFetch(`/api/app/incidents/${deleted.id}/report/draft`, { method: "POST" }), 404);

  const owingCreated = await appFetch("/api/app/incidents", { method: "POST", body: JSON.stringify({ title: "Past major incident", openedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(), components: [{ componentId, state: "Major outage", relationship: "Primary" }] }) });
  assert.equal(owingCreated.status, 201);
  const owingIncident = (await owingCreated.json()).incident;
  const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal((await appFetch(`/api/app/incidents/${owingIncident.id}/draft`, { method: "PUT", body: JSON.stringify({ ...resolvedDraft, nextUpdateAt: past }) })).status, 200);
  assert.equal((await appFetch(`/api/app/incidents/${owingIncident.id}/publish`, { method: "POST", body: JSON.stringify({ channels: [], publishedAt: past }) })).status, 200);
  const owing = await appFetch("/api/app/reports/owing");
  assert.equal((await owing.json()).incidentIds.includes(incident.id), false);
  assert.equal((await (await appFetch("/api/app/reports/owing")).json()).incidentIds.includes(owingIncident.id), true);
})(t);
  t.diagnostic("HIST-003 — a major incident remains report-due after seven days even if its current component claim is later lowered");
  await (async () => {
  const componentId = (await createIsolatedComponent("Historical major report component")).id;
  const incident = await createIncident("Historical major report due", { openedAt: new Date(Date.now() - 9 * 24 * 60 * 60_000).toISOString(), components: [{ componentId, state: "Major outage", relationship: "Primary" }] });
  const publishedAt = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
  await saveDraft(incident.id, { lifecycle: "Resolved", nextUpdateAt: publishedAt });
  await expectStatus(await publish(incident.id, { publishedAt }), 200);
  executeFixtureSql(`UPDATE incident_components SET state = 'Operational' WHERE incident_id = '${incident.id}'`);
  const owing = await appFetch("/api/app/reports/owing");
  await expectStatus(owing, 200);
  assert.equal((await owing.json()).incidentIds.includes(incident.id), true);
})(t);
});





test("PAGE-005 — Snapshot recovery retains complete immutable generations", async t => {
  t.diagnostic("PAGE-005 — a failed snapshot build labels the last artifact stale and a later cron reconciles both source and bookkeeping failures");
  await (async () => {
  const createPublicSnapshotService = await loadPublicSnapshotServiceFactory();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let eTag = 0;
  const objects = new Map();
  const put = (key, bytes, contentType) => objects.set(key, { bytes, contentType, eTag: String(++eTag) });
  put("snapshots/prior/page.html", encoder.encode("<main>Prior snapshot</main>").buffer, "text/html; charset=utf-8");
  put("snapshots/current.json", encoder.encode(JSON.stringify({ version: "prior", generatedAt: "2026-09-08T00:00:00.000Z", generation: 1, sourceRevision: 0 })).buffer, "application/json");
  const blobs = {
    getText: async (key) => {
      const object = objects.get(key);
      return object ? { text: decoder.decode(object.bytes), contentType: object.contentType, eTag: object.eTag } : null;
    },
    getBytes: async (key) => {
      const object = objects.get(key);
      return object ? { bytes: object.bytes, contentType: object.contentType, eTag: object.eTag } : null;
    },
    putText: async (key, text, contentType) => put(key, encoder.encode(text).buffer, contentType),
    putBytes: async (key, bytes, contentType) => put(key, bytes, contentType),
    putTextConditionally: async (key, text, contentType) => { put(key, encoder.encode(text).buffer, contentType); return true; },
  };
  const source = {
    settings: { id: "default", pageName: "Lamp test", tagline: "Snapshot contract", accentColor: "#16794C", timezone: "UTC", hostname: "status.example.test", footerCreditEnabled: false, logoKey: null, logoContentType: null, widgetAllowedOrigins: "[]", mailFromAddress: "lamp@example.test", aiToneInstructions: "", feedId: "feed-test", createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z" },
    components: [], claims: [], history: [], corrections: [], incidents: [], incidentComponents: [], updates: [], maintenance: [], maintenanceComponents: [], reports: [], maintenanceNotices: [],
  };
  const work = { requestedRevision: 1, completedRevision: 0 };
  let generation = 1;
  let sourceAvailable = false;
  let d1Available = true;
  const repository = {
    load: async () => sourceAvailable ? source : null,
    startBuild: async () => {}, finishBuild: async () => {}, latestBuild: async () => null,
    reserveGeneration: async () => ++generation,
    requestWork: async () => ++work.requestedRevision,
    currentWork: async () => { if (!d1Available) throw new Error("D1 temporarily unavailable"); return { ...work }; },
    completeWork: async (revision) => { work.completedRevision = Math.max(work.completedRevision, revision); },
    markInterruptedBuilds: async () => {},
    claimPendingWork: async () => work.requestedRevision > work.completedRevision,
    releaseWorkLease: async () => {},
  };
  const snapshots = createPublicSnapshotService(repository, blobs);
  await assert.rejects(() => snapshots.rebuild(), /Public snapshot build failed/);
  assert.equal((await snapshots.readArtifact("page.html"))?.stale, true);
  sourceAvailable = true;
  assert.equal(await snapshots.retryPendingBuild(), true);
  assert.equal((await snapshots.readArtifact("page.html"))?.stale, false);

  // A D1 bookkeeping fault with no new source change still marks the old
  // pointer stale. Once D1 recovers, retry creates a real durable revision
  // instead of leaving a synthetic marker forever.
  d1Available = false;
  await assert.rejects(() => snapshots.rebuild(), /D1 temporarily unavailable/);
  assert.equal((await snapshots.readArtifact("page.html"))?.stale, true);
  d1Available = true;
  assert.equal(await snapshots.retryPendingBuild(), true);
  assert.equal(work.completedRevision, work.requestedRevision);
  assert.equal((await snapshots.readArtifact("page.html"))?.stale, false);
})(t);
  t.diagnostic("PAGE-005 — a complete immutable R2 snapshot has every artifact and remains public without D1");
  await (async () => {
  const before = JSON.parse(r2Object("snapshots/current.json"));
  for (const key of ["page.html", "history.html", "feed.atom", "widget.js", "status.json", "assets/status-page.css", "assets/status-page.js", "assets/favicon.svg", "assets/og.svg"]) {
    assert.notEqual(r2Object(`snapshots/${before.version}/${key}`), "", `snapshot artifact ${key} is present before a rebuild failure`);
  }
  // Public routes read the immutable R2 pointer/artifacts only. Destroying
  // the test database after a complete build cannot alter their response.
  executeFixtureSql("DROP TABLE page_settings");
  for (const path of ["/", "/history", "/feed.atom", "/widget.js", "/api/public/status"]) {
    const response = await eventually(async () => { try { return await fetch(`${pageUrl}${path}?snapshot-only`); } catch { return null; } }, (candidate) => candidate?.status === 200, `${path} from R2 after D1 removal`);
    assert.equal(response.status, 200, `${path} remains available from R2 without D1`);
  }
})(t);
});
