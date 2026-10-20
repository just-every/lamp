import { requestHeaders } from "../helpers/request-headers.mjs";
import { withDraftVersion } from "./draft-version-helper.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { gzipSync } from "node:zlib";

import { contract } from "../contract.mjs";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { legacyApiFixtureSql } from "./fixtures/legacy-api-fixture.mjs";
// Wrangler CLI work between requests can outlast an idle keep-alive socket; every request opens its own connection.
import { fixtureFetch as fetch } from "../public-snapshots/fixture-fetch.mjs";
import { appOrigin, pageOrigin } from "./helpers/hosts.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";

let appUrl = "";
let pageUrl = "";
let server;
let serverOutput = "";
let sessionId;
let testStatePath;
let testViteCachePath;
let testPort;
const sourceConfigPath = resolve("wrangler.jsonc");

async function appFetch(path, init = {}) {
  init = await withDraftVersion(path, init, appFetch);
  return fetch(`${appUrl}${path}`, {
    ...init,
    headers: requestHeaders({ Cookie: `${sessionCookieName(appUrl)}=${sessionId}`, "Content-Type": "application/json" }, init.headers),
  });
}

function requestWithHost(path, host) {
  return new Promise((resolveResponse, reject) => {
    const client = httpRequest({ host: "127.0.0.1", port: testPort, path, headers: { Host: host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.once("end", () => resolveResponse({ status: response.statusCode, body }));
      response.once("error", reject);
    });
    client.once("error", reject);
    client.end();
  });
}

before(async () => {
  testPort = await reservePort({ label: "API test Worker" });
  // Native sign-in presentation needs mail configured. No auth email is submitted;
  // subscriptions remain unavailable without a subscriber-token secret.
  appUrl = appOrigin(testPort, { MAIL_PROVIDER_API_KEY: "test-only-signin-presentation-no-delivery" });
  pageUrl = pageOrigin(testPort);
  testStatePath = await mkdtemp(join(tmpdir(), "lamp-api-d1-"));
  testViteCachePath = await mkdtemp(join(tmpdir(), "lamp-api-vite-"));
  execFileSync("pnpm", ["run", "migrate:local"], { cwd: process.cwd(), stdio: "pipe", env: { ...process.env, LAMP_WORKERS_STATE_PATH: testStatePath } });
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", sourceConfigPath, "--persist-to", testStatePath, "--command", legacyApiFixtureSql()], { cwd: process.cwd(), stdio: "pipe" });
  server = spawn("pnpm", ["exec", "vite", "--host", "0.0.0.0", "--port", String(testPort), "--strictPort"], {
    cwd: process.cwd(),
    stdio: "pipe",
    detached: true,
    env: { ...process.env, LAMP_DISABLE_INSPECTOR: "true", LAMP_WORKERS_STATE_PATH: testStatePath, LAMP_VITE_CACHE_DIR: testViteCachePath },
  });
  server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });
  await waitForWorker({ origin: appUrl, child: server, output: () => serverOutput, label: "API test Worker" });
  sessionId = await insertRealOperatorSession({ persistTo: testStatePath });
});

after(async () => {
  // Stop the whole pnpm/Vite/workerd group; signalling pnpm alone can leave it running and the suite waiting.
  if (server?.pid && server.exitCode === null) {
    const stopped = new Promise((resolveStopped) => server.once("exit", resolveStopped));
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* Worker already exited. */ }
    await stopped;
  }
  await Promise.all([rm(testStatePath, { recursive: true, force: true }), rm(testViteCachePath, { recursive: true, force: true })]);
});

