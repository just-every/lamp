import { themeOwnerJourney } from "./helpers/theme-owner-journey.mjs";
import { stripVTControlCharacters } from "node:util";
import { requestHeaders } from "../helpers/request-headers.mjs";
import { withDraftVersion } from "./draft-version-helper.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { appOrigin, pageOrigin } from "./helpers/hosts.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { isolatedWranglerConfig } from "../helpers/wrangler-config.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";
import { phoneDeskFlow } from "./helpers/phone-desk-flow.mjs";
import { operatorHydrated } from "./helpers/operator-hydrated.mjs";
import { incidentComposer, newIncidentForm } from "./helpers/incident-composer.mjs";

let appUrl = "";
let pageUrl = "";
let testPort;
let aiPort;
let statePath;
let viteCachePath;
let fixtureConfig;
let terminalDirectory;
let configPath;
const defaultConfigPath = resolve("wrangler.jsonc");
let server;
let sessionId;
let browser;
let browserContext;
let page;
let serverOutput = "";
let failingAiServer;
let originalVisualSource;

function configWithLocalMail(config) {
  return { ...config, vars: { ...config.vars,
    RER_DEV_KEY: "test-only-publishing-browser-dev-key", RER_DEV_ORIGIN: appUrl, RER_DEV_IDENTITY: "off",
  } };
}

function configWithAiProvider(config) {
  config = configWithLocalMail(config);
  return { ...config, vars: { ...config.vars, AI_PROVIDER_URL: `http://127.0.0.1:${aiPort}/v1`, AI_PROVIDER_API_KEY: "browser-test-key", AI_PROVIDER_MODEL: "browser-test-model" } };
}

async function startFailingAiProvider() {
  const provider = createHttpServer((_request, response) => {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Browser AI provider intentionally unavailable" }));
  });
  failingAiServer = provider;
  await new Promise((resolve, reject) => {
    provider.once("error", reject);
    provider.listen(aiPort, "127.0.0.1", resolve);
  });
}

async function stopFailingAiProvider() {
  if (!failingAiServer) return;
  await new Promise((resolve) => failingAiServer.close(resolve));
  failingAiServer = undefined;
}

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`Publishing browser test port ${port} is already in use.`)));
    probe.listen(port, "127.0.0.1", () => probe.close((error) => error ? reject(error) : resolve()));
  });
}

async function startWorker(config = defaultConfigPath) {
  await assertPortAvailable(testPort);
  serverOutput = "";
  server = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(testPort), "--strictPort"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "pipe",
    env: { ...process.env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: viteCachePath, LAMP_WRANGLER_CONFIG: config, LAMP_DISABLE_INSPECTOR: "true" },
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  await waitForWorker({ origin: appUrl, timeoutMs: 180_000, isListening: () => stripVTControlCharacters(serverOutput).includes(`${appUrl}/`), child: server, output: () => `${serverOutput}\nState: ${statePath}`, label: "Publishing browser Worker" });
}

async function stopWorker() {
  if (!server || server.killed || server.exitCode !== null) return;
  // The pnpm wrapper can exit while Vite still owns the listening socket.
  // Register before signalling and wait for descendant stdio to close too.
  const stopped = new Promise((resolve) => server.once("close", resolve));
  try { process.kill(-server.pid, "SIGTERM"); } catch (cause) { if (cause?.code !== "ESRCH") throw cause; }
  await stopped;
  server = undefined;
}

async function openAuthenticatedPage(viewport) {
  browserContext = await browser.newContext({ timezoneId: "Australia/Brisbane", ...(viewport ? { viewport } : {}) });
  // Cold client builds leave server-rendered controls disabled until hydration.
  browserContext.setDefaultTimeout(60_000);
  await browserContext.addCookies([{ name: sessionCookieName(appUrl), value: sessionId, url: appUrl }]);
  page = await browserContext.newPage();
}

async function closeAuthenticatedPage() {
  const viewport = page?.viewportSize() ?? undefined;
  await page?.close();
  await browserContext?.close();
  page = undefined;
  browserContext = undefined;
  return viewport;
}

async function appFetch(path, init = {}) {
  init = await withDraftVersion(path, init, appFetch);
  return fetch(`${appUrl}${path}`, { ...init, headers: requestHeaders({ Cookie: `${sessionCookieName(appUrl)}=${sessionId}`, "Content-Type": "application/json" }, init.headers) });
}


