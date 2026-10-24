import { catalogueHistoryFlow } from "./helpers/catalogue-history-flow.mjs";
import { widgetVariantsFlow } from "./helpers/widget-variants-flow.mjs";
import { publicResourcesFlow } from "./helpers/public-resources-flow.mjs";
import { publicFreshnessFlow } from "./helpers/public-freshness-flow.mjs";
import { requestHeaders } from "../helpers/request-headers.mjs";
import { assertResolvedDuration, assertVisibleTime } from "../helpers/public-meaning.mjs";
import { withDraftVersion } from "./draft-version-helper.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

import { insertRealOperatorSession } from "./real-session-helper.mjs";
// Wrangler CLI work between requests can outlast an idle keep-alive socket; every request opens its own connection.
import { fixtureFetch as fetch } from "../public-snapshots/fixture-fetch.mjs";
import { appOrigin, pageOrigin } from "./helpers/hosts.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";

let appUrl = "";
let pageUrl = "";
let testPort;
let server;
let sessionId;
let rendererVite;
let computeUptime;
let uptimeMarkup;
let renderPublicSnapshot;
let testStatePath;
let testViteCachePath;
let workerOutput = "";

async function appFetch(path, init = {}) {
  init = await withDraftVersion(path, init, appFetch);
  return fetch(`${appUrl}${path}`, {
    ...init,
    headers: requestHeaders({ Cookie: `${sessionCookieName(appUrl)}=${sessionId}`, "Content-Type": "application/json" }, init.headers),
  });
}

async function currentSettings() {
  const response = await appFetch("/api/app/page-settings");
  assert.equal(response.status, 200);
  return (await response.json()).settings;
}

async function updateSettings(patch) {
  const current = await currentSettings();
  const response = await appFetch("/api/app/page-settings", { method: "PUT", body: JSON.stringify({
    pageName: current.pageName,
    tagline: current.tagline,
    accentColor: current.accentColor,
    timezone: current.timezone,
    hostname: current.hostname,
    footerCreditEnabled: current.footerCreditEnabled,
    widgetAllowedOrigins: current.widgetAllowedOrigins,
    mailFromAddress: current.mailFromAddress,
    ...patch,
  }) });
  assert.equal(response.status, 200);
  return (await response.json()).settings;
}

async function uploadTestLogo() {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAF/gL+3N9nPwAAAABJRU5ErkJggg==", "base64");
  const form = new FormData();
  form.set("logo", new Blob([png], { type: "image/png" }), "lamp.png");
  const uploaded = await fetch(`${appUrl}/api/app/page-settings/logo`, { method: "POST", body: form, headers: { Origin: appUrl, Cookie: `${sessionCookieName(appUrl)}=${sessionId}`, Accept: "application/json" } });
  assert.equal(uploaded.status, 200);
}

function executeLocalSql(statement) {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", testStatePath, "--command", statement], { cwd: process.cwd(), stdio: "pipe" });
}

function queryLocalSql(statement) {
  const output = execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", testStatePath, "--command", statement, "--json"], { cwd: process.cwd(), encoding: "utf8" });
  return JSON.parse(output)[0]?.results ?? [];
}

function r2Object(key, input, contentType) {
  const action = input === undefined ? "get" : "put";
  const args = ["exec", "wrangler", "r2", "object", action, `lamp-local-snapshots/${key}`, "--local", "--persist-to", testStatePath, "--pipe"];
  if (input !== undefined && contentType) args.push("--content-type", contentType);
  return execFileSync("pnpm", args, { cwd: process.cwd(), encoding: "utf8", input });
}