test("Host and session admission through real operator routes", async t => {
  t.diagnostic("operator APIs reject requests without the session cookie");
  await (async () => {
  const response = await fetch(`${appUrl}/api/app/components`);
  assert.equal(response.status, 401);
})(t);
  t.diagnostic("the Worker rejects configured-surface routes sent to an unknown host");
  await (async () => {
  const paths = ["/", "/app", "/api/app/components", "/health", "/signin", "/app-assets/operator.js"];
  for (const path of paths) {
    // [::1] is a loopback name, but neither the app host nor the page host. fetch() would replace the Host header.
    const response = await requestWithHost(path, `[::1]:${testPort}`);
    assert.equal(response.status, 404, `${path} leaked through an unknown host`);
    assert.equal(response.body, "Not found.");
  }
})(t);
  t.diagnostic("operator document routes redirect without a valid session and serve assets with one");
  await (async () => {
  const anonymous = await fetch(`${appUrl}/app`, { redirect: "manual" });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get("location"), `${appUrl}/signin?returnTo=%2Fapp`);

  const malformed = await fetch(`${appUrl}/app/incidents`, { redirect: "manual", headers: { Cookie: `${sessionCookieName(appUrl)}=%` } });
  assert.equal(malformed.status, 302);

  const signIn = await fetch(`${appUrl}/signin`);
  assert.equal(signIn.status, 200);
  const signInHtml = await signIn.text();
  assert.match(signInHtml, /action="\/auth\/magic-link"/);

  const app = await appFetch("/app");
  assert.equal(app.status, 200);
  const appHtml = await app.text();
  assert.match(appHtml, /Operator workspace/);
  assert.match(appHtml, /Contract Operator/);
  assert.match(appHtml, /src="\/@id\/virtual:tanstack-start-dev-client-entry"/);

  const nested = await appFetch("/app/incidents/01J00000000000000000000020");
  assert.equal(nested.status, 200);
  const session = await appFetch("/api/app/session");
  assert.equal((await session.json()).operator.email, "operator@example.test");
})(t);
});