before(async () => {
  testPort = await reservePort({ label: "Publishing browser Worker" });
  aiPort = await reservePort({ label: "Publishing browser AI provider" });
  appUrl = appOrigin(testPort);
  pageUrl = pageOrigin(testPort);
  statePath = await mkdtemp(join(tmpdir(), "lamp-publishing-browser-d1-"));
  // The public terminal command reads settings from its working directory.
  // Keep the fixture independent of the installed owner settings in this checkout.
  terminalDirectory = await mkdtemp(join(tmpdir(), "lamp-publishing-terminal-"));
  await symlink(resolve("node_modules"), join(terminalDirectory, "node_modules"), "dir");
  writeFileSync(join(terminalDirectory, "package.json"), readFileSync(resolve("package.json")));
  viteCachePath = await mkdtemp(resolve("node_modules/.lamp-publishing-browser-vite-"));
  // The fixture config lives in its own directory so a checkout's `.dev.vars` (for example its AI provider) cannot override it.
  // The add-subscriber door prepares a confirmation. Use the shipped silent
  // local transport, while the real operator session remains the authority.
  await startFailingAiProvider();
  fixtureConfig = isolatedWranglerConfig(configWithAiProvider);
  configPath = fixtureConfig.path;
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", defaultConfigPath, "--persist-to", statePath], { cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024, stdio: "pipe" });
  const visualSource = resolve('src/editor/visual-edits.json');
  originalVisualSource = readFileSync(visualSource);
  const snapshot = JSON.parse(originalVisualSource);
  if (!snapshot.edits.some(edit => edit.path === '/app' && edit.target.selector?.startsWith('h1'))) {
    snapshot.revision += 1;
    snapshot.edits.push({ id: 'test-heading-probe', revision: 1, path: '/app', target: { selector: 'h1:nth-child(1)', tag: 'h1', role: '', beforeText: 'Overview' }, change: { text: 'Workspace overview' } });
    writeFileSync(visualSource, JSON.stringify(snapshot, null, 2) + '\n');
  }

  await startWorker(configPath);
  sessionId = await insertRealOperatorSession({ persistTo: statePath });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ["--no-sandbox", "--use-mock-keychain", "--password-store=basic"] });
  await openAuthenticatedPage({ width: 1440, height: 1000 });
});

after(async () => {
  try {
    await closeAuthenticatedPage();
    await browser?.close();
    await stopWorker();
  } finally {
    if (originalVisualSource) {
      const source = resolve('src/editor/visual-edits.json');
      writeFileSync(source,originalVisualSource);
      assert.deepEqual(readFileSync(source),originalVisualSource,'the probe must restore the exact owner snapshot bytes');
    }
  }
  await stopFailingAiProvider();
  await Promise.all([rm(statePath, { recursive: true, force: true }), rm(viteCachePath, { recursive: true, force: true }), rm(terminalDirectory, { recursive: true, force: true }), fixtureConfig?.cleanup()]);
});

async function waitForPublicIncident(reference, expectedText) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${pageUrl}/incidents/${reference}`);
    const html = await response.text();
    if (response.status === 200 && html.includes(expectedText)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The public snapshot did not contain ${expectedText} for ${reference}.`);
}

// A date and time input value `offsetMs` from now in the page's Los Angeles zone.
const localInput = (offsetMs) => page.evaluate((offset) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now() + offset));
  const part = (kind) => parts.find(entry => entry.type === kind).value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}, offsetMs);

async function verifyCompiledEdits() {
  const snapshot = JSON.parse(readFileSync(resolve('src/editor/visual-edits.json'), 'utf8'));
  const errors = [], recordError = error => errors.push(error.message);
  page.on('pageerror', recordError);
  const paths = [...new Set(['/app', ...snapshot.edits.map(edit => edit.path)])];
  try {
    for (const path of paths) {
      await page.goto(appUrl + path, { waitUntil: 'domcontentloaded' });
      await operatorHydrated(page);
      const check = async () => {
        for (const edit of snapshot.edits.filter(edit => edit.target.navigation || edit.path === path)) await page.waitForFunction(edit => {
          const matches = edit.target.navigation
            ? [...document.querySelectorAll('nav a[href]')].filter(link => new URL(link.href).pathname === edit.target.navigation.href)
            : [...document.querySelectorAll(edit.target.selector)];
          if (matches.length !== 1) return false;
          const element = matches[0];
          if (edit.change.text !== undefined && element.textContent.replace(/\s+/g, ' ').trim() !== edit.change.text.replace(/\s+/g, ' ').trim()) return false;
          const probe = document.createElement('div');
          for (const [name, value] of Object.entries(edit.change.styles || {})) {
            probe.style.setProperty(name, value);
            if (element.style.getPropertyValue(name) !== probe.style.getPropertyValue(name)) return false;
          }
          return true;
        }, edit);
      };
      await check(); await page.reload({ waitUntil: 'domcontentloaded' }); await operatorHydrated(page); await check();
    }
    assert.deepEqual(errors, [], 'owner edits preserve a healthy application');
  } finally { page.off('pageerror', recordError); }
}

async function api(path, method = 'GET', body) {
  const response = await appFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}
const saved = () => page.locator('.autosave-status.is-saved').waitFor();
const readIncident = async id => (await api(`/api/app/incidents/${id}`)).incident;