function rendererSource(claims = []) {
  return {
    settings: { id: "default", pageName: "Renderer policy", tagline: "Renderer policy probe", accentColor: "#16794C", timezone: "UTC", hostname: "renderer.example.test", footerCreditEnabled: true, logoKey: null, logoContentType: null, widgetAllowedOrigins: "[]", mailFromAddress: "lamp@renderer.example.test", aiToneInstructions: "", feedId: "renderer-policy-feed", createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z" },
    components: [{ id: "renderer-policy-component", name: "Web application", description: "", note: "", groupId: null, groupName: null, groupOrder: null, displayOrder: 1 }],
    claims,
    history: [],
    corrections: [],
    incidents: [],
    incidentComponents: [],
    updates: [],
    maintenance: [],
    maintenanceComponents: [],
    reports: [],
    maintenanceNotices: [],
  };
}

async function svgPixels(path, width, height, points) {
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${pageUrl}/`);
    return await page.evaluate(async ({ url, width: canvasWidth, height: canvasHeight, points: samplePoints }) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      canvas.getContext("2d").drawImage(image, 0, 0, canvasWidth, canvasHeight);
      return samplePoints.map(({ x, y }) => [...canvas.getContext("2d").getImageData(x, y, 1, 1).data]);
    }, { url: `${pageUrl}${path}`, width, height, points });
  } finally {
    await browser.close();
  }
}

before(async () => {
  rendererVite = await createViteServer({ configFile: false, appType: "custom", server: { middlewareMode: true, hmr: false } });
  ({ computeUptime, uptimeMarkup } = await rendererVite.ssrLoadModule("/src/core/features/public-snapshot/uptime.ts"));
  ({ renderPublicSnapshot } = await rendererVite.ssrLoadModule("/src/core/features/public-snapshot/renderer.ts"));
  testStatePath = await mkdtemp(join(tmpdir(), "lamp-public-d1-"));
  testViteCachePath = await mkdtemp(join(tmpdir(), "lamp-public-vite-"));
  testPort = await reservePort({ label: "public contract Worker" });
  // Native sign-in renders its email form only when mail is configured. This
  // presentation-only fixture never submits it or publishes to recipients.
  appUrl = appOrigin(testPort, { MAIL_PROVIDER_API_KEY: "test-only-signin-presentation-no-delivery" });
  pageUrl = pageOrigin(testPort);
  execFileSync("pnpm", ["run", "migrate:local"], { cwd: process.cwd(), stdio: "pipe", env: { ...process.env, LAMP_WORKERS_STATE_PATH: testStatePath } });
  sessionId = await insertRealOperatorSession({ persistTo: testStatePath, pageSettings: false });
  executeLocalSql(`INSERT INTO page_settings (id,page_name,tagline,accent_color,timezone,hostname,footer_credit_enabled,logo_key,logo_content_type,widget_allowed_origins,mail_from_address,ai_tone_instructions,feed_id,created_at,updated_at) VALUES ('default','Atlas Cloud Status','Current availability and incident communications for Atlas Cloud.','#16794C','America/Los_Angeles','status.atlascloud.example',1,NULL,NULL,'[]','lamp@localhost.invalid','','test-feed-identity-00000000000001','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z'); INSERT INTO component_groups (id,name,display_order,created_at,updated_at) VALUES ('01J00000000000000000000002','Core services',1,'2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z'),('01J00000000000000000000003','Capacity test services',2,'2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z'); INSERT INTO components (id,group_id,name,description,internal,display_order,note,created_at,updated_at) VALUES ('01J00000000000000000000010','01J00000000000000000000002','Web application','Customer-facing web service.',0,1,'','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z'),('01J00000000000000000000020','01J00000000000000000000002','API gateway','Customer API edge.',0,2,'','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z'),('01J00000000000000000000021','01J00000000000000000000002','Customer portal','Customer portal.',0,3,'','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z'),('01J00000000000000000000022','01J00000000000000000000002','Background jobs','Asynchronous job execution.',0,4,'','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z'),('01J00000000000000000000023','01J00000000000000000000002','Account services','Account management.',0,5,'','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z'),('01J00000000000000000000024','01J00000000000000000000002','Data export','Customer data export.',0,6,'','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z'); INSERT INTO component_standing_claims (id,component_id,state,operator_id,created_at,updated_at) VALUES ('01J00000000000000000000011','01J00000000000000000000010','Operational','01J00000000000000000000001','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z'); INSERT INTO component_state_history (id,component_id,previous_state,new_state,cause_type,cause_id,operator_id,changed_at,created_at,updated_at) VALUES ('01J00000000000000000000012','01J00000000000000000000010','Operational','Operational','standing-claim','01J00000000000000000000011','01J00000000000000000000001','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z')`);
  r2Object("snapshots/test-fixture/page.html", "<!doctype html><html><head><title>Atlas Cloud Status</title></head><body><main>Atlas Cloud Status</main></body></html>", "text/html; charset=utf-8");
  r2Object("snapshots/current.json", JSON.stringify({ version: "test-fixture", generatedAt: "2026-09-08T00:00:00.000Z", generation: 0, sourceRevision: 0 }));
  server = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(testPort), "--strictPort"], {
    cwd: process.cwd(),
    stdio: "pipe",
    detached: true,
    // appOrigin supplies an isolated config with the same D1/R2 bindings.
    env: { ...process.env, LAMP_DISABLE_INSPECTOR: "true", LAMP_WORKERS_STATE_PATH: testStatePath, LAMP_VITE_CACHE_DIR: testViteCachePath },
  });
  server.stdout.on("data", (chunk) => { workerOutput += String(chunk); });
  server.stderr.on("data", (chunk) => { workerOutput += String(chunk); });
  await waitForWorker({
    child: server,
    output: () => workerOutput,
    label: "public contract Worker",
    probe: async ({ signal }) => {
      const response = await fetch(`${pageUrl}/`, { signal });
      const text = await response.text();
      const ready = response.status === 200 && /Atlas Cloud Status/.test(text);
      return { status: ready ? 200 : response.status === 200 ? 503 : response.status, text: () => text };
    },
  });
  sessionId = await insertRealOperatorSession({ persistTo: testStatePath });
});

after(async () => {
  if (server?.pid && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* process already ended */ }
    await stopped;
  }
  await rendererVite?.close();
  await Promise.all([rm(testStatePath, { recursive: true, force: true }), rm(testViteCachePath, { recursive: true, force: true })]);
});

test("PAGE-007 COMP-002 PAGE-002 — Public generation refresh, ordering and script-free status", async t => {
  await catalogueHistoryFlow({ appFetch, fetch, pageUrl, queryLocalSql, executeLocalSql, updateSettings, diagnostic: text => t.diagnostic(text) });
  t.diagnostic("PAGE-007 warmed browser and proxy follow publication generations and retain origin outages");
  await (async (t) => {
  await publicFreshnessFlow({ appFetch, appUrl, pageUrl, diagnostic: text => t.diagnostic(text) });
})(t);
  t.diagnostic("COMP-002 — operator component ordering and internal visibility rebuild the public snapshot");
  await (async () => {
  const groupResponse = await appFetch("/api/app/component-groups", { method: "POST", body: JSON.stringify({ name: "First ordered group", displayOrder: 0 }) });
  assert.equal(groupResponse.status, 201);
  const group = (await groupResponse.json()).group;
  const first = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({
    groupId: group.id, name: "First in group", description: "Display order one.", internal: false, displayOrder: 1, note: "",
  }) });
  const second = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({
    groupId: group.id, name: "Second in group", description: "Display order two.", internal: false, displayOrder: 2, note: "",
  }) });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const created = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({
    groupId: "01J00000000000000000000002", name: "Private edge probe", description: "Must never be public.", internal: true, displayOrder: 99, note: "",
  }) });
  assert.equal(created.status, 201);
  const privateComponent = (await created.json()).component;
  const page = await (await fetch(`${pageUrl}/`)).text();
  assert.doesNotMatch(page, /Private edge probe/);
  assert.ok(page.indexOf("<h3>First ordered group</h3>") < page.indexOf("<h3>Core services</h3>"), "group display order controls public group order");
  assert.ok(page.indexOf("First in group") < page.indexOf("Second in group"), "component display order controls public component order");
  assert.equal((await appFetch(`/api/app/components/${privateComponent.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await appFetch(`/api/app/components/${(await first.json()).component.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await appFetch(`/api/app/components/${(await second.json()).component.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await appFetch(`/api/app/component-groups/${group.id}`, { method: "DELETE" })).status, 204);
})(t);
  t.diagnostic("component group order swaps an occupied persisted position without a constraint failure");
  await (async () => {
  const coreServices = "01J00000000000000000000002";
  const moved = await appFetch(`/api/app/component-groups/${coreServices}`, { method: "PUT", body: JSON.stringify({ name: "Core services", displayOrder: 2 }) });
  assert.equal(moved.status, 204);
  const afterMove = await (await appFetch("/api/app/components")).json();
  assert.deepEqual(afterMove.groups.slice(0, 2).map((group) => [group.name, group.displayOrder]), [["Capacity test services", 1], ["Core services", 2]]);

  const restored = await appFetch(`/api/app/component-groups/${coreServices}`, { method: "PUT", body: JSON.stringify({ name: "Core services", displayOrder: 1 }) });
  assert.equal(restored.status, 204);
  const afterRestore = await (await appFetch("/api/app/components")).json();
  assert.deepEqual(afterRestore.groups.slice(0, 2).map((group) => [group.name, group.displayOrder]), [["Core services", 1], ["Capacity test services", 2]]);
})(t);
  t.diagnostic("PAGE-002 — the initial HTML contains status content, timestamps, and a working plain form");
  await (async () => {
  const response = await fetch(`${pageUrl}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<h1 id="overall-status" data-overall>Operational<\/h1>/);
  assert.match(html, /<h4>Web application<\/h4>/);
  assert.match(html, /<time datetime="[^"]+" data-local-time>/);
  assert.match(html, /<form method="post" action="\/subscribe">/);
  assert.match(html, /<input id="email" name="email" type="email"/);
})(t);
  t.diagnostic("public root keeps current incident and planned maintenance facts in the timeline without duplicate summary cards");
  await (() => {
  const source = rendererSource([{ componentId: "renderer-policy-component", state: "Degraded performance" }]);
  source.incidents = [{ id: "timeline-incident", reference: "INC-710", title: "Timeline incident", lifecycle: "Investigating", openedAt: "2026-09-08T00:00:00.000Z", resolvedAt: null }];
  source.incidentComponents = [{ id: "timeline-incident-component", incidentId: "timeline-incident", componentId: "renderer-policy-component", componentName: "Web application", state: "Degraded performance", relationship: "Primary", publishedAt: "2026-09-08T00:00:00.000Z" }];
  source.updates = [{ id: "timeline-update", incidentId: "timeline-incident", lifecycle: "Identified", affectedAudience: "Timeline readers", customerImpact: "Requests are delayed.", whatStillWorks: "The dashboard remains available.", details: "The team is investigating.", nextUpdateAt: "2026-09-08T01:00:00.000Z", publishedAt: "2026-09-08T00:00:00.000Z" }];
  source.maintenance = [{ id: "timeline-maintenance", reference: "SCH-710", title: "Timeline maintenance", state: "Scheduled", startsAt: "2026-09-09T00:00:00.000Z", endsAt: "2026-09-09T01:00:00.000Z", completedAt: null }];
  source.maintenanceComponents = [{ id: "timeline-maintenance-component", maintenanceId: "timeline-maintenance", componentId: "renderer-policy-component", componentName: "Web application", state: "Under maintenance" }];
  source.maintenanceNotices = [{ id: "timeline-notice", maintenanceId: "timeline-maintenance", kind: "scheduled", body: "Timeline maintenance is scheduled.", publishedAt: "2026-09-08T00:00:00.000Z" }];

  const page = renderPublicSnapshot(source, "2026-09-08T00:00:00.000Z").artifacts.find((artifact) => artifact.key === "page.html")?.body ?? "";
  assert.doesNotMatch(page, /class="service-details"/, "the removed top summary row cannot return as hidden duplicate markup");
  assert.equal([...page.matchAll(/<article class="component">/g)].length, 1, "the public component row appears once");
  // Read complete divs from the real renderer output, including all nested divs.
  function divMarkup(html, className) {
    const start = html.indexOf(`<div class="${className}">`);
    assert.ok(start >= 0, `rendered ${className} div exists`);
    const tags = /<\/?div\b[^>]*>/g;
    tags.lastIndex = start;
    let depth = 0;
    for (let tag; (tag = tags.exec(html));) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      if (depth === 0) return html.slice(start, tags.lastIndex);
    }
    assert.fail(`rendered ${className} div is complete`);
  }
  const ungrouped = divMarkup(page, "component-group");
  assert.doesNotMatch(ungrouped, /<h[1-3]\b/);
  assert.doesNotMatch(page, /class="status-overview-service"/, "the status banner does not duplicate component cards");
  assert.match(page, /class="status-utilities"/, "the retained history, subscription, and Atom controls have a compact utility nav");
  assert.match(page, /class="history-timeline"/, "the chronology remains on the public root");
  for (const fact of ["Current incident", "Timeline incident", "INC-710", "Timeline readers", "Requests are delayed.", "The dashboard remains available.", "The team is investigating.", "2026-09-08T01:00:00.000Z", "Planned maintenance", "Timeline maintenance", "SCH-710", "Timeline maintenance is scheduled."]) assert.match(page, new RegExp(fact), `${fact} remains in the timeline`);
})(t);
});









test("COMP-001 COMP-004 COMP-005 COMP-007 PAGE-004 — Component states, private components, bounded notes and deletion", async t => {
  t.diagnostic("COMP-001 — the public component state order is complete and deterministic");
  await (async () => {
  const { COMPONENT_STATES, mostSevereState } = await rendererVite.ssrLoadModule("/src/core/shared/domain.ts");
  assert.deepEqual(COMPONENT_STATES, ["Operational", "Degraded performance", "Partially unavailable", "Major outage", "Under maintenance"]);
  assert.equal(mostSevereState(["Operational", "Under maintenance", "Degraded performance"]), "Degraded performance");
  assert.equal(mostSevereState(["Partially unavailable", "Major outage"]), "Major outage");
})(t);
  t.diagnostic("COMP-004 — an exact 250-character state note is public and a longer note is rejected");
  await (async () => {
  const note = "N".repeat(250);
  const created = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({ groupId: "01J00000000000000000000002", name: "Note limit probe", description: "", internal: false, displayOrder: 90, note }) });
  assert.equal(created.status, 201);
  const component = (await created.json()).component;
  assert.match(await (await fetch(`${pageUrl}/`)).text(), new RegExp(note));
  const tooLong = await appFetch(`/api/app/components/${component.id}`, { method: "PUT", body: JSON.stringify({ groupId: "01J00000000000000000000002", name: "Note limit probe", description: "", internal: false, displayOrder: 90, note: `${note}X` }) });
  assert.equal(tooLong.status, 400);
  assert.equal((await appFetch(`/api/app/components/${component.id}`, { method: "DELETE" })).status, 204);
})(t);
  t.diagnostic("COMP-005 — an internal component, and any record only it covers, leaks through none of the public snapshot artifacts, also once either deletion door removes it");
  await (async () => {
  const created = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({ groupId: "01J00000000000000000000002", name: "Private artifact probe", description: "", internal: true, displayOrder: 91, note: "not public" }) });
  assert.equal(created.status, 201);
  const component = (await created.json()).component;
  const [page, feed, widget] = await Promise.all([fetch(`${pageUrl}/`), fetch(`${pageUrl}/feed.atom`), fetch(`${pageUrl}/widget.js`)]);
  for (const artifact of await Promise.all([page.text(), feed.text(), widget.text()])) assert.doesNotMatch(artifact, /Private artifact probe|not public/);
  assert.equal((await appFetch(`/api/app/components/${component.id}`, { method: "DELETE" })).status, 204);
  // Deletion keeps attachment names for published history (COMP-007); a deleted
  // internal component and the records only it covered still stay private.
  const groupId = "01J00000000000000000000002", operator = "01J00000000000000000000001";
  const at = hoursAgo => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  const [opened, resolved, starts, ends] = [at(6), at(5), at(4), at(3)];
  const createComponent = async (name, internal) => {
    const response = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({ groupId, name, description: "", internal, displayOrder: 93, note: "" }) });
    assert.equal(response.status, 201);
    return (await response.json()).component;
  };
  const deleteThrough = {
    single: async id => assert.equal((await appFetch(`/api/app/components/${id}`, { method: "DELETE" })).status, 204),
    catalogue: async id => {
      const current = await (await appFetch("/api/app/components/bulk")).json();
      const catalogue = { ...current.catalogue, components: current.catalogue.components.filter(item => item.id !== id) };
      const review = await (await appFetch("/api/app/components/bulk/preview", { method: "POST", body: JSON.stringify({ catalogue, revision: current.revision }) })).json();
      assert.equal((await appFetch("/api/app/components/bulk/apply", { method: "POST", body: JSON.stringify({ catalogue: review.catalogue, revision: review.revision, reviewToken: review.reviewToken }) })).status, 200);
    },
  };
  const doors = Object.keys(deleteThrough);
  const shared = await createComponent("Retained public probe", false);
  const hidden = {};
  try {
    for (const [index, door] of doors.entries()) {
      hidden[door] = await createComponent(`Private ${door} probe`, true);
      const link = (id, incident, attached) => `('${door}-${id}','${door}-${incident}','${attached.id}','${attached.name}','Major outage','Primary','${opened}','${opened}','${opened}')`;
      const update = incident => `('${door}-${incident}-update','${door}-${incident}','Resolved','${incident} ${door} readers','${incident} ${door} wording','','','${resolved}','${resolved}','${operator}','${resolved}','${resolved}')`;
      executeLocalSql(`INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,created_at,updated_at) VALUES ('${door}-Private','INC-772${index}','Private ${door} incident','Resolved','${opened}','${resolved}','${operator}','${opened}','${resolved}'),('${door}-Mixed','INC-773${index}','Mixed ${door} incident','Resolved','${opened}','${resolved}','${operator}','${opened}','${resolved}'); INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES ${update("Private")},${update("Mixed")}; INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at) VALUES ${link("private-link", "Private", hidden[door])},${link("mixed-private-link", "Mixed", hidden[door])},${link("mixed-public-link", "Mixed", shared)}; INSERT INTO maintenance (id,reference,title,state,starts_at,ends_at,completed_at,created_by_operator_id,created_at,updated_at) VALUES ('${door}-window','SCH-772${index}','Private ${door} window','Completed','${starts}','${ends}','${ends}','${operator}','${starts}','${ends}'); INSERT INTO maintenance_components (id,maintenance_id,component_id,component_name,state,created_at,updated_at) VALUES ('${door}-window-link','${door}-window','${hidden[door].id}','${hidden[door].name}','Under maintenance','${starts}','${starts}')`);
    }
    // An unchanged save republishes the snapshot with the records above.
    assert.equal((await appFetch(`/api/app/components/${shared.id}`, { method: "PUT", body: JSON.stringify({ groupId, name: shared.name, description: "", internal: false, displayOrder: 93, note: "" }) })).status, 200);
    const surfaces = ["/", "/history", "/feed.atom", "/feed.rss", "/history.atom", "/history.rss", "/widget.js", "/embed/script.js", "/api/public/status", "/api/v2/summary.json", "/api/v2/incidents.json", "/api/v2/scheduled-maintenances.json", "/api/public/v1/incidents", "/api/public/v1/maintenance",
      ...doors.flatMap((door, index) => [`/incidents/INC-772${index}`, `/incidents/INC-773${index}`, `/maintenance/SCH-772${index}`])];
    const assertPublicSurfaces = async stage => {
      for (const path of surfaces) assert.doesNotMatch(await (await fetch(`${pageUrl}${path}`)).text(), /Private (?:single|catalogue) (?:probe|incident|window|readers|wording)/, `${stage}: ${path}`);
      const history = await (await fetch(`${pageUrl}/history`)).text();
      for (const door of doors) assert.match(history, new RegExp(`Mixed ${door} incident`), `${stage}: the public record stays in history`);
      assert.match(history, /affected Retained public probe/, `${stage}: the public component stays named`);
    };
    await assertPublicSurfaces("while the private components exist");
    for (const door of doors) await deleteThrough[door](hidden[door].id);
    await assertPublicSurfaces("after the private components are deleted");
  } finally {
    executeLocalSql(`DELETE FROM incidents WHERE id IN (${doors.flatMap(door => [`'${door}-Private'`, `'${door}-Mixed'`]).join(",")}); DELETE FROM maintenance WHERE id IN (${doors.map(door => `'${door}-window'`).join(",")})`);
    for (const { id } of [...Object.values(hidden), shared]) await appFetch(`/api/app/components/${id}`, { method: "DELETE" });
  }
})(t);
  t.diagnostic("COMP-007 — deleting a component removes its uptime but preserves its name in published history");
  await (async () => {
  const created = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({ groupId: "01J00000000000000000000002", name: "Deletion retention probe", description: "", internal: false, displayOrder: 92, note: "" }) });
  assert.equal(created.status, 201);
  const component = (await created.json()).component;
  executeLocalSql(`INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,created_at,updated_at) VALUES ('component-delete-incident','INC-7711','Deletion retention incident','Resolved','2026-09-01T00:00:00.000Z','2026-09-01T01:00:00.000Z','01J00000000000000000000001','2026-09-01T00:00:00.000Z','2026-09-01T01:00:00.000Z'); INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at) VALUES ('component-delete-link','component-delete-incident','${component.id}','Deletion retention probe','Major outage','Primary','2026-09-01T01:00:00.000Z','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z'); INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES ('component-delete-update','component-delete-incident','Resolved','Readers','Recovered','','','2026-09-01T01:00:00.000Z','2026-09-01T01:00:00.000Z','01J00000000000000000000001','2026-09-01T01:00:00.000Z','2026-09-01T01:00:00.000Z')`);
  assert.equal((await appFetch(`/api/app/components/${component.id}`, { method: "DELETE" })).status, 204);
  const history = await (await fetch(`${pageUrl}/history`)).text();
  assert.match(history, /Deletion retention probe/);
  assert.equal(queryLocalSql(`SELECT component_id AS componentId FROM incident_components WHERE id = 'component-delete-link'`)[0]?.componentId, null);
  assert.deepEqual(queryLocalSql(`SELECT id FROM component_state_history WHERE component_id = '${component.id}'`), []);
})(t);
  t.diagnostic("PAGE-004 — the overall rollup policy cannot redefine an individual component state");
  await (async () => {
  const policies = {
    pageStatusRollup: () => "Operational",
    uptimeDowntimeWeight: (state) => state === "Major outage" ? 1 : state === "Degraded performance" ? 0.5 : 0,
  };
  const rendered = renderPublicSnapshot(rendererSource([{ componentId: "renderer-policy-component", state: "Major outage" }]), "2026-09-08T01:00:00.000Z", policies);
  const page = rendered.artifacts.find((artifact) => artifact.key === "page.html")?.body ?? "";
  assert.match(page, /<h1 id="overall-status" data-overall>Operational<\/h1>/, "the configured rollup applies only to the overall label");
  assert.match(page, /<h4>Web application<\/h4>[\s\S]*?<strong>Major outage<\/strong>/, "the component remains derived by COMP-006 severity");
})(t);
});









test("UPTIME-005 UPTIME-004 COMP-003 UPTIME-001 UPTIME-002 UPTIME-003 — Audited uptime corrections, history, weighting and coverage", async t => {
  t.diagnostic("UPTIME-005 — the stated uptime method is rendered from the selected downtime policy");
  await (async () => {
  const rendered = renderPublicSnapshot(rendererSource(), "2026-09-08T01:00:00.000Z", {
    pageStatusRollup: (states) => states[0] ?? "Operational",
    uptimeDowntimeWeight: (state) => state === "Under maintenance" ? 0.25 : 0,
  });
  const page = rendered.artifacts.find((artifact) => artifact.key === "page.html")?.body ?? "";
  assert.match(page, /Major outage counts as 0 downtime minutes/);
  assert.match(page, /Under maintenance counts as 0\.25 downtime minutes/);
  assert.doesNotMatch(page, /counts as half/, "default copy must not contradict a buyer policy override");
})(t);
  t.diagnostic("UPTIME-004 — a reasoned closed correction is append-only, audited, and rebuilds the figure");
  await (async () => {
  const end = new Date(Date.now() - 60 * 60 * 1000);
  const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
  const corrected = await appFetch("/api/app/components/01J00000000000000000000010/history-corrections", { method: "POST", body: JSON.stringify({
    state: "Major outage", startsAt: start.toISOString(), endsAt: end.toISOString(), reason: "Verified edge logs showed a short outage.",
  }) });
  assert.equal(corrected.status, 204);
  const missingReason = await appFetch("/api/app/components/01J00000000000000000000010/history-corrections", { method: "POST", body: JSON.stringify({ state: "Major outage", startsAt: start.toISOString(), endsAt: end.toISOString(), reason: "" }) });
  assert.equal(missingReason.status, 400);
  const corrections = queryLocalSql(`SELECT state, starts_at AS startsAt, ends_at AS endsAt, reason, operator_id AS operatorId FROM component_state_corrections WHERE component_id = '01J00000000000000000000010' ORDER BY created_at DESC LIMIT 1`);
  assert.deepEqual(corrections, [{ state: "Major outage", startsAt: start.toISOString(), endsAt: end.toISOString(), reason: "Verified edge logs showed a short outage.", operatorId: "01J00000000000000000000001" }]);
  const history = queryLocalSql(`SELECT id, cause_type AS causeType, changed_at AS changedAt FROM component_state_history WHERE component_id = '01J00000000000000000000010' ORDER BY changed_at`);
  assert.ok(history.some((entry) => entry.id === "01J00000000000000000000012"), "the prior immutable state history remains");
  assert.ok(history.some((entry) => entry.causeType === "correction" && entry.changedAt === start.toISOString()), "the correction appends its own state-history fact");
  const audit = queryLocalSql(`SELECT action, operator_id AS operatorId, reason, payload_json AS payloadJson FROM audit_entries WHERE entity_type = 'component-state-history' ORDER BY created_at DESC LIMIT 1`)[0];
  assert.equal(audit.action, "corrected");
  assert.equal(audit.operatorId, "01J00000000000000000000001");
  assert.equal(audit.reason, "Verified edge logs showed a short outage.");
  assert.deepEqual(JSON.parse(audit.payloadJson), { componentId: "01J00000000000000000000010", state: "Major outage", startsAt: start.toISOString(), endsAt: end.toISOString(), reason: "Verified edge logs showed a short outage." });
  const page = await (await fetch(`${pageUrl}/`)).text();
  assert.match(page, /90-day uptime record/);
  const generatedAt = /Updated <time datetime="([^"]+)"/.exec(page)?.[1];
  assert.ok(generatedAt);
  const coverageStart = Math.min(new Date("2026-09-08T00:00:00.000Z").getTime(), start.getTime());
  const coverageMinutes = (new Date(generatedAt).getTime() - coverageStart) / 60_000;
  const expected = (Math.floor((100 - ((end.getTime() - start.getTime()) / 60_000) / coverageMinutes * 100) * 100) / 100).toFixed(2);
  assert.match(page, new RegExp(`<span class="uptime-number">${expected}%`), "the rebuilt public page shows the weighted correction in its numeric uptime");
})(t);
  t.diagnostic("UPTIME-004 — the trailing window includes its first partial day, weights downtime, handles DST, and labels short coverage");
  await (() => {
  const policies = { uptimeDowntimeWeight: (state) => state === "Major outage" ? 1 : state === "Degraded performance" ? 0.5 : 0 };
  const componentId = "uptime-window-component";
  const now = Date.parse("2026-11-02T20:00:00.000Z");
  const windowStart = now - 90 * 86_400_000;
  const source = {
    history: [
      { componentId, causeType: "standing-claim", changedAt: new Date(windowStart).toISOString(), createdAt: new Date(windowStart).toISOString(), newState: "Operational" },
    ],
    corrections: [
      { componentId, state: "Degraded performance", startsAt: "2026-11-01T08:30:00.000Z", endsAt: "2026-11-01T09:30:00.000Z", createdAt: "2026-11-01T10:00:00.000Z" },
    ],
  };
  const uptime = computeUptime(source, componentId, now, "America/Los_Angeles", policies);
  assert.equal(uptime.coverageDays, 90);
  assert.equal(uptime.percentage, "99.97%");
  assert.equal(uptime.marks.find(mark => mark.day === "2026-11-01").worstDowntimeState, "Degraded performance");
  assert.match(uptimeMarkup({ name: "API", uptime }, "America/Los_Angeles", new Date(now).toISOString()), /uptime-mark downtime"/);
  assert.equal(uptime.marks.find((mark) => mark.day === "2026-11-01")?.downtimeMinutes, 30, "the 25-hour DST day receives weighted downtime by elapsed minutes");
  const shortSource = { history: [{ componentId, causeType: "standing-claim", changedAt: new Date(now - 2 * 60 * 60_000).toISOString(), createdAt: new Date(now - 2 * 60 * 60_000).toISOString(), newState: "Operational" }], corrections: [] };
  const short = computeUptime(shortSource, componentId, now, "UTC", policies);
  assert.equal(short.coverageDays, 0);
  const shortMarkup = uptimeMarkup({ name: "API", uptime: short }, "UTC", new Date(now).toISOString());
  assert.match(shortMarkup, /100.00% over 2 hours/);
  assert.doesNotMatch(shortMarkup, /<time|Tracking since/);
  const newborn = computeUptime({ history: [{ ...shortSource.history[0], changedAt: new Date(now).toISOString() }], corrections: [] }, componentId, now, "UTC", policies);
  assert.equal(newborn.percentage, null, "zero elapsed time has no measured percentage");
  assert.equal(newborn.trackingSince, new Date(now).toISOString());
  const newbornMarkup = uptimeMarkup({ name: "New service", uptime: newborn }, "UTC", new Date(now).toISOString());
  assert.match(newbornMarkup, /No data/);
  assert.doesNotMatch(newbornMarkup, /<time|Tracking since/);
  assert.doesNotMatch(newbornMarkup, /%/);
  const firstPartial = { history: [{ componentId, causeType: "standing-claim", changedAt: new Date(windowStart).toISOString(), createdAt: new Date(windowStart).toISOString(), newState: "Major outage" }, { componentId, causeType: "standing-claim", changedAt: new Date(windowStart + 60 * 60_000).toISOString(), createdAt: new Date(windowStart + 60 * 60_000).toISOString(), newState: "Operational" }], corrections: [] };
  const firstDay = computeUptime(firstPartial, componentId, now, "UTC", policies);
  assert.match(uptimeMarkup({ name: "API", uptime: firstDay }, "UTC", new Date(now).toISOString()), /uptime-mark downtime major-outage/);
  assert.equal(firstDay.percentage, "99.95%", "the first hour of the exact trailing window is not discarded");
})(t);
  t.diagnostic("COMP-003 — a state correction retains the original history fact and appends attributable state history");
  await (() => {
  const history = queryLocalSql("SELECT previous_state AS previousState, new_state AS newState, cause_type AS causeType, operator_id AS operatorId FROM component_state_history WHERE component_id = '01J00000000000000000000010' ORDER BY created_at");
  assert.ok(history.some((entry) => entry.previousState === "Operational" && entry.newState === "Operational" && entry.causeType === "standing-claim"));
  assert.ok(history.some((entry) => entry.newState === "Major outage" && entry.causeType === "correction" && entry.operatorId === "01J00000000000000000000001"));
})(t);
  t.diagnostic("UPTIME-001 — a one-minute outage in the exact ninety-day window rounds down below 100 percent");
  await (() => {
  const now = Date.parse("2026-09-08T12:00:00.000Z");
  const componentId = "uptime-definition";
  const source = { history: [
    { componentId, causeType: "standing-claim", changedAt: new Date(now - 90 * 86_400_000).toISOString(), createdAt: "2026-01-01T00:00:00.000Z", newState: "Operational" },
    { componentId, causeType: "standing-claim", changedAt: new Date(now - 60_000).toISOString(), createdAt: "2026-01-01T00:00:00.000Z", newState: "Major outage" },
  ], corrections: [] };
  assert.equal(computeUptime(source, componentId, now, "UTC", { uptimeDowntimeWeight: (state) => state === "Major outage" ? 1 : 0 }).percentage, "99.99%");
})(t);
  t.diagnostic("UPTIME-002 — the configured state weights charge partial degradation and exclude maintenance");
  await (() => {
  const now = Date.parse("2026-09-08T12:00:00.000Z");
  const componentId = "uptime-weights";
  const start = now - 90 * 86_400_000;
  const policy = { uptimeDowntimeWeight: (state) => state === "Major outage" || state === "Partially unavailable" ? 1 : state === "Degraded performance" ? 0.5 : 0 };
  const degraded = computeUptime({ history: [{ componentId, causeType: "standing-claim", changedAt: new Date(start).toISOString(), createdAt: new Date(start).toISOString(), newState: "Operational" }, { componentId, causeType: "standing-claim", changedAt: new Date(now - 2 * 60_000).toISOString(), createdAt: new Date(now).toISOString(), newState: "Degraded performance" }], corrections: [] }, componentId, now, "UTC", policy);
  const maintenance = computeUptime({ history: [{ componentId, causeType: "standing-claim", changedAt: new Date(start).toISOString(), createdAt: new Date(start).toISOString(), newState: "Operational" }, { componentId, causeType: "standing-claim", changedAt: new Date(now - 60 * 60_000).toISOString(), createdAt: new Date(now).toISOString(), newState: "Under maintenance" }], corrections: [] }, componentId, now, "UTC", policy);
  assert.equal(degraded.percentage, "99.99%");
  assert.equal(maintenance.percentage, "100.00%");
})(t);
  t.diagnostic("UPTIME-003 — short history reports whole covered days rather than inventing a ninety-day record");
  await (() => {
  const now = Date.parse("2026-09-08T12:00:00.000Z");
  const componentId = "uptime-short";
  const uptime = computeUptime({ history: [{ componentId, causeType: "standing-claim", changedAt: new Date(now - 49 * 60 * 60_000).toISOString(), createdAt: new Date(now).toISOString(), newState: "Operational" }], corrections: [] }, componentId, now, "UTC", { uptimeDowntimeWeight: () => 0 });
  assert.equal(uptime.coverageDays, 2);
  assert.match(uptimeMarkup({ name: "Short history", uptime }, "UTC", new Date(now).toISOString()), /over 2 whole days/);
})(t);
});













test("PAGE-012 UPTIME-006 SUB-003 — Branding, daily coverage and pending subscription expiry", async t => {
  t.diagnostic("PAGE-012 — the footer credit setting controls its content");
  await (async () => {
  await updateSettings({ footerCreditEnabled: true });
  const enabled = await (await fetch(`${pageUrl}/`)).text();
  assert.match(enabled.match(/<footer>[\s\S]*?<\/footer>/)?.[0] ?? "", /Powered by Lamp/);
  assert.doesNotMatch(enabled, /runeditrun\.com/);
  await updateSettings({ footerCreditEnabled: false });
  const disabled = await (await fetch(`${pageUrl}/`)).text();
  const disabledFooter = disabled.match(/<footer>[\s\S]*?<\/footer>/)?.[0] ?? "";
  assert.doesNotMatch(disabledFooter, /Powered by Lamp/);
  assert.match(disabledFooter, /data-lamp-signin/, "hiding the credit keeps the operator entry");
  assert.match(disabledFooter, /href="\/feed.atom"/, "hiding the credit keeps customer resources");
  await updateSettings({ footerCreditEnabled: true });
})(t);
  t.diagnostic("UPTIME-006 — daily marks distinguish no data from a day with zero or weighted downtime");
  await (() => {
  const now = Date.parse("2026-09-08T12:00:00.000Z");
  const componentId = "uptime-marks";
  const historyStart = now - 2 * 86_400_000;
  const uptime = computeUptime({ history: [
    { componentId, causeType: "standing-claim", changedAt: new Date(historyStart).toISOString(), createdAt: new Date(historyStart).toISOString(), newState: "Operational" },
    { componentId, causeType: "standing-claim", changedAt: new Date(historyStart + 60 * 60_000).toISOString(), createdAt: new Date(historyStart).toISOString(), newState: "Major outage" },
    { componentId, causeType: "standing-claim", changedAt: new Date(historyStart + 2 * 60 * 60_000).toISOString(), createdAt: new Date(historyStart).toISOString(), newState: "Operational" },
  ], corrections: [] }, componentId, now, "UTC", { uptimeDowntimeWeight: (state) => state === "Major outage" ? 1 : 0 });
  assert.ok(uptime.marks.some((mark) => mark.downtimeMinutes === null));
  assert.ok(uptime.marks.some((mark) => mark.downtimeMinutes === 0));
  assert.ok(uptime.marks.some((mark) => mark.downtimeMinutes === 60));
  assert.match(uptimeMarkup({ name: "Daily record", uptime }, "UTC", new Date(now).toISOString()), /no data/);
})(t);
  t.diagnostic("SUB-003 — the Worker scheduled runtime expires a 72-hour pending subscriber without a further subscription");
  await (async () => {
  executeLocalSql(`INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES ('scheduled-expired-subscriber','email','scheduled-expired@example.test',NULL,'pending','all','scheduled-expired-token','2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z')`);
  let scheduled;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      scheduled = await fetch(`${pageUrl}/cdn-cgi/local/scheduled`);
      if (scheduled.status === 200) break;
    } catch {
      // Miniflare can reset its local scheduled-event socket while a snapshot
      // rebuild starts. The durable scheduled operation itself is retried.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(scheduled?.status, 200);
  for (let attempt = 0; attempt < 20 && queryLocalSql("SELECT id FROM subscribers WHERE id = 'scheduled-expired-subscriber'").length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(queryLocalSql("SELECT id FROM subscribers WHERE id = 'scheduled-expired-subscriber'"), []);
})(t);
});





test("PAGE-012 PAGE-011 PAGE-019 MOVE-009 — Uploaded branding artwork, allow-listed widget and the old Statuspage embed tag", async t => {
  t.diagnostic("PAGE-012 — a real logo upload, favicon, Open Graph image, and allow-listed widget are snapshot artifacts");
  await (async () => {
  await uploadTestLogo();
  await updateSettings({ widgetAllowedOrigins: [pageUrl] });
  const [page, logo, favicon, og, widget] = await Promise.all([
    fetch(`${pageUrl}/`), fetch(`${pageUrl}/assets/logo`), fetch(`${pageUrl}/assets/favicon.svg`), fetch(`${pageUrl}/assets/og.svg`), fetch(`${pageUrl}/widget.js`),
  ]);
  assert.equal(logo.headers.get("content-type"), "image/png");
  assert.equal(logo.headers.get("content-disposition"), "attachment");
  const pageHtml = await page.text();
  assert.match(pageHtml, /rel="icon" href="\/assets\/favicon\.svg"/);
  assert.match(pageHtml, /<img class="brand-logo" src="\/assets\/mark\.svg" alt="">/, "the configured logo is visible beside the page title without the favicon badge");
  assert.doesNotMatch(pageHtml, /&lt;time datetime=/, "shared update output must contain plain display text, never escaped markup");
  assert.match(await favicon.text(), /<circle/);
  const ogSvg = await og.text();
  assert.match(ogSvg, /<image href="data:image\/png;base64,iVBORw0KGgo/, "Open Graph artwork embeds the stored logo with the generated status marker");
  assert.doesNotMatch(ogSvg, /\/assets\/logo/, "Open Graph artwork is a self-contained asset");
  assert.ok((await widget.text()).length > 0);
  assert.doesNotMatch(await (await fetch(`${pageUrl}/`)).text(), /href="https:\/\/runeditrun\.com"/);
})(t);
  t.diagnostic("PAGE-012 — Chromium renders both the configured logo and the status marker in favicon and Open Graph artwork");
  await (async () => {
  const [[faviconLogo, faviconStatus], [ogLogo, ogStatus]] = await Promise.all([
    svgPixels("/assets/favicon.svg", 128, 128, [{ x: 12, y: 110 }, { x: 101, y: 27 }]),
    svgPixels("/assets/og.svg", 1200, 630, [{ x: 100, y: 100 }, { x: 1090, y: 110 }]),
  ]);
  for (const pixel of [faviconLogo, ogLogo]) assert.ok(pixel[0] > 180 && pixel[1] < 140 && pixel[2] < 140, `expected configured red logo pixel, got ${pixel}`);
  for (const pixel of [faviconStatus, ogStatus]) assert.ok(pixel[1] > pixel[0] && pixel[1] > pixel[2], `expected operational green status marker, got ${pixel}`);
})(t);
  t.diagnostic("PAGE-011 — the widget is compact, same-origin, and fails closed for unlisted embedding origins");
  await (async () => {
  const widget = await (await fetch(`${pageUrl}/widget.js`)).text();
  assert.ok(gzipSync(Buffer.from(widget)).byteLength <= 10 * 1024);
  assert.doesNotMatch(widget, /XMLHttpRequest|importScripts/, "the snapshot widget uses only the public status fetch");
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  try {
    const allowed = await (await browser.newContext()).newPage();
    await allowed.goto(`${pageUrl}/`);
    await allowed.evaluate((url) => new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = resolve;
      script.onerror = reject;
      document.body.append(script);
    }), `${pageUrl}/widget.js`);
    await allowed.locator("section[role=status]").waitFor();
    const denied = await (await browser.newContext()).newPage();
    await denied.setContent(`<script src="${pageUrl}/widget.js"></script>`);
    await denied.waitForTimeout(50);
    assert.equal(await denied.locator("section[role=status]").count(), 0);
  } finally {
    await browser.close();
  }
})(t);
  await widgetVariantsFlow({appFetch,pageUrl,currentSettings,updateSettings});
});





test("PAGE-013 PAGE-014 PAGE-008 PAGE-009 PAGE-003 — Public isolation, live timezone refresh and initial asset budget", async t => {
  t.diagnostic("PAGE-013 — every public snapshot response carries the restrictive same-origin security headers");
  await (async () => {
  const origin = new URL(pageUrl).origin;
  for (const path of ["/", "/history", "/feed.atom", "/widget.js", "/api/public/status", "/assets/status-page.css", "/assets/logo", "/assets/favicon.svg", "/assets/og.svg"]) {
    const response = await fetch(`${pageUrl}${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("content-security-policy"), `default-src ${origin}; script-src ${origin}; style-src ${origin}; font-src 'self' data:; img-src ${origin}; connect-src ${origin}; form-action ${origin}; base-uri ${origin}; frame-ancestors 'none'; object-src 'none'`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    // Complete each real response before starting the next connection.
    await response.arrayBuffer();
  }
})(t);
  t.diagnostic("PAGE-014 — browser polling updates status in place without changing the configured timezone");
  await (async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  try {
    const context = await browser.newContext({ timezoneId: "America/New_York" });
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-09-08T12:00:00.000Z") });
    let polls = 0;
    await page.route("**/api/public/status", async (route) => {
      polls += 1;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: 1, generatedAt: "2026-09-08T12:00:30.000Z", overall: "Major outage", incident: { reference: "INC-123", title: "Live update", lifecycle: "Investigating", publishedAt: "2026-09-08T12:00:30.000Z", summary: "Investigating · Fresh customer update.", message: "Fresh customer update." } }) });
    });
    await page.goto(`${pageUrl}/`);
    const timezoneLabel = page.locator("[data-timezone-label]");
    const initialTimezoneLabel = await timezoneLabel.textContent();
    assert.ok(initialTimezoneLabel.trim());
    assert.equal(await timezoneLabel.getAttribute("data-timezone"), "America/Los_Angeles");
    await page.clock.fastForward(30_000);
    await page.waitForFunction(() => document.querySelector("[data-overall]")?.textContent === "Major outage");
    assert.equal(polls, 1, "the script polls once at its 30-second cadence");
    const live = page.locator("#status-live");
    assert.equal(await live.getAttribute("aria-live"), "polite");
    assert.equal(await live.getAttribute("aria-atomic"), "true");
    assert.match(await live.innerText(), /Major outage[\s\S]*Fresh customer update/);
    assert.equal(await timezoneLabel.textContent(), initialTimezoneLabel);
    assert.equal(await timezoneLabel.getAttribute("data-timezone"), "America/Los_Angeles");
    assert.equal(await page.locator("[data-generated-at] time").getAttribute("datetime"), "2026-09-08T12:00:30.000Z");
    assert.equal(await page.locator("[data-generated-at] time").textContent(), "just now");
    assertVisibleTime(await page.locator("[data-generated-at] time").getAttribute("title"), "2026-09-08T12:00:30.000Z", "America/Los_Angeles");
    await page.clock.fastForward(90 * 60_000);
    await page.waitForFunction(() => document.querySelector("[data-generated-at] time")?.textContent === "1 hour ago");
    assertVisibleTime(await page.locator("[data-generated-at] time").getAttribute("title"), "2026-09-08T12:00:30.000Z", "America/Los_Angeles");
    await context.close();
  } finally {
    await browser.close();
  }
})(t);
  t.diagnostic("PAGE-008 — repeated public snapshot reads are never rate limited");
  await (async () => {
  const responses = await Promise.all(Array.from({ length: 128 }, () => fetch(`${pageUrl}/api/public/status`)));
  assert.ok(responses.every((response) => response.status === 200));
  assert.ok(responses.every((response) => response.status !== 429));
})(t);
  t.diagnostic("PAGE-009 — every public timestamp keeps the configured timezone with browser JavaScript enabled");
  await (async () => {
  await updateSettings({ timezone: "America/Los_Angeles" });
  const created = await appFetch("/api/app/incidents", { method: "POST", body: JSON.stringify({ title: "Timestamp metadata probe", components: [{ componentId: "01J00000000000000000000010", state: "Degraded performance", relationship: "Primary" }] }) });
  assert.equal(created.status, 201);
  const incident = (await created.json()).incident;
  const nextUpdateAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const drafted = await appFetch(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle: "Investigating", affectedAudience: "Timestamp readers", customerImpact: "Requests may be delayed.", whatStillWorks: "The status page remains available.", details: "This update verifies timestamp semantics.", nextUpdateAt }) });
  assert.equal(drafted.status, 200);
  assert.equal((await appFetch(`/api/app/incidents/${incident.id}/publish`, { method: "POST", body: JSON.stringify({ channels: [] }) })).status, 200);
  // Publication commits before its snapshot job; PAGE-007 permits up to 10s.
  let html = "";
  const deadline = performance.now() + 10_000;
  do {
    html = await (await fetch(`${pageUrl}/`)).text();
    if (html.includes(`datetime="${nextUpdateAt}"`)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (performance.now() < deadline);
  const initialTimes = [...html.matchAll(/<time datetime="([^" ]+)"[^>]*data-local-time[^>]*>([^<]+)<\/time>/g)];
  assert.ok(initialTimes.length > 0 && initialTimes.some(([, instant]) => instant === nextUpdateAt), "initial HTML includes the committed next update");
  for (const [, instant, visible] of initialTimes) assertVisibleTime(visible, instant, "America/Los_Angeles");
  assert.match(html, /data-timezone-label data-timezone="America\/Los_Angeles">[^<]+/);
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  try {
    const context = await browser.newContext({ timezoneId: "America/New_York" });
    const page = await context.newPage();
    await page.goto(`${pageUrl}/`, { waitUntil: "networkidle" });
    const nextUpdate = page.locator(".update dt", { hasText: "Next update by" }).locator("xpath=following-sibling::dd[1]/time[@data-local-time]").first();
    const instant = await nextUpdate.getAttribute("datetime");
    const visible = await nextUpdate.textContent();
    assert.equal(instant, nextUpdateAt, "scripted next update retains its committed instant");
    assertVisibleTime(visible, instant, "America/Los_Angeles");
    assert.equal(await page.locator("[data-timezone-label]").getAttribute("data-timezone"), "America/Los_Angeles");
    assert.ok((await page.locator("[data-timezone-label]").textContent()).trim());
    await context.close();
  } finally {
    await browser.close();
  }
})(t);
  t.diagnostic("PAGE-003 — the complete component-limit snapshot remains within the gzip budget");
  await (async () => {
  executeLocalSql(`WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 194) INSERT INTO components (id, group_id, name, description, internal, display_order, note, created_at, updated_at) SELECT 'bulk-' || value, '01J00000000000000000000003', 'Bulk component ' || printf('%03d', value), substr('Maximum valid description for capacity measurement. ' || printf('%03d', value) || ' ..................................................................................................................................................................................................................................................', 1, 280), 0, 1000 + value, substr('Maximum valid public state note for component ' || printf('%03d', value) || ' ..................................................................................................................................................................................................................................................', 1, 250), '2026-06-10T00:00:00.000Z', '2026-06-10T00:00:00.000Z' FROM n; WITH RECURSIVE n(component) AS (SELECT 1 UNION ALL SELECT component + 1 FROM n WHERE component < 194), d(day) AS (SELECT 0 UNION ALL SELECT day + 1 FROM d WHERE day < 89) INSERT INTO component_state_history (id,component_id,previous_state,new_state,cause_type,cause_id,operator_id,changed_at,created_at,updated_at) SELECT 'bulk-history-' || component || '-' || day, 'bulk-' || component, 'Operational', 'Operational', 'standing-claim', NULL, '01J00000000000000000000001', strftime('%Y-%m-%dT%H:%M:%fZ','now','-' || (90 - day) || ' days'), '2026-06-10T00:00:00.000Z', '2026-06-10T00:00:00.000Z' FROM n CROSS JOIN d`);
  await updateSettings({ tagline: "Status record at the component capacity limit." });
  const response = await fetch(`${pageUrl}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const gzipBytes = gzipSync(Buffer.from(html)).byteLength;
  assert.ok(gzipBytes <= 50 * 1024, `PAGE-003 gzip budget exceeded at 200 populated components: ${gzipBytes} bytes`);
  assert.match(html, /Maximum valid public state note for component 001/, "the capacity fixture includes a visible 250-character note");
  const marksPerComponent = [...html.matchAll(/class="uptime-mark /g)].length / 200;
  assert.ok(marksPerComponent >= 90 && marksPerComponent <= 91, "daily marks cover the exact trailing 90-day interval, including its partial boundary day");
  // Each built-in template publishes the same record within the same budget; Regions map draws 14 regions over it.
  const regions = ["North America", "Europe", "Tokyo", "Asia-Pacific", "South America", "Africa", "us-east-1", "eu-west-2", "ap-southeast-2", "Middle East", "India", "Canada", "Frankfurt", "Moon Base One"];
  executeLocalSql(`UPDATE components SET region = CASE CAST(substr(id, 6) AS INTEGER) % ${regions.length} ${regions.map((region, index) => `WHEN ${index} THEN '${region}'`).join(" ")} END WHERE id LIKE 'bulk-%'`);
  for (const template of ["calm", "uptime", "regions"]) {
    await updateSettings({ template });
    let shown = "";
    const deadline = performance.now() + 10_000;
    do {
      shown = await (await fetch(`${pageUrl}/`)).text();
      if (shown.includes(`data-template="${template}"`)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (performance.now() < deadline);
    assert.ok(shown.includes(`data-template="${template}"`), `the public page shows ${template}`);
    const templateBytes = gzipSync(Buffer.from(shown)).byteLength;
    assert.ok(templateBytes <= 50 * 1024, `PAGE-003 gzip budget exceeded by ${template} at 200 populated components: ${templateBytes} bytes`);
    assert.match(shown, /Maximum valid public state note for component 001/, `${template} keeps the capacity fixture's visible note`);
  }
  executeLocalSql("UPDATE components SET region = NULL WHERE id LIKE 'bulk-%'");
  await updateSettings({ template: "default" });
})(t);
  t.diagnostic("PAGE-003 — Chromium renders the public page in its bundled face within the four-request initial asset budget");
  await (async () => {
  await uploadTestLogo();
  const settings = await currentSettings();
  await updateSettings({ tagline: settings.tagline });
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  try {
    const page = await (await browser.newContext()).newPage();
    const paths = new Set();
    const thirdPartyRequests = new Set();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.resourceType() === "document" || !["http:", "https:"].includes(url.protocol)) return;
      if (url.origin === new URL(pageUrl).origin) paths.add(url.pathname);
      else thirdPartyRequests.add(url.href);
    });
    await page.goto(`${pageUrl}/`, { waitUntil: "networkidle" });
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const firstFamily = (element) => getComputedStyle(element).fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
      const loaded = [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replace(/^["']|["']$/g, ""));
      return { brand: firstFamily(document.querySelector(".brand")), body: firstFamily(document.body), loaded };
    });
    assert.ok(fonts.loaded.includes(fonts.body), `the public copy renders in a face the page loaded itself, not a system substitute: ${JSON.stringify(fonts)}`);
    assert.equal(fonts.brand, fonts.body, "the business name uses the same bundled public face");
    assert.ok(paths.size <= 4, `initial public page made ${paths.size} same-origin subresource requests: ${[...paths].join(", ")}`);
    for (const path of paths) assert.ok(["/assets/mark.svg", "/assets/favicon.svg", "/assets/status-page.css", "/assets/status-page.js"].includes(path), `unexpected initial public dependency ${path}`);
    assert.deepEqual([...thirdPartyRequests], [], `public initial page made third-party requests: ${[...thirdPartyRequests].join(", ")}`);
  } finally {
    await browser.close();
  }
})(t);
});