test("PAGE-001 PAGE-007 PAGE-010 SUB-001 — Complete public snapshots, validators and script-free subscription", async t => {
  t.diagnostic("PAGE-001 — the initial public snapshot is complete without script");
  await (async () => {
  const response = await fetch(`${pageUrl}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Atlas Cloud Status/);
  assert.match(html, /Partially unavailable/);
  assert.match(html, /Elevated 5xx errors for some requests\./);
  assert.match(html, /Subscribe to status updates/);
  assert.match(html, /<form method="post" action="\/subscribe">/);
  const uptimeMarks = [...html.matchAll(/class="uptime-mark /g)].length;
  assert.ok(uptimeMarks >= 6 * 90 && uptimeMarks <= 6 * 91, "each visible component has the trailing 90-day daily record including at most one partial calendar boundary day");
  assert.doesNotMatch(html, /src="https?:\/\//);
  assert.deepEqual([...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"/g)].map((match) => match[1]), ["/assets/favicon.svg", "/assets/status-page.css", "/assets/status-page.js"]);
})(t);
  t.diagnostic("PAGE-007 — public snapshot validators reuse a verified generation with isolation headers");
  await (async () => {
  const response = await fetch(`${pageUrl}/`);
  const etag = response.headers.get("etag");
  assert.ok(etag, "current generation provides a cache validator");
  const unchanged = await fetch(`${pageUrl}/`, { headers: { "If-None-Match": etag } });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  assert.ok((response.headers.get("content-security-policy") ?? "").includes(`default-src ${pageUrl}; script-src ${pageUrl}; style-src ${pageUrl}`), "the snapshot CSP must scope default, script, and style sources to its local origin");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
})(t);
  t.diagnostic("PAGE-010 — the public feed, widget, history, and fixed-size status payload come from the snapshot");
  await (async () => {
  const [feed, widget, status, history, incident, script] = await Promise.all([
    fetch(`${pageUrl}/feed.atom`),
    fetch(`${pageUrl}/widget.js`),
    fetch(`${pageUrl}/api/public/status`),
    fetch(`${pageUrl}/history`),
    fetch(`${pageUrl}/incidents/INC-4821`),
    fetch(`${pageUrl}/assets/status-page.js`),
  ]);
  for (const response of [feed, widget, status, history, incident, script]) assert.equal(response.status, 200);
  const feedText = await feed.text();
  assert.match(feedText, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(feedText, /urn:lamp:legacy-api-feed-identity:event:update-01J00000000000000000000023/, "the snapshot feed carries the published update event");
  const widgetText = await widget.text();
  assert.ok(gzipSync(widgetText).byteLength <= 10 * 1024, "widget must be at most 10KB gzipped");
  const payload = await status.text();
  assert.ok(Buffer.byteLength(payload) < 2 * 1024, "status payload remains a fixed-size live-refresh object");
  const liveStatus = JSON.parse(payload);
  assert.equal(liveStatus.maintenance, null, "no in-progress maintenance is invented");
  assert.equal(typeof liveStatus.overall, "string");
  assert.match(liveStatus.incident.message, /Customer impact:/);
  assert.match(await history.text(), /No past incidents or maintenance in the last 12 months/);
  const incidentHtml = await incident.text();
  assert.match(incidentHtml, /<h1>Elevated API error rates<\/h1>/);
  assert.equal((incidentHtml.match(/<dt>Opened<\/dt>/g) ?? []).length, 1, "incident opening metadata appears once");
  assert.match(await script.text(), /setInterval/);
  assert.doesNotMatch(widgetText, /innerHTML/);
  const missing = await fetch(`${pageUrl}/incidents/INC-0000`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
})(t);
  t.diagnostic("SUB-001 — the no-script subscribe form rejects an unavailable mail capability honestly");
  await (async () => {
  const invalid = await fetch(`${pageUrl}/subscribe`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "email=not-an-email" });
  assert.equal(invalid.status, 400);
  const unavailable = await fetch(`${pageUrl}/subscribe`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "email=reader%40example.com" });
  assert.equal(unavailable.status, 503);
  assert.match(await unavailable.text(), /No confirmation email was sent/);
})(t);
});







test("COMP-006 UPDATE-004 PAGE-012 — Component claims, saved drafts, settings and operator records", async t => {
  t.diagnostic("COMP-006 — standing claims derive a component's public state");
  await (async () => {
  const claim = await appFetch("/api/app/components/01J00000000000000000000011/standing-claim", {
    method: "PUT",
    body: JSON.stringify({ state: "Major outage" }),
  });
  assert.equal(claim.status, 200);
  assert.equal((await claim.json()).component.publicState, "Major outage");
  assert.match(await (await fetch(`${pageUrl}/`)).text(), /<h1 id="overall-status" data-overall>Major outage<\/h1>/);

  const clear = await appFetch("/api/app/components/01J00000000000000000000011/standing-claim", {
    method: "PUT",
    body: JSON.stringify({ state: null }),
  });
  assert.equal(clear.status, 200);
  assert.equal((await clear.json()).component.publicState, "Partially unavailable");

  const componentResponse = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({ groupId: null, name: "Incident attachment probe", description: "", internal: false, displayOrder: 90, note: "" }) });
  assert.equal(componentResponse.status, 201);
  const component = (await componentResponse.json()).component;
  const create = await appFetch("/api/app/incidents", { method: "POST", body: JSON.stringify({ title: "Editable affected components", components: [{ componentId: "01J00000000000000000000011", state: "Degraded performance", relationship: "Primary" }] }) });
  assert.equal(create.status, 201);
  const incident = (await create.json()).incident;
  const path = `/api/app/incidents/${incident.id}`;
  const attach = (body) => appFetch(`${path}/components`, { method: "POST", body: JSON.stringify(body) });
  const claimInput = { componentId: component.id, state: "Major outage", relationship: "Dependent" };
  const preview = (body) => appFetch(`${path}/components/preview`, { method: "POST", body: JSON.stringify(body) });
  assert.equal((await preview({ ...claimInput, action: "invalid" })).status, 400);
  assert.equal((await preview({ action: "attach", componentId: component.id, state: "invalid" })).status, 400);
  const beforePreview = (await (await appFetch(path)).json()).incident;
  const privatePreview = await preview({ ...claimInput, action: "attach" });
  assert.equal(privatePreview.status, 200);
  assert.deepEqual((await privatePreview.json()).preview, { published: false, componentName: component.name, internal: false, previousState: "Operational", nextState: "Operational", emailRecipients: 0, webhookRecipients: 0 });
  assert.deepEqual((await (await appFetch(path)).json()).incident, beforePreview, "previewing has no incident or draft effects");
  assert.equal((await attach({ componentId: component.id })).status, 400);
  assert.equal((await attach({ ...claimInput, state: "invalid" })).status, 400);
  assert.equal((await attach({ ...claimInput, componentId: "01J00000000000000000009999" })).status, 409);
  assert.equal((await attach(claimInput)).status, 201);
  assert.equal((await (await appFetch("/api/app/components")).json()).components.find((item) => item.id === component.id).publicState, "Operational", "unpublished claims stay private");
  assert.equal((await attach(claimInput)).status, 409);
  const before = (await (await appFetch(path)).json()).incident;
  assert.deepEqual(before.draft, incident.draft, "component changes preserve saved draft/version");
  assert.equal(before.components.find((claim) => claim.componentId === component.id).relationship, "Dependent");
  const draft = { lifecycle: "Monitoring", affectedAudience: "Attachment readers", customerImpact: "Attachment impact", whatStillWorks: "", details: "", nextUpdateAt: new Date(Date.now() + 3600000).toISOString() };
  assert.equal((await appFetch(`${path}/draft`, { method: "PUT", body: JSON.stringify(draft) })).status, 200);
  assert.equal((await appFetch(`${path}/publish`, { method: "POST", body: JSON.stringify({ channels: [] }) })).status, 200);
  await appFetch(`/api/app/components/${component.id}/standing-claim`, { method: "PUT", body: JSON.stringify({ state: "Degraded performance" }) });
  const detachPreview = (await (await preview({ action: "detach", componentId: component.id })).json()).preview;
  assert.deepEqual({ from: detachPreview.previousState, to: detachPreview.nextState, email: detachPreview.emailRecipients, webhook: detachPreview.webhookRecipients }, { from: "Major outage", to: "Degraded performance", email: 0, webhook: 0 });
  assert.equal((await (await appFetch("/api/app/components")).json()).components.find((item) => item.id === component.id).publicState, detachPreview.previousState, "preview releases no public claim");
  assert.equal((await appFetch(`${path}/components/${component.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await (await appFetch("/api/app/components")).json()).components.find((item) => item.id === component.id).publicState, "Degraded performance", "detach reveals remaining claims");
  assert.equal((await appFetch(`${path}/components/${component.id}`, { method: "DELETE" })).status, 409);
  const livePreview = (await (await preview({ ...claimInput, action: "attach" })).json()).preview;
  assert.equal(livePreview.published, true);
  assert.equal(livePreview.previousState, "Degraded performance");
  assert.equal(livePreview.nextState, "Major outage");
  assert.equal(livePreview.emailRecipients, 0, "page-only latest update has no email recipients");
  const concurrent = await Promise.all([attach(claimInput), attach(claimInput)]);
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [201,409]);
  assert.equal((await (await appFetch("/api/app/components")).json()).components.find((item) => item.id === component.id).publicState, "Major outage");
  await appFetch(`${path}/draft`, { method: "PUT", body: JSON.stringify({ ...draft, lifecycle: "Resolved", nextUpdateAt: null }) });
  assert.equal((await appFetch(`${path}/publish`, { method: "POST", body: JSON.stringify({ channels: [] }) })).status, 200);
  assert.equal((await appFetch(`${path}/components/${component.id}`, { method: "DELETE" })).status, 409);
  assert.equal((await attach(claimInput)).status, 409);
  assert.equal((await appFetch(path, { method: "DELETE", body: JSON.stringify({ reason: "Attachment probe complete" }) })).status, 200);
  assert.equal((await attach(claimInput)).status, 409);
  await appFetch(`/api/app/components/${component.id}/standing-claim`, { method: "PUT", body: JSON.stringify({ state: null }) });
  assert.equal((await appFetch(`/api/app/components/${component.id}`, { method: "DELETE" })).status, 204);
})(t);
  t.diagnostic("UPDATE-004 — draft save and preview share the incident renderer");
  await (async () => {
  const draft = {
    lifecycle: "Monitoring",
    affectedAudience: "API customers in two regions.",
    customerImpact: "Some requests can fail while recovery is verified.",
    whatStillWorks: "Dashboards and exports remain available.",
    details: "The mitigation is in place and engineers are monitoring it.",
    nextUpdateAt: "2026-08-31T03:30:00.000Z",
  };
  const saved = await appFetch("/api/app/incidents/01J00000000000000000000020/draft", { method: "PUT", body: JSON.stringify(draft) });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).draft.customerImpact, draft.customerImpact);

  const preview = await appFetch("/api/app/incidents/01J00000000000000000000020/draft/preview", { method: "POST", body: JSON.stringify(draft) });
  assert.equal(preview.status, 200);
  const body = await preview.json();
  assert.equal(body.preview.public.fields.find((field) => field.label === "Customer impact").value, draft.customerImpact);
  assert.match(body.preview.email.plainText, new RegExp(draft.customerImpact));
})(t);
  t.diagnostic("PAGE-012 — page settings retain a configurable footer credit without any external operation");
  await (async () => {
  const initial = await appFetch("/api/app/page-settings");
  assert.equal(initial.status, 200);
  const settings = (await initial.json()).settings;
  assert.equal(settings.footerCreditEnabled, true);
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", sourceConfigPath, "--persist-to", testStatePath, "--command", "UPDATE incidents SET title = '<img src=x onerror=alert(1)>' WHERE id = '01J00000000000000000000020'"], { cwd: process.cwd(), stdio: "pipe" });

  const updated = await appFetch("/api/app/page-settings", {
    method: "PUT",
    body: JSON.stringify({
      pageName: "Atlas Cloud Status — revised",
      tagline: settings.tagline,
      accentColor: settings.accentColor,
      timezone: settings.timezone,
      hostname: settings.hostname,
      footerCreditEnabled: false,
    }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).settings.footerCreditEnabled, false);
  assert.match(await (await fetch(`${pageUrl}/`)).text(), /Atlas Cloud Status — revised/);
  const widget = await (await fetch(`${pageUrl}/widget.js`)).text();
  assert.match(widget, /\\u003cimg src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(widget, /innerHTML/);
  assert.match(widget, /textContent/);
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", sourceConfigPath, "--persist-to", testStatePath, "--command", "UPDATE incidents SET title = 'Elevated API error rates' WHERE id = '01J00000000000000000000020'"], { cwd: process.cwd(), stdio: "pipe" });

  const restored = await appFetch("/api/app/page-settings", {
    method: "PUT",
    body: JSON.stringify({
      pageName: settings.pageName,
      tagline: settings.tagline,
      accentColor: settings.accentColor,
      timezone: settings.timezone,
      hostname: settings.hostname,
      footerCreditEnabled: true,
    }),
  });
  assert.equal(restored.status, 200);
})(t);
  t.diagnostic("operator API paths require canonical ULIDs and one incident has one atomic draft");
  await (async () => {
  const badIncident = await appFetch("/api/app/incidents/not-an-id");
  assert.equal(badIncident.status, 400);
  const badComponent = await appFetch("/api/app/components/not-an-id/standing-claim", { method: "PUT", body: JSON.stringify({ state: "Operational" }) });
  assert.equal(badComponent.status, 400);

  const first = {
    lifecycle: "Identified",
    affectedAudience: "Customers using the API.",
    customerImpact: "Requests may fail.",
    whatStillWorks: "The dashboard remains available.",
    details: "A mitigated condition is being verified.",
    nextUpdateAt: "2026-08-31T04:00:00.000Z",
  };
  const firstSaved = await appFetch("/api/app/incidents/01J00000000000000000000020/draft", { method: "PUT", body: JSON.stringify(first) });
  assert.equal(firstSaved.status, 200);
  const firstDraft = (await firstSaved.json()).draft;
  const secondSaved = await appFetch("/api/app/incidents/01J00000000000000000000020/draft", { method: "PUT", body: JSON.stringify({ ...first, details: "The mitigated condition is verified." }) });
  assert.equal(secondSaved.status, 200);
  const secondDraft = (await secondSaved.json()).draft;
  // Each save is a new draft version; the incident still holds exactly one draft, the latest.
  assert.notEqual(secondDraft.id, firstDraft.id);
  const stored = (await (await appFetch("/api/app/incidents/01J00000000000000000000020")).json()).incident.draft;
  assert.equal(stored.id, secondDraft.id);
  assert.equal(stored.details, "The mitigated condition is verified.");
})(t);
  t.diagnostic("overview and list APIs expose only persisted local-development sample data");
  await (async () => {
  const [overview, incidents, maintenance, subscribers, deliveries] = await Promise.all([
    appFetch("/api/app/overview"),
    appFetch("/api/app/incidents"),
    appFetch("/api/app/maintenance"),
    appFetch("/api/app/subscribers"),
    appFetch("/api/app/deliveries?outcome=queued"),
  ]);
  for (const response of [overview, incidents, maintenance, subscribers, deliveries]) assert.equal(response.status, 200);
  assert.equal((await overview.json()).overview.components.length, 7);
  assert.equal((await incidents.json()).incidents[0].impact, "Partially unavailable");
  assert.equal((await maintenance.json()).maintenance[0].state, "Scheduled");
  assert.equal((await subscribers.json()).subscribers.length, 2);
  assert.equal((await deliveries.json()).deliveries.every((delivery) => delivery.outcome === "queued"), true);
})(t);
});