test('TEAM-001 TEAM-004 TEAM-007 — operator role changes, server permissions and audit', { timeout: 300_000 }, async () => {
  const {actors}=await (await import('./helpers/operator-roles-flow.mjs')).operatorRolesFlow({appFetch,appUrl,persistTo:statePath,configPath});
  await (await import('./helpers/operator-roles-browser-flow.mjs')).operatorRolesBrowserFlow({page,appUrl,appFetch,actor:actors.viewer});
  await page.setViewportSize({width:1440,height:1000});
});

// Preserve the private-note and queued-save journeys in the consolidated operator day.
async function observeAutosaveAcknowledgement(endpoint, key) {
  await page.evaluate(({ endpoint, key }) => {
    const nativeFetch = window.fetch;
    window[key] ??= {};
    window.fetch = async (input, init) => {
      const response = await nativeFetch(input, init);
      const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      if (path === endpoint && init?.method === 'PUT') {
        window[key].nativeAcknowledged = Date.now();
        window[key].nativeAcknowledgedPerformance = performance.now();
      }
      return response;
    };
  }, { endpoint, key });
}
async function assertAutosaveIntegrity(component, t) {
  const initial = { lifecycle: 'Investigating', affectedAudience: 'Initial audience', customerImpact: 'Service delays', whatStillWorks: 'Other services', details: 'Private draft', nextUpdateAt: '2027-09-08T14:00:00.000Z' };
  const openIncident = async () => {
    const { incident } = await api('/api/app/incidents', 'POST', { title: 'Autosave integrity', components: [{ componentId: component.id, state: 'Major outage', relationship: 'Primary' }] });
    await api(`/api/app/incidents/${incident.id}/draft`, 'PUT', initial);
    await page.goto(`${appUrl}/app/incidents/${incident.id}`);
    await operatorHydrated(page); await page.waitForLoadState('networkidle'); await saved();
    return incident;
  };
  const assertPrivateUnsaved = async () => {
    assert.equal(await page.getByRole('button', { name: /^(Publish update|Schedule update|Publish historical update)$/ }).isEnabled(), false);
    assert.equal(await page.locator('.autosave-status.is-saved').count(), 0);
  };
  await assertAutosaveDuringRefresh({ page, api, openIncident, assertPrivateUnsaved, initial }, t);
  await assertQueuedAutosaveDeadline({ page, api, openIncident, assertPrivateUnsaved, initial }, t);
}
function configuredDateTimeInput(iso, timezone) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const part = kind => parts.find(entry => entry.type === kind).value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}