test("HIST-001 PAGE-010 PAGE-006 — Stable feed history and corrupt-pointer recovery", async t => {
  t.diagnostic("HIST-001 — published incident and maintenance notice history stays grouped and Atom-complete for twelve months");
  await (async () => {
  executeLocalSql(`INSERT INTO incidents (id, reference, title, lifecycle, opened_at, resolved_at, created_by_operator_id, created_at, updated_at) VALUES ('01J00000000000000000000900','INC-9000','Resolved history incident','Resolved','2026-09-01T00:00:00.000Z','2026-09-01T01:00:00.000Z','01J00000000000000000000001','2026-09-01T00:00:00.000Z','2026-09-01T01:00:00.000Z'); INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at) VALUES ('01J00000000000000000000901','01J00000000000000000000900','01J00000000000000000000010','Web application','Major outage','Primary','2026-09-01T01:00:00.000Z','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z'); INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES ('01J00000000000000000000902','01J00000000000000000000900','Resolved','All readers','The service recovered.','','','2026-09-01T01:00:00.000Z','2026-09-01T01:00:00.000Z','01J00000000000000000000001','2026-09-01T01:00:00.000Z','2026-09-01T01:00:00.000Z'); INSERT INTO maintenance (id,reference,title,state,starts_at,ends_at,completed_at,created_by_operator_id,created_at,updated_at) VALUES ('01J00000000000000000000910','SCH-9000','Completed history maintenance','Completed','2026-09-02T00:00:00.000Z','2026-09-02T01:00:00.000Z','2026-09-02T01:00:00.000Z','01J00000000000000000000001','2026-09-02T00:00:00.000Z','2026-09-02T01:00:00.000Z'); INSERT INTO maintenance_components (id,maintenance_id,component_id,component_name,state,created_at,updated_at) VALUES ('01J00000000000000000000911','01J00000000000000000000910','01J00000000000000000000010','Web application','Under maintenance','2026-09-02T00:00:00.000Z','2026-09-02T00:00:00.000Z'); INSERT INTO maintenance_notices (id,maintenance_id,kind,body,published_at,author_operator_id,created_at,updated_at) VALUES ('01J00000000000000000000912','01J00000000000000000000910','completed','Maintenance completed.','2026-09-02T01:00:00.000Z','01J00000000000000000000001','2026-09-02T01:00:00.000Z','2026-09-02T01:00:00.000Z')`);
  executeLocalSql(`INSERT INTO components (id,group_id,name,description,internal,display_order,note,created_at,updated_at) VALUES ('history-internal','01J00000000000000000000002','Private history component','',1,99,'','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z'); INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at) VALUES ('history-internal-link','01J00000000000000000000900','history-internal','Private history component','Major outage','Dependent','2026-09-01T01:00:00.000Z','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z'),('history-deleted-link','01J00000000000000000000900',NULL,'Retired payment rail','Major outage','Dependent','2026-09-01T01:00:00.000Z','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z'); INSERT INTO maintenance_notices (id,maintenance_id,kind,body,published_at,author_operator_id,created_at,updated_at) VALUES ('history-notice-scheduled','01J00000000000000000000910','scheduled','Maintenance scheduled.','2026-09-02T02:00:00.000Z','01J00000000000000000000001','2026-09-02T02:00:00.000Z','2026-09-02T02:00:00.000Z'),('history-notice-rescheduled','01J00000000000000000000910','rescheduled','Maintenance rescheduled.','2026-09-02T03:00:00.000Z','01J00000000000000000000001','2026-09-02T03:00:00.000Z','2026-09-02T03:00:00.000Z'),('history-notice-reminder','01J00000000000000000000910','reminder','Maintenance reminder.','2026-09-02T04:00:00.000Z','01J00000000000000000000001','2026-09-02T04:00:00.000Z','2026-09-02T04:00:00.000Z'),('history-notice-started','01J00000000000000000000910','started','Maintenance started.' || char(1) || 'safe text','2026-09-02T05:00:00.000Z','01J00000000000000000000001','2026-09-02T05:00:00.000Z','2026-09-02T05:00:00.000Z'),('history-notice-cancelled','01J00000000000000000000910','cancelled','Maintenance cancelled.','2026-09-02T07:00:00.000Z','01J00000000000000000000001','2026-09-02T07:00:00.000Z','2026-09-02T07:00:00.000Z'); INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,created_at,updated_at) VALUES ('history-outside-window','INC-9001','Outside twelve-month history','Resolved','2025-08-01T00:00:00.000Z','2025-08-01T01:00:00.000Z','01J00000000000000000000001','2025-08-01T00:00:00.000Z','2025-08-01T01:00:00.000Z'); INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at) VALUES ('history-outside-link','history-outside-window','01J00000000000000000000010','Web application','Major outage','Primary','2025-08-01T01:00:00.000Z','2025-08-01T00:00:00.000Z','2025-08-01T00:00:00.000Z'); INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES ('history-outside-update','history-outside-window','Resolved','All readers','Old update.','','','2025-08-01T01:00:00.000Z','2025-08-01T01:00:00.000Z','01J00000000000000000000001','2025-08-01T01:00:00.000Z','2025-08-01T01:00:00.000Z')`);
  await updateSettings({ pageName: "Atlas Cloud History" });
  const [history, atom] = await Promise.all([fetch(`${pageUrl}/history`), fetch(`${pageUrl}/feed.atom`)]);
  const historyText = await history.text();
  const atomText = await atom.text();
  const permalink = await (await fetch(`${pageUrl}/incidents/INC-9000`)).text();
  assert.equal([...permalink.matchAll(/datetime="2026-09-01T01:00:00\.000Z"/g)].length, 1, "the resolution instant appears once on its permanent page");
  assert.match(permalink, /<time datetime="2026-09-01T01:00:00\.000Z" data-local-time>/);
  assertResolvedDuration(permalink, "2026-09-01T00:00:00.000Z", "2026-09-01T01:00:00.000Z");
  assert.match(historyText, /Resolved history incident/);
  assert.match(historyText, /Completed history maintenance/);
  assert.match(historyText, /Retired payment rail/, "published history retains a deleted component name");
  assert.doesNotMatch(historyText, /Private history component/, "internal components do not leak through retained incident history");
  assert.doesNotMatch(historyText, /Outside twelve-month history/, "history excludes records older than twelve months");
  assert.match(atomText, /urn:lamp:test-feed-identity-00000000000001:event:update-01J00000000000000000000902/);
  assert.match(atomText, /urn:lamp:test-feed-identity-00000000000001:event:maintenance-notice-01J00000000000000000000912/);
  for (const noticeId of ["history-notice-scheduled", "history-notice-rescheduled", "history-notice-reminder", "history-notice-started", "history-notice-cancelled"]) assert.match(atomText, new RegExp(`maintenance-notice-${noticeId}`));
  assert.doesNotMatch(atomText, /history-outside-update/, "Atom excludes updates older than twelve months");
  assert.ok(atomText.indexOf("maintenance-notice-history-notice-cancelled") < atomText.indexOf("maintenance-notice-history-notice-started"), "Atom entries are newest first");
  assert.doesNotMatch(atomText, /\u0001/, "invalid XML controls are never emitted");
  execFileSync("xmllint", ["--noout", "-"], { input: atomText });
  assert.match(atomText, /<author><name>Atlas Cloud History<\/name><\/author>/);
  assert.match(atomText, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
})(t);
  t.diagnostic("PAGE-010 — an Atom feed keeps its deployment identity and event IDs when the editable hostname changes");
  await (async () => {
  const before = await (await fetch(`${pageUrl}/feed.atom`)).text();
  await updateSettings({ hostname: "status-renamed.atlascloud.example" });
  const after = await (await fetch(`${pageUrl}/feed.atom`)).text();
  const feedId = /<feed[^>]*><id>([^<]+)<\/id>/.exec(before)?.[1];
  const changedFeedId = /<feed[^>]*><id>([^<]+)<\/id>/.exec(after)?.[1];
  const entryId = /<entry><id>([^<]+)<\/id>/.exec(before)?.[1];
  const changedEntryId = /<entry><id>([^<]+)<\/id>/.exec(after)?.[1];
  assert.equal(feedId, "urn:lamp:test-feed-identity-00000000000001");
  assert.equal(changedFeedId, feedId);
  assert.equal(changedEntryId, entryId);
  assert.match(after, /<link href="https:\/\/status-renamed\.atlascloud\.example\/feed\.atom" rel="self" type="application\/atom\+xml"\/>/);
})(t);
  await publicResourcesFlow({ appFetch, pageUrl, fetch, diagnostic: text => t.diagnostic(text) });
  t.diagnostic("PAGE-006 — a corrupt R2 pointer serves the retained last-known snapshot with an explicit stale label");
  await (async () => {
  const pointer = r2Object("snapshots/current.json");
  assert.match(pointer, /"version"/);
  await (await fetch(`${pageUrl}/`)).text();
  try {
    r2Object("snapshots/current.json", "not-json");
    const response = await fetch(`${pageUrl}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-lamp-snapshot-state"), "stale");
    assert.equal(response.headers.get("warning"), '110 - "Response is stale"');
    const staleBody = await response.text();
    assert.match(staleBody, /Last known state/);
    const generatedAt = response.headers.get("x-lamp-snapshot-generated-at");
    assert.ok(generatedAt && Number.isFinite(Date.parse(generatedAt)));
    assert.ok(staleBody.includes(generatedAt), "retained content must visibly identify its generation instant");
  } finally {
    r2Object("snapshots/current.json", pointer);
  }
})(t);

});