test("INTAKE-005 — Private alert configuration and honest AI readiness", async t => {
  t.diagnostic("INTAKE-005 — operators can inspect rejected alert mappings without receiving payloads or credentials");
  await (async () => {
  const signingSecret = "test-alert-signing-secret";
  const created = await appFetch("/api/app/intake/sources", {
    method: "POST",
    body: JSON.stringify({
      name: "API latency monitor",
      credentialKind: "hmac-sha256",
      signingSecret,
      deduplicationPath: "$.alert.id",
      titlePath: "$.alert.title",
      statePath: "$.alert.state",
      recoveredValue: "recovered",
    }),
  });
  assert.equal(created.status, 201);
  const source = (await created.json()).source;
  assert.equal(source.signingSecret, undefined);
  assert.equal(source.bearerTokenHash, undefined);

  const rawBody = JSON.stringify({ alert: { title: "API latency" } });
  const timestamp = new Date().toISOString();
  const signature = createHmac("sha256", signingSecret).update(`${timestamp}.${rawBody}`).digest("base64url");
  const rejected = await fetch(`${pageUrl}/api/intake/${source.id}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-lamp-timestamp": timestamp,
      "x-lamp-signature": signature,
    },
    body: rawBody,
  });
  assert.equal(rejected.status, 400);

  const receipts = await appFetch("/api/app/intake/receipts?limit=1");
  assert.equal(receipts.status, 200, await receipts.clone().text());
  const receipt = (await receipts.json()).receipts[0];
  assert.equal(receipt.sourceName, "API latency monitor");
  assert.equal(receipt.state, "invalid");
  assert.match(receipt.error, /deduplication path/i);
  assert.equal("requestHash" in receipt, false);
  assert.equal("payloadJson" in receipt, false);
})(t);
  t.diagnostic("an operator can update an alert source without exposing or replacing its existing credential");
  await (async () => {
  const signingSecret = "editable-alert-source-secret";
  const sourceInput = {
    name: "Edge latency monitor",
    credentialKind: "hmac-sha256",
    signingSecret,
    timestampHeader: "x-monitor-at",
    signatureHeader: "x-monitor-sign",
    deduplicationPath: "$.event.key",
    titlePath: "$.event.summary",
    statePath: "$.event.state",
    recoveredValue: "recovered",
  };
  const created = await appFetch("/api/app/intake/sources", { method: "POST", body: JSON.stringify(sourceInput) });
  assert.equal(created.status, 201, await created.clone().text());
  const source = (await created.json()).source;
  assert.equal(source.endpointPath, `/api/intake/${source.id}`);
  assert.equal("signingSecret" in source, false);
  assert.equal("bearerTokenHash" in source, false);

  const updated = await appFetch(`/api/app/intake/sources/${source.id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: "Edge latency monitor — primary",
      credentialKind: "hmac-sha256",
      deduplicationPath: sourceInput.deduplicationPath,
      titlePath: sourceInput.titlePath,
      statePath: sourceInput.statePath,
      recoveredValue: sourceInput.recoveredValue,
    }),
  });
  assert.equal(updated.status, 200, await updated.clone().text());
  const changed = (await updated.json()).source;
  assert.equal(changed.name, "Edge latency monitor — primary");
  assert.equal(changed.timestampHeader, "x-monitor-at");
  assert.equal(changed.signatureHeader, "x-monitor-sign");
  assert.equal("signingSecret" in changed, false);

  const rawBody = JSON.stringify({ event: { key: "edge-latency-1", summary: "Edge latency is elevated", state: "firing" } });
  const timestamp = new Date().toISOString();
  const signature = createHmac("sha256", signingSecret).update(`${timestamp}.${rawBody}`).digest("base64url");
  const accepted = await fetch(`${pageUrl}${changed.endpointPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-monitor-at": timestamp, "x-monitor-sign": signature },
    body: rawBody,
  });
  assert.equal(accepted.status, 202, await accepted.clone().text());
  const receiptId = (await accepted.json()).receiptId;
  const receipts = await appFetch("/api/app/intake/receipts?limit=10");
  assert.equal(receipts.status, 200);
  const receipt = (await receipts.json()).receipts.find((candidate) => candidate.id === receiptId);
  assert.deepEqual({ sourceName: receipt.sourceName, state: receipt.state, incidentId: receipt.incidentId }, {
    sourceName: "Edge latency monitor — primary",
    state: "firing",
    incidentId: receipt.incidentId,
  });
  assert.equal("payloadJson" in receipt, false);
  assert.equal("requestHash" in receipt, false);

  const missingBearer = await appFetch(`/api/app/intake/sources/${source.id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: changed.name,
      credentialKind: "bearer-token",
      deduplicationPath: sourceInput.deduplicationPath,
      titlePath: sourceInput.titlePath,
      statePath: sourceInput.statePath,
      recoveredValue: sourceInput.recoveredValue,
    }),
  });
  assert.equal(missingBearer.status, 400);

  const bearerToken = "synthetic-replacement-source-bearer-token";
  const bearerSource = await appFetch(`/api/app/intake/sources/${source.id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: changed.name,
      credentialKind: "bearer-token",
      bearerToken,
      deduplicationPath: sourceInput.deduplicationPath,
      titlePath: sourceInput.titlePath,
      statePath: sourceInput.statePath,
      recoveredValue: sourceInput.recoveredValue,
    }),
  });
  assert.equal(bearerSource.status, 200, await bearerSource.clone().text());
  const bearer = (await bearerSource.json()).source;
  assert.equal(bearer.credentialKind, "bearer-token");
  assert.equal("signingSecret" in bearer, false);
  assert.equal("bearerTokenHash" in bearer, false);
  const bearerAccepted = await fetch(`${pageUrl}${bearer.endpointPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ event: { key: "edge-latency-2", summary: "Bearer-authenticated alert", state: "firing" } }),
  });
  assert.equal(bearerAccepted.status, 202, await bearerAccepted.clone().text());

  const unknown = await appFetch("/api/app/intake/sources/01J00000000000000000009999", {
    method: "PUT",
    body: JSON.stringify({ ...sourceInput, signingSecret: undefined }),
  });
  assert.equal(unknown.status, 404);
})(t);
  t.diagnostic("AI configuration status is honest while tone instructions persist through the settings API");
  await (async () => {
  const initial = await appFetch("/api/app/page-settings");
  assert.equal(initial.status, 200);
  const original = (await initial.json()).settings;
  const request = {
    pageName: original.pageName,
    tagline: original.tagline,
    accentColor: original.accentColor,
    timezone: original.timezone,
    hostname: original.hostname,
    footerCreditEnabled: original.footerCreditEnabled,
    widgetAllowedOrigins: original.widgetAllowedOrigins,
    mailFromAddress: original.mailFromAddress,
    aiToneInstructions: "Use compact, factual sentences and name customer impact before technical detail.",
  };
  try {
    const status = await appFetch("/api/app/ai/status");
    assert.equal(status.status, 200);
    assert.equal((await status.json()).configured, false);

    const saved = await appFetch("/api/app/page-settings", { method: "PUT", body: JSON.stringify(request) });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal((await saved.json()).settings.aiToneInstructions, request.aiToneInstructions);

    const reloaded = await appFetch("/api/app/page-settings");
    assert.equal(reloaded.status, 200);
    assert.equal((await reloaded.json()).settings.aiToneInstructions, request.aiToneInstructions);
  } finally {
    await appFetch("/api/app/page-settings", {
      method: "PUT",
      body: JSON.stringify({ ...request, aiToneInstructions: original.aiToneInstructions }),
    });
  }
})(t);
});





contract("PAGE-006", "public reads survive a D1 failure and never invent an all-clear", async () => {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", sourceConfigPath, "--persist-to", testStatePath, "--command", "DROP TABLE page_settings"], { cwd: process.cwd(), stdio: "pipe" });
  const response = await fetch(`${pageUrl}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Partially unavailable/);
  assert.doesNotMatch(html, /All systems operational/);

  execFileSync("pnpm", ["exec", "wrangler", "r2", "object", "delete", "lamp-local-snapshots/snapshots/current.json", "--local", "--persist-to", testStatePath, "--force"], { cwd: process.cwd(), stdio: "pipe" });
  const missing = await fetch(`${pageUrl}/`);
  assert.equal(missing.status, 200, "a previously published snapshot survives loss of both D1 and the R2 selector");
  assert.equal(missing.headers.get("x-lamp-snapshot-state"), "stale");
  assert.equal(missing.headers.get("x-lamp-snapshot-generated-at"), response.headers.get("x-lamp-snapshot-generated-at"));
  const retained = await missing.text();
  assert.match(retained, /Last known state/);
  assert.match(retained, /Partially unavailable/);
  assert.doesNotMatch(retained, /All systems operational/);
});