// Delay only delivery of a real native GET, so a private-note refresh overlaps
// the draft debounce without changing either response bytes or write behavior.
async function assertAutosaveDuringRefresh({ page, api, openIncident, assertPrivateUnsaved, initial }, t) {
  const incident = await openIncident();
  const endpoint = `/api/app/incidents/${incident.id}`;
  const composer = incidentComposer(page);
  const field = composer.audience;
  const audience = "Latest audience while the private note refresh is pending";
  const note = "Native internal note overlapping an unsaved draft";
  const timings = {};
  let releaseRefresh, refreshEntered;
  const released = new Promise(resolve => { releaseRefresh = resolve; });
  const entered = new Promise(resolve => { refreshEntered = resolve; });
  const recordRequest = request => {
    if (request.method() === "PUT" && request.url().endsWith(`${endpoint}/draft`)) {
      timings.putDispatched = Date.now();
      timings.putBytes = JSON.parse(request.postData());
    }
  };
  const recordResponse = response => {
    if (response.request().method() === "GET" && response.url().endsWith(endpoint) && !timings.refreshReceived) {
      timings.refreshReceived = Date.now();
    }
    if (response.request().method() === "PUT" && response.url().endsWith(`${endpoint}/draft`)) {
      timings.putAcknowledged = Date.now();
      timings.putStatus = response.status();
    }
  };
  page.on("request", recordRequest);
  page.on("response", recordResponse);
  await page.evaluate(() => {
    window.autosaveRefreshProbe = {};
    document.querySelector('[aria-label="Who is affected"]').addEventListener("input", () => {
      window.autosaveRefreshProbe.finalEdit = Date.now();
        window.autosaveRefreshProbe.finalEditPerformance = performance.now();
    }, { once: true });
    const observer = new MutationObserver(() => {
      if (document.querySelector(".autosave-status")?.textContent === "Draft saved" && window.autosaveRefreshProbe.finalEdit) {
        window.autosaveRefreshProbe.saved = Date.now();
          window.autosaveRefreshProbe.savedPerformance = performance.now();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await observeAutosaveAcknowledgement(endpoint + "/draft", "autosaveRefreshProbe");
  let handled = false; // Installed until unrouteAll: a one-shot route can strand a paused request.
  await page.route(`**${endpoint}`, async route => {
    if (handled) return route.continue();
    handled = true;
    assert.equal(route.request().method(), "GET");
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    refreshEntered();
    await released;
    timings.refreshDelivered = Date.now();
    await route.fulfill({ response });
  });
  try {
    await composer.privateActions();
    await page.getByLabel("Internal note").fill(note);
    await page.getByRole("button", { name: "Save internal note", exact: true }).click();
    await entered;
    await page.getByText("Internal note saved.", { exact: true }).waitFor();
    await field.fill(audience);
    timings.finalEdit = await page.evaluate(() => window.autosaveRefreshProbe.finalEdit);
    await assertPrivateUnsaved();
    // Deliver the held refresh while this draft is unsaved. Do not assume a
    // particular debounce duration: faster autosaves can finish within a second.
    releaseRefresh();
    let deadlineError;
    await page.getByText("Draft saved", { exact: true })
      .waitFor({ timeout: Math.max(1, timings.finalEdit + 2000 - Date.now()) })
      .catch(error => { deadlineError = error; });
    // Preserve timing and persisted-byte evidence even when the deadline fails.
    await page.getByText("Draft saved", { exact: true }).waitFor();
    Object.assign(timings, await page.evaluate(() => window.autosaveRefreshProbe));
    t.diagnostic(JSON.stringify({ phase: "acknowledged", ...timings, elapsedToSaved: timings.saved - timings.finalEdit, deadlinePassed: !deadlineError }));
    await page.unrouteAll({ behavior: "wait" });
    const stored = (await api(endpoint)).incident;
    timings.storedDraft = stored.draft;
    assert.equal(stored.internalNotes[0].body, note);
    assert.deepEqual(timings.putBytes, { ...initial, affectedAudience: audience, componentChanges: [] });
    for (const [key, value] of Object.entries(timings.putBytes)) assert.deepEqual(stored.draft[key], value);
    await page.reload();
    await page.getByText("Draft saved", { exact: true }).waitFor();
    timings.reloadedDraft = {
      lifecycle: await composer.status(),
      affectedAudience: await field.inputValue(),
      customerImpact: await composer.impact.inputValue(),
      whatStillWorks: await composer.stillWorks.inputValue(),
      details: await composer.details.inputValue(),
      nextUpdateAt: await composer.nextUpdate.inputValue(),
    };
    t.diagnostic(JSON.stringify({ ...timings, elapsedToSaved: timings.saved - timings.finalEdit, deadlinePassed: !deadlineError }));
    const { settings } = await api("/api/app/page-settings");
    const { componentChanges, ...textFields } = timings.putBytes;
    assert.deepEqual((await api(endpoint)).incident.draft.componentChanges, componentChanges, "reload retains the acknowledged staged choices");
    assert.deepEqual(timings.reloadedDraft, { ...textFields, nextUpdateAt: configuredDateTimeInput(timings.putBytes.nextUpdateAt, settings.timezone) }, "reload restores every draft field, displaying the saved instant in the page zone");
    assert.equal(timings.putStatus, 200);
    assert.ok(timings.refreshDelivered > timings.finalEdit && timings.refreshReceived < timings.putDispatched);
    t.diagnostic(JSON.stringify({ phase: "acknowledgement-observers", nodeEventAfterSavedMs: timings.putAcknowledged - timings.saved, browserAckBeforeSavedMs: timings.savedPerformance - timings.nativeAcknowledgedPerformance }));
    assert.ok(timings.savedPerformance >= timings.nativeAcknowledgedPerformance, "Saved must follow the native acknowledgement in the browser");
    assert.ok(!deadlineError && timings.saved - timings.finalEdit < 2000, "an unrelated incident refresh must not postpone saving beyond two seconds");
  } finally {
    releaseRefresh();
    page.off("request", recordRequest);
    page.off("response", recordResponse);
    await page.unrouteAll({ behavior: "wait" });
  }
}

// Hold only an acknowledgement from a real native PUT. The latest edit must
// keep its original debounce while the earlier write retains serialization.
async function assertQueuedAutosaveDeadline({ page, api, openIncident, assertPrivateUnsaved, initial }, t) {
  const incident = await openIncident();
  const endpoint = `/api/app/incidents/${incident.id}/draft`;
  const field = incidentComposer(page).audience;
  const earlier = "Earlier audience awaiting its native acknowledgement";
  const latest = "Latest audience edited while the earlier save is pending";
  const writes = [];
  const timings = {};
  let releaseFirst, enteredFirst;
  const release = new Promise(resolve => { releaseFirst = resolve; });
  const entered = new Promise(resolve => { enteredFirst = resolve; });
  const onRequest = request => {
    if (request.method() === "PUT" && request.url().endsWith(endpoint)) writes.push({ at: Date.now(), body: JSON.parse(request.postData()) });
  };
  const onResponse = response => {
    if (response.request().method() === "PUT" && response.url().endsWith(endpoint)) {
      const body = JSON.parse(response.request().postData());
      timings[body.affectedAudience === earlier ? "earlierAcknowledged" : "latestAcknowledged"] = Date.now();
      assert.equal(response.status(), 200);
    }
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  let handled = false; // Installed until unrouteAll: a one-shot route can strand a paused request.
  await page.route(`**${endpoint}`, async route => {
    if (handled) return route.continue();
    handled = true;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    timings.earlierPersisted = Date.now();
    enteredFirst();
    await release;
    await route.fulfill({ response });
  });
  try {
    await observeAutosaveAcknowledgement(endpoint, "queuedAutosaveProbe");
    await field.fill(earlier);
    await entered;
    await field.fill("Intermediate audience coalesced into the latest edit");
    await page.evaluate(() => {
      window.queuedAutosaveProbe ??= {};
      document.querySelector('[aria-label="Who is affected"]').addEventListener("input", () => {
        window.queuedAutosaveProbe.finalEdit = Date.now();
        window.queuedAutosaveProbe.finalEditPerformance = performance.now();
      }, { once: true });
      const observer = new MutationObserver(() => {
        if (window.queuedAutosaveProbe.finalEdit && document.querySelector(".autosave-status")?.textContent === "Draft saved") {
          window.queuedAutosaveProbe.saved = Date.now();
          window.queuedAutosaveProbe.savedPerformance = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await field.fill(latest);
    timings.finalEdit = await page.evaluate(() => window.queuedAutosaveProbe.finalEdit);
    await assertPrivateUnsaved();
    assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, earlier);
    await page.waitForTimeout(Math.max(0, timings.finalEdit + 1000 - Date.now()));
    assert.equal(writes.length, 1, "the latest edit must not overtake the unacknowledged write");
    releaseFirst();
    let deadlineError;
    await page.getByText("Draft saved", { exact: true }).waitFor({ timeout: Math.max(1, timings.finalEdit + 2000 - Date.now()) }).catch(error => { deadlineError = error; });
    await page.getByText("Draft saved", { exact: true }).waitFor();
    Object.assign(timings, await page.evaluate(() => window.queuedAutosaveProbe));
    timings.writes = writes;
    timings.elapsedToSaved = timings.saved - timings.finalEdit;
    timings.deadlinePassed = !deadlineError;
    t.diagnostic(JSON.stringify(timings));
    assert.equal(writes.length, 2, "pending edits must coalesce into one latest write");
    assert.deepEqual(writes[1].body, { ...initial, affectedAudience: latest, componentChanges: [] });
    assert.ok(writes[1].at >= timings.earlierAcknowledged, "writes must remain serialized");
    t.diagnostic(JSON.stringify({ phase: "acknowledgement-observers", nodeEventAfterSavedMs: timings.latestAcknowledged - timings.saved, browserAckBeforeSavedMs: timings.savedPerformance - timings.nativeAcknowledgedPerformance }));
    assert.ok(timings.savedPerformance >= timings.nativeAcknowledgedPerformance, "Draft saved must follow the native acknowledgement in the browser");
    const stored = (await api(`/api/app/incidents/${incident.id}`)).incident.draft;
    for (const [key, value] of Object.entries(writes[1].body)) assert.deepEqual(stored[key], value);
    await page.reload();
    await page.getByText("Draft saved", { exact: true }).waitFor();
    assert.equal(await field.inputValue(), latest);
    assert.ok(!deadlineError && timings.elapsedToSaved < 2000, "waiting for an earlier save must count toward the latest edit's two-second deadline");
  } finally {
    releaseFirst();
    page.off("request", onRequest);
    page.off("response", onResponse);
    await page.unrouteAll({ behavior: "wait" });
  }
}
// One operator day: configure, draft, recover a failed save, resolve a
// concurrent edit, schedule a publication, communicate recovery, and report.
test('INCIDENT-001 INCIDENT-004 UPDATE-002 UPDATE-005 UPDATE-006 UPDATE-011 UPDATE-013 DRAFT-002 DRAFT-003 HIST-002 AGENT-005 SETUP-001 NOTIFY-019 — compiled visual edits and the operator publication journey', { timeout: 600_000 }, async t => {
  await verifyCompiledEdits();
  await page.goto(`${appUrl}/app`); await operatorHydrated(page);
  await page.getByRole('region', { name: 'Your public page' }).waitFor();
  const { live } = await api('/api/app/overview/live');
  assert.equal(live.sender.state, 'local', 'local mail never claims provider verification');
  await page.goto(`${appUrl}/app/settings#writing`); await operatorHydrated(page);
  const tone = 'Lead with customer impact and the next update commitment.';
  await page.getByRole('textbox', { name: 'Tone instructions', exact: true }).fill(tone);
  await page.getByRole('status').filter({ hasText: /^Saved · live$/ }).waitFor();
  await page.reload(); await operatorHydrated(page);
  try { assert.equal(await page.getByRole('textbox', { name: 'Tone instructions', exact: true }).inputValue(), tone); }
  catch (cause) {
    const current = new URL(page.url());
    process.stderr.write(`Writing reload diagnostic: ${current.pathname}${current.hash}; ${JSON.stringify(await page.locator('h1, .ai-assistance-card, [role=alert]').allTextContents())}\n`);
    throw cause;
  }
  await page.getByRole('link', { name: 'Notifications', exact: true }).click();
  await page.getByLabel('Sender display name', { exact: true }).fill('Journey status');
  await page.getByLabel('Reply-to address', { exact: true }).fill('support@journey.example');
  await page.getByLabel('Subject prefix', { exact: true }).fill('[Journey status]');
  await page.getByRole('status').filter({ hasText: /^Saved · live$/ }).waitFor();
  await page.reload(); await operatorHydrated(page);
  assert.equal(await page.getByLabel('Reply-to address', { exact: true }).inputValue(), 'support@journey.example');


  await page.goto(`${appUrl}/app/components`); await operatorHydrated(page);
  if (!await page.getByRole('dialog').count()) await page.getByRole('button', { name: 'Add component', exact: true }).first().click();
  await page.getByLabel('Component name', { exact: true }).fill('Journey checkout API');
  await page.getByLabel(/Description/).fill('Customer checkout and card authorization.');
  await page.getByRole('button', { name: 'Create component', exact: true }).click();
  await page.locator('.component-row-summary').getByText('Journey checkout API', { exact: true }).waitFor();
  const component = (await api('/api/app/components')).components.find(row => row.name === 'Journey checkout API');
  assert.ok(component);

  await page.goto(`${appUrl}/app/incidents/new`); await operatorHydrated(page);
  const form = newIncidentForm(page);
  await form.title.fill('Checkout requests are delayed');
  await form.impact.fill('Card authorizations are timing out.');
  await form.addComponent(component.name);
  await form.componentState(component.name, 'Major outage');
  await form.audience.fill('Customers checking out in the US.');
  await form.nextUpdate.fill('2027-09-08T14:00');
  await form.moreOptions();
  await page.getByLabel('Details', { exact: true }).fill('Follow https://support.example.test/checkout for recovery advice.');
  await page.getByRole('button', { name: 'Save as private draft', exact: true }).click();
  await page.waitForURL(url => /^\/app\/incidents\/[0-9A-Z]{26}$/.test(url.pathname));
  const id = new URL(page.url()).pathname.split('/').at(-1);
  await saved();
  let incident = await readIncident(id);
  assert.equal(incident.updates.length, 0, 'saving does not publish');
  const composer = incidentComposer(page);
  await page.reload(); await operatorHydrated(page); await saved();
  assert.equal(await composer.impact.inputValue(), incident.draft.customerImpact);
  await assertAutosaveIntegrity(component, t);
  await page.goto(`${appUrl}/app/incidents/${id}`); await operatorHydrated(page); await saved();


  // The displayed draft survives a transport failure and an explicit retry.
  const endpoint = `**/api/app/incidents/${id}/draft`;
  let failed = false;
  await page.route(endpoint, async route => {
    if (!failed && route.request().method() === 'PUT') { failed = true; await route.abort(); }
    else await route.continue();
  });
  await composer.impact.fill('Some card authorizations fail; existing orders remain safe.');
  await page.locator('.autosave-status.is-error').waitFor();
  assert.equal(await composer.publish.isEnabled(), false, 'unsaved bytes cannot publish');
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await saved(); await page.unroute(endpoint);
  await page.reload(); await operatorHydrated(page); await saved();
  assert.equal(await composer.impact.inputValue(), 'Some card authorizations fail; existing orders remain safe.');

  // Two real tabs must not silently replace each other's acknowledged draft.
  const stale = await browserContext.newPage();
  try {
    await stale.goto(page.url()); await operatorHydrated(stale);
    await stale.locator('.autosave-status.is-saved').waitFor();
    await composer.audience.fill('US customers paying by card.'); await saved();
    await incidentComposer(stale).audience.fill('A stale tab must not erase the newer audience.');
    await stale.locator('.autosave-status.is-error').waitFor();
    assert.equal((await readIncident(id)).draft.affectedAudience, 'US customers paying by card.');
    assert.equal(await incidentComposer(stale).publish.isEnabled(), false);
  } finally { await stale.close(); }

  await composer.moreOptions();
  await page.getByRole('radio', { name: 'Schedule', exact: true }).check();
  await page.getByLabel('Scheduled publication date and time').fill('2027-09-08T13:30');
  await page.getByRole('button', { name: 'Schedule update', exact: true }).click();
  await page.getByText('Update scheduled. It stays private until then.', { exact: true }).waitFor();
  await page.reload(); await operatorHydrated(page); await saved();
  await composer.moreOptions();
  assert.equal(await page.getByLabel('Scheduled publication date and time').inputValue(), '2027-09-08T13:30');
  assert.ok((await readIncident(id)).draft.scheduledPublishAt);
  await composer.impact.fill('Checkout retries can succeed while we restore capacity.'); await saved();
  assert.equal((await readIncident(id)).draft.scheduledPublishAt, null, 'editing revokes a prior schedule');
  await page.getByRole('radio', { name: 'Now', exact: true }).check();
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.waitForFunction(({ impact, replyTo }) => {
    const panel = document.querySelector('.preview-panel');
    return panel?.textContent.includes(impact) && panel.textContent.includes(replyTo);
  }, { impact: 'Checkout retries can succeed while we restore capacity.', replyTo: 'support@journey.example' });
  assert.ok((await page.locator('.preview-panel h3').textContent()).startsWith('[Journey status]'));
  await page.getByRole('button', { name: 'Suggest update', exact: true }).click();
  await page.locator('.ai-suggestion [role=status]').filter({ hasText: /503|intentionally unavailable/i }).waitFor();
  assert.equal(await composer.publish.isEnabled(), true, 'a failed suggestion leaves ordinary publication usable');
  await composer.publish.click();
  await page.getByText('Update published.', { exact: true }).waitFor();
  incident = await readIncident(id);
  const first = incident.updates[0];
  assert.equal(first.customerImpact, 'Checkout retries can succeed while we restore capacity.');
  await waitForPublicIncident(incident.reference, first.customerImpact);
  assert.equal(await composer.impact.inputValue(), '', 'the next update begins with a fresh draft');

  await composer.privateActions();
  const note = 'The database team is privately investigating a connection pool.';
  await page.getByLabel('Internal note', { exact: true }).fill(note);
  await page.getByRole('button', { name: 'Save internal note', exact: true }).click();
  await page.getByText('Internal note saved.', { exact: true }).waitFor();
  assert.ok((await readIncident(id)).internalNotes.some(row => row.body === note));
  assert.equal((await (await fetch(`${pageUrl}/incidents/${incident.reference}`)).text()).includes(note), false);

  await composer.setStatus('Resolved');
  await composer.audience.fill('US customers paying by card.');
  await composer.impact.fill('Checkout authorizations are working normally.');
  await composer.moreOptions();
  await composer.details.fill('Follow https://support.example.test/checkout for any remaining questions.');
  await saved();
  assert.equal(await composer.nextUpdate.count(), 0, 'resolution needs no further update promise');
  await composer.publish.click(); await page.getByText('Update published.', { exact: true }).waitFor();
  incident = await readIncident(id);
  assert.equal(incident.lifecycle, 'Resolved');
  assert.deepEqual(incident.updates.find(row => row.id === first.id), first, 'later publications preserve the original update');
  await waitForPublicIncident(incident.reference, 'Checkout authorizations are working normally.');
  await page.goto(`${pageUrl}/incidents/${incident.reference}`);
  await page.getByRole('link', { name: 'https://support.example.test/checkout', exact: true }).first().waitFor();

  // The same operator finishes the private report and publishes it deliberately.
  await page.goto(`${appUrl}/app/incidents/${id}`); await operatorHydrated(page);
  const report = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Post-incident report', exact: true }) });
  await page.getByRole('button', { name: 'Draft report', exact: true }).click();
  for (const [name, value] of Object.entries({ Summary: 'Checkout delays have been resolved.', Timeline: 'Requests failed before the database pool was restored.', Cause: 'The checkout connection pool exhausted its capacity.', Remediation: 'We restored capacity and added pool saturation alerts.' })) await report.getByLabel(name, { exact: true }).fill(value);
  const saving = page.waitForResponse(response => response.url().endsWith(`/incidents/${id}/report`) && response.request().method() === 'PUT');
  await report.getByRole('button', { name: 'Save report', exact: true }).click(); assert.equal((await saving).status(), 200);
  await page.reload(); await operatorHydrated(page);
  assert.equal(await report.getByRole('textbox', { name: 'Cause', exact: true }).inputValue(), 'The checkout connection pool exhausted its capacity.');
  assert.equal((await (await fetch(`${pageUrl}/incidents/${incident.reference}`)).text()).includes('Checkout delays have been resolved.'), false, 'a saved report stays private');
  const publishing = page.waitForResponse(response => response.url().endsWith(`/incidents/${id}/report/publish`) && response.request().method() === 'POST');
  await report.getByRole('button', { name: 'Publish report', exact: true }).click(); assert.equal((await publishing).status(), 200);
  await waitForPublicIncident(incident.reference, 'Checkout delays have been resolved.');

  const destination = 'https://notify.example.test/journey-erasure';
  const subscriber = (await api('/api/app/subscribers/webhook', 'POST', { destination, contactEmail: 'private-reader@example.test', componentIds: [] })).subscriber;
  await page.goto(`${appUrl}/app/subscribers`); await operatorHydrated(page);
  const row = page.getByRole('row').filter({ hasText: destination });
  page.once('dialog', dialog => dialog.dismiss()); await row.getByRole('button', { name: 'Remove', exact: true }).click();
  assert.equal((await api('/api/app/subscribers')).subscribers.find(item => item.id === subscriber.id).destination, destination);
  page.once('dialog', dialog => dialog.accept()); await row.getByRole('button', { name: 'Remove', exact: true }).click();
  await row.waitFor({ state: 'detached' });
  const erased = (await api('/api/app/subscribers')).subscribers.find(item => item.id === subscriber.id);
  assert.notEqual(erased.destination, destination, 'erasure removes the private destination');
  assert.equal(erased.contactEmail, null); assert.equal(erased.state, 'deactivated');

  if (process.env.LAMP_SCREENSHOTS) { await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.LAMP_SCREENSHOTS, '1440-operator-journey.png'), fullPage: true }); }
});

test('INCIDENT-001 AGENT-004 MOBILE-001 — 390-wide owner sign-in, alert review, publication, resolution and maintenance smoke', { timeout: 600_000 }, async () => {
  await phoneDeskFlow({ page, appUrl, pageUrl, appFetch, signInLink: async () => execFileSync(process.execPath, [resolve('scripts/signin-link.mjs'), '--email', 'operator@example.test', '--origin', appUrl, '--config', configPath, '--persist-to', statePath], { cwd: terminalDirectory, env: process.env, encoding: 'utf8' }).trim() });
});


test('THEME-001 — owner publishes branded themes and layouts within the page budget', { timeout: 600_000 }, async t => {
  await themeOwnerJourney({ appFetch, appUrl, pageUrl, sessionId, cookieName: sessionCookieName(appUrl), diagnostic: message => t.diagnostic(message) });
});

test('DEP-001 DEP-002 — owner configures upstream reports under Settings', { timeout: 300_000 }, async () => {
  const buyer=(await api('/api/app/components','POST',{name:'synthetic-lamp-dependent-service',description:'',groupId:null,internal:false,displayOrder:0,note:''})).component;
  const template=(await api('/api/app/incident-templates','POST',{name:'synthetic-lamp-upstream-template',lifecycle:'Investigating',affectedAudience:'synthetic-lamp-customers',customerImpact:'synthetic-lamp-review-impact',whatStillWorks:'synthetic-lamp-other-service',details:'synthetic-lamp-review-first',nextUpdateOffsetMinutes:60,components:[{componentId:buyer.id,state:'Major outage',relationship:'Dependent'}]})).template;
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(appUrl+'/app/settings#dependencies');await operatorHydrated(page);
  await page.getByRole('heading',{name:'Follow vendor status',exact:true}).waitFor();
  await page.getByLabel('Vendor',{exact:true}).selectOption('aws');
  await page.getByLabel('Vendor component name',{exact:true}).fill('synthetic-lamp-cloud-compute');
  await page.getByRole('button',{name:'Follow vendor status',exact:true}).click();
  const row=page.getByRole('article',{name:'synthetic-lamp-cloud-compute',exact:true});
  await row.waitFor();
  assert.equal(await row.getByLabel('Dependency behavior',{exact:true}).inputValue(),'show');
  assert.ok((await row.innerText()).includes('Reported by AWS'));
  assert.equal(await row.getByRole('link',{name:'AWS',exact:true}).getAttribute('href'),'https://status.aws.amazon.com/');
  await row.getByText('State mapping',{exact:true}).click();
  assert.ok((await row.innerText()).includes('Major outage'));
  await row.getByLabel('Dependency behavior',{exact:true}).selectOption('draft');
  await row.getByLabel('Upstream-provider template',{exact:true}).selectOption(template.id);
  await row.getByLabel(buyer.name,{exact:true}).check();
  await row.getByRole('button',{name:'Save dependency behavior',exact:true}).click();
  await row.getByText('Dependency behavior saved.',{exact:true}).waitFor();
  await page.reload();await operatorHydrated(page);await row.waitFor();
  assert.equal(await row.getByLabel('Dependency behavior',{exact:true}).inputValue(),'draft');
  assert.equal(await row.getByLabel('Upstream-provider template',{exact:true}).inputValue(),template.id);
  assert.equal(await row.getByLabel(buyer.name,{exact:true}).isChecked(),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const fieldSizes=await row.locator('input,select,button,p').evaluateAll(elements=>elements.map(element=>parseFloat(getComputedStyle(element).fontSize)));
  assert.ok(fieldSizes.every(size=>size>=13));
  if(process.env.LAMP_DEP_SCREENSHOTS) {
    await mkdir(process.env.LAMP_DEP_SCREENSHOTS,{recursive:true});
    for(const width of [1440,390]) {await page.setViewportSize({width,height:1000});await page.screenshot({path:join(process.env.LAMP_DEP_SCREENSHOTS,`settings-dependencies-${width}.png`),fullPage:true});}
    await page.setViewportSize({width:1440,height:1000});
  }
  await row.getByLabel('Dependency behavior',{exact:true}).selectOption('rollup');
  await row.getByRole('button',{name:'Save dependency behavior',exact:true}).click();
  await row.getByText('Dependency behavior saved.',{exact:true}).waitFor();
  const persisted=(await api('/api/app/dependencies')).dependencies.find(value=>value.name==='synthetic-lamp-cloud-compute');
  assert.equal(persisted.mode,'rollup');
  await row.getByRole('button',{name:'Stop following',exact:true}).click();
  await row.waitFor({state:'detached'});
  await page.setViewportSize({width:1440,height:1000});
});
