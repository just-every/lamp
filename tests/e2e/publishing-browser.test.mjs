import { requestHeaders } from "../helpers/request-headers.mjs";
import { withDraftVersion } from "./draft-version-helper.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

import { contract } from "../contract.mjs";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { appOrigin, pageOrigin } from "./helpers/hosts.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { saveAndConfirmDraft } from "./saved-draft-helper.mjs";
import { isolatedWranglerConfig } from "../helpers/wrangler-config.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";
import { postIncidentReportFlow } from "./helpers/post-incident-report-flow.mjs";
import { emailBrandingBrowserFlow } from "./helpers/email-branding-browser-flow.mjs";
import { phoneDeskFlow } from "./helpers/phone-desk-flow.mjs";
import { subscriberReportingBrowserFlow } from "./helpers/subscriber-reporting-browser-flow.mjs";
import { auditLogFlow } from "./helpers/audit-log-flow.mjs";
import { operatorHydrated } from "./helpers/operator-hydrated.mjs";

let appUrl = "";
let pageUrl = "";
let testPort;
let aiPort;
let statePath;
let viteCachePath;
let fixtureConfig;
let configPath;
const defaultConfigPath = resolve("wrangler.jsonc");
let server;
let sessionId;
let browser;
let browserContext;
let page;
let serverOutput = "";
let failingAiServer;
let autosaveIncidentId;
let originalVisualSource;

function configWithAiProvider(config) {
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
  await waitForWorker({ origin: appUrl, child: server, output: () => `${serverOutput}\nState: ${statePath}`, label: "Publishing browser Worker" });
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

async function createBrowserIncident() {
  const component = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({ groupId: null, name: "Browser API", description: "Browser publishing contract component.", internal: false, displayOrder: 1, note: "" }) });
  assert.equal(component.status, 201);
  const componentId = (await component.json()).component.id;
  const incident = await appFetch("/api/app/incidents", { method: "POST", body: JSON.stringify({ title: "Browser autosave incident", components: [{ componentId, state: "Major outage", relationship: "Primary" }] }) });
  assert.equal(incident.status, 201);
  return (await incident.json()).incident;
}

before(async () => {
  testPort = await reservePort({ label: "Publishing browser Worker" });
  aiPort = await reservePort({ label: "Publishing browser AI provider" });
  appUrl = appOrigin(testPort);
  pageUrl = pageOrigin(testPort);
  statePath = await mkdtemp(join(tmpdir(), "lamp-publishing-browser-d1-"));
  viteCachePath = await mkdtemp(join(tmpdir(), "lamp-publishing-browser-vite-"));
  // The fixture config lives in its own directory so a checkout's `.dev.vars` (for example its AI provider) cannot override it.
  fixtureConfig = isolatedWranglerConfig();
  configPath = fixtureConfig.path;
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", defaultConfigPath, "--persist-to", statePath], { cwd: process.cwd(), stdio: "pipe" });
  if (process.env.RER_VISUAL_HEADING_PROBE === '1') {
    const source = resolve('src/editor/visual-edits.json');
    originalVisualSource = readFileSync(source);
    // The first verification pass covers the complete owner snapshot. This pass
    // isolates the probe so an owner's edit to the same heading cannot conflict.
    const snapshot = {revision:1,edits:[{id:'test-heading-probe',revision:1,path:'/app',target:{selector:'h1:nth-child(2)',tag:'h1',role:'',beforeText:'Overview'},change:{text:'Workspace overview'}}]};
    writeFileSync(source,JSON.stringify(snapshot,null,2)+'\n');
  }
  await startWorker(configPath);
  sessionId = await insertRealOperatorSession({ persistTo: statePath });
  if (process.env.RER_VISUAL_HEADING_PROBE === '1') execFileSync('pnpm',['exec','wrangler','d1','execute','DB','--local','--config',defaultConfigPath,'--persist-to',statePath,'--command',"UPDATE operators SET is_setup_operator=0 WHERE id='01J00000000000000000000001'"],{stdio:'pipe'});
  browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  await openAuthenticatedPage();
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
  await Promise.all([rm(statePath, { recursive: true, force: true }), rm(viteCachePath, { recursive: true, force: true }), fixtureConfig?.cleanup()]);
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

test("compiled visual edits survive actual operator navigation and reload", async () => {
  const snapshot = JSON.parse(readFileSync(resolve('src/editor/visual-edits.json'),'utf8'));
  const errors = [], recordError = error => errors.push(error.message);
  page.on('pageerror',recordError);
  const closeEmptyComponentForm = async () => {
    if (new URL(page.url()).pathname !== '/app/components') return;
    await page.getByRole('heading', { name: 'Add component', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  };
  try {
    const paths = [...new Set(['/app','/app/components','/app/subscribers',...snapshot.edits.map(edit => edit.path)])];
    for (const path of paths) {
      await page.goto(appUrl + path, { waitUntil: 'networkidle' });
      await operatorHydrated(page);
      await page.locator('.operator-navigation').waitFor();
      await closeEmptyComponentForm();
      const expected = snapshot.edits.filter(edit => edit.target.navigation || edit.path === path);
      const check = async () => {
        for (const edit of expected) await page.waitForFunction(edit => {
          const matches = edit.target.navigation
            ? [...document.querySelectorAll('nav a[href]')].filter(link => new URL(link.href).pathname === edit.target.navigation.href)
            : [...document.querySelectorAll(edit.target.selector)];
          if (matches.length !== 1) return false;
          const element = matches[0];
          const text = [...element.childNodes].length ? element.textContent.replace(/\s+/g,' ').trim() : '';
          if (edit.change.text !== undefined && text !== edit.change.text.replace(/\s+/g,' ').trim()) return false;
          const probe = document.createElement('div');
          for (const [name,value] of Object.entries(edit.change.styles || {})) {
            probe.style.setProperty(name,value);
            if (element.style.getPropertyValue(name) !== probe.style.getPropertyValue(name)) return false;
          }
          return true;
        },edit);
      };
      await check();
      const stamp = await page.evaluate(() => performance.timeOrigin);
      const next = path === '/app/components' ? '/app/subscribers' : '/app/components';
      await page.locator(`.operator-navigation a[href="${next}"]`).click();
      await page.waitForURL(url => url.pathname === next);
      assert.equal(await page.evaluate(() => performance.timeOrigin),stamp,'navigation remains within the running app');
      await closeEmptyComponentForm();
      await page.locator(`.operator-navigation a[href="${path}"]`).count().then(async count => { if (count === 1) { await page.locator(`.operator-navigation a[href="${path}"]`).click(); await page.waitForURL(url => url.pathname === path); } else await page.goto(appUrl + path, { waitUntil: 'networkidle' }); });
      await check();
      await page.reload(); await page.locator('.operator-navigation').waitFor(); await check();
    }
    if (process.env.RER_VISUAL_HEADING_PROBE === '1') assert.equal(await page.locator('[data-rer-editor]').count(),0,'compiled page edits work for a non-editor operator');
    assert.deepEqual(errors,[],'compiled edits retain a healthy application runtime');
  } finally { page.off('pageerror',recordError); }
});

contract("INCIDENT-001", "AGENT-004 MOBILE-001 — an operator can start empty, publish and resolve, then run the full alert-to-resolution phone desk", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appUrl}/app/components`);
  await page.getByRole("heading", { name: "Add component" }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the narrow component drawer must not introduce horizontal page overflow");
  await page.getByLabel("Component name").fill("Journey API");
  await page.getByLabel(/Description/).fill("Customer API used for the empty-product incident journey.");
  await page.getByRole("button", { name: "Create component" }).click();
  await page.locator(".component-row-summary").getByText("Journey API", { exact: true }).waitFor();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${appUrl}/app/incidents`);
  await operatorHydrated(page);
  await page.getByRole("heading", { name: "Record the situation before communicating it" }).waitFor();
  await page.getByLabel("Incident title").fill("Journey API request failures");
  await page.getByLabel("Affected component 1").selectOption({ label: "Journey API" });
  await page.getByLabel("Component status 1").selectOption("Major outage");
  await page.getByRole("button", { name: "Create incident draft" }).click();
  await page.getByRole("heading", { name: "Compose public update" }).waitFor();

  const reference = await page.locator(".incident-context .eyebrow").textContent();
  assert.match(reference ?? "", /^INC-\d+$/);
  await page.locator("label", { hasText: "Who is affected" }).locator("textarea").fill("Journey API customers.");
  await page.locator("label", { hasText: "What is the impact" }).locator("textarea").fill("Requests to Journey API are failing.");
  await page.locator("label", { hasText: "What still works" }).locator("textarea").fill("The dashboard remains available.");
  await page.getByLabel("Next update date and time").fill("2027-09-08T14:00");
  await page.locator("label", { hasText: "Additional details" }).locator("textarea").fill("Operators are restoring request capacity.");
  await page.getByText("Public page", { exact: true }).waitFor();
  await page.getByText("Email preview", { exact: true }).click();
  await page.getByText("Notification email", { exact: true }).waitFor();
  await page.waitForTimeout(1_500);
  await page.getByText("Draft saved", { exact: true }).waitFor({ timeout: 2_000 });
  await page.getByRole("button", { name: "Publish update" }).click();
  await page.getByText("Update published.").waitFor();
  await waitForPublicIncident(reference, "Requests to Journey API are failing.");

  assert.equal(await page.locator("label", { hasText: "Who is affected" }).locator("textarea").inputValue(), "", "publication starts a blank next-update draft");
  await page.getByLabel("Lifecycle").selectOption("Resolved");
  await page.locator("label", { hasText: "Who is affected" }).locator("textarea").fill("Journey API customers.");
  await page.locator("label", { hasText: "What is the impact" }).locator("textarea").fill("Journey API requests are restored.");
  await page.waitForTimeout(1_500);
  await page.getByText("Draft saved", { exact: true }).waitFor({ timeout: 2000 });
  await page.getByRole("button", { name: "Publish update" }).click();
  await waitForPublicIncident(reference, "Resolved");
  await page.goto(`${pageUrl}/incidents/${reference}`);
  await page.getByText("Journey API request failures", { exact: true }).waitFor();
  assert.match(await page.locator("body").innerText(), /Resolved/);
  await phoneDeskFlow({ page, appUrl, pageUrl, appFetch, signInLink: async () => execFileSync(process.execPath, ["scripts/signin-link.mjs", "--email", "operator@example.test", "--origin", appUrl, "--config", configPath, "--persist-to", statePath], { env: process.env, encoding: "utf8" }).trim() });
});

contract("INCIDENT-004", "operator controls create internal notes, retroactive records, corrections, review decisions, and a reasoned deletion", async (t) => {
  // Own this prerequisite so the case also runs alone; INCIDENT-001 still starts empty.
  const componentResponse = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({ groupId: null, name: "Journey API", description: "Customer API used for the empty-product incident journey.", internal: false, displayOrder: 1, note: "" }) });
  assert.equal(componentResponse.status, 201);
  const { component } = await componentResponse.json();
  const localInput = (offsetMs) => page.evaluate((offset) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now() + offset));
    const part = (kind) => parts.find(entry => entry.type === kind).value;
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  }, offsetMs);
  await page.goto(`${appUrl}/app/incidents`);
  await page.getByRole("button", { name: "Create incident", exact: true }).click();
  await page.getByRole("heading", { name: "Record the situation before communicating it" }).waitFor();
  await page.getByLabel("Incident title").fill("Historical correction controls");
  await page.getByLabel("Opened at").fill(await localInput(-2 * 60 * 60_000));
  await page.getByLabel("Affected component 1").selectOption(component.id);
  assert.equal(await page.getByLabel("Affected component 1").locator("option:checked").textContent(), "Journey API");
  await page.getByRole("button", { name: "Create incident draft" }).click();
  await page.getByRole("heading", { name: "Compose public update" }).waitFor();

  const incidentId = new URL(page.url()).pathname.split("/").at(-1);
  assert.ok(incidentId, "creating an incident must navigate to its operator record");
  await page.getByLabel("Internal note").fill("PRIVATE-OPERATOR-CONTEXT");
  await page.getByRole("button", { name: "Save internal note" }).click();
  await page.getByText("Internal note saved.", { exact: true }).waitFor();
  const nextUpdateLocal = await localInput(60 * 60_000);
  await saveAndConfirmDraft({ page, appFetch, incidentId, t,
    expected: { lifecycle: "Investigating", affectedAudience: "Historical API customers.", customerImpact: "An earlier condition delayed requests.", whatStillWorks: "", details: "", nextUpdateAt: new Date(`${nextUpdateLocal}:00-07:00`).toISOString() },
    edit: async () => {
      await page.locator("label", { hasText: "Who is affected" }).locator("textarea").fill("Historical API customers.");
      await page.locator("label", { hasText: "What is the impact" }).locator("textarea").fill("An earlier condition delayed requests.");
      await page.getByLabel("Next update date and time").fill(nextUpdateLocal);
    },
  });
  await page.getByText("Schedule or backdate", { exact: true }).click();
  await page.getByLabel("Historical publication date and time").fill(await localInput(-2 * 60_000));
  await page.getByRole("button", { name: "Publish historical update" }).click();
  await page.getByText("Historical update published. It did not notify subscribers.", { exact: true }).waitFor();
  const historical = await appFetch(`/api/app/incidents/${incidentId}`);
  const record = (await historical.json()).incident;
  assert.equal(record.updates.length, 1);
  assert.equal(record.internalNotes[0].body, "PRIVATE-OPERATOR-CONTEXT");

  await page.reload();
  await operatorHydrated(page);
  await page.getByRole("heading", { name: "Compose public update" }).waitFor();
  await saveAndConfirmDraft({ page, appFetch, incidentId, t,
    expected: { lifecycle: "Identified", affectedAudience: "Correction audience.", customerImpact: "", whatStillWorks: "", details: "", nextUpdateAt: null },
    edit: () => page.locator("label", { hasText: "Who is affected" }).locator("textarea").fill("Correction audience."),
  });
  await page.getByRole("button", { name: "Mark correction" }).click();
  await page.getByText("The draft will publish as a correction.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Review saved draft" }).click();
  await page.getByText("A different operator must review a saved draft.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Delete incident" }).click();
  await page.getByLabel("Deletion reason").fill("Created solely to exercise private operator controls.");
  await page.getByRole("button", { name: "Confirm deletion" }).click();
  await page.getByRole("heading", { name: "Incidents", exact: true }).waitFor();
  let deletionStatus = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    deletionStatus = (await appFetch(`/api/app/incidents/${incidentId}`)).status;
    if (deletionStatus === 404) break;
    await page.waitForTimeout(100);
  }
  assert.equal(deletionStatus, 404, "the deleted operator record must no longer be readable");
});

contract("UPDATE-005", "composer autosaves a changed draft in under two seconds and reloads the exact value", async () => {
  const incident = await createBrowserIncident();
  autosaveIncidentId = incident.id;
  await page.goto(`${appUrl}/app/incidents/${incident.id}`);
  await operatorHydrated(page);
  await page.getByRole("heading", { name: "Compose public update" }).waitFor();
  await page.locator("label", { hasText: "Who is affected" }).locator("textarea").fill("Browser contract customers.");
  await page.locator("label", { hasText: "What is the impact" }).locator("textarea").fill("Requests can fail during this condition.");
  await page.getByLabel("Next update date and time").fill("2027-09-08T13:41");
  const details = "BROWSER-AUTOSAVE-EXACT-VALUE";
  const changedAt = Date.now();
  await page.locator("label", { hasText: "Additional details" }).locator("textarea").fill(details);
  await page.getByText("Draft saved", { exact: true }).waitFor({ timeout: 2000 });
  assert.ok(Date.now() - changedAt < 2000, "the operator draft did not save within two seconds");
  await page.reload();
  await operatorHydrated(page);
  await page.getByRole("heading", { name: "Compose public update" }).waitFor();
  await assert.equal(await page.locator("label", { hasText: "Additional details" }).locator("textarea").inputValue(), details);
  assert.equal(await page.getByLabel("Next update date and time").inputValue(), "2027-09-08T13:41", "the datetime control presents the saved instant in the operator's configured local time");
  await page.getByLabel("Next update date and time").fill("2027-09-08T13:42");
  await page.getByText("Draft saved", { exact: true }).waitFor({ timeout: 2000 });
  const stored = await appFetch(`/api/app/incidents/${incident.id}`);
  assert.equal((await stored.json()).incident.draft.nextUpdateAt, "2027-09-08T20:42:00.000Z", "editing the page’s Los Angeles time preserves its UTC instant despite a Brisbane browser");
  assert.equal(await page.getByRole("button", { name: "Suggest update" }).count(), 0, "the absent provider must not expose an AI control");
});

contract("UPDATE-006", "the composer schedules publication separately from its next-update commitment", async () => {
  const incident = await createBrowserIncident();
  await page.goto(`${appUrl}/app/incidents/${incident.id}`);
  await operatorHydrated(page);
  await page.getByRole("heading", { name: "Compose public update" }).waitFor();
  await page.locator("label", { hasText: "Who is affected" }).locator("textarea").fill("Scheduled browser customers.");
  await page.locator("label", { hasText: "What is the impact" }).locator("textarea").fill("A scheduled update has a distinct publication time.");
  await page.getByLabel("Next update date and time").fill("2027-09-08T14:00");
  // Scheduling publishes the stored draft, so wait for the server to hold all three
  // edits (UPDATE-005 keeps the strict two-second autosave gate).
  for (const deadline = Date.now() + 15_000; ; await new Promise(resolve => setTimeout(resolve, 200))) {
    const draft = (await (await appFetch(`/api/app/incidents/${incident.id}`)).json()).incident.draft;
    if (draft?.affectedAudience === "Scheduled browser customers." && draft.customerImpact === "A scheduled update has a distinct publication time." && draft.nextUpdateAt) break;
    assert.ok(Date.now() < deadline, `the composer never stored the scheduled draft: ${JSON.stringify(draft)}`);
  }
  await page.getByText("Draft saved", { exact: true }).waitFor();
  await page.getByText("Schedule or backdate", { exact: true }).click();
  await page.getByLabel("Scheduled publication date and time").fill("2027-09-08T13:30");
  await page.getByRole("button", { name: "Schedule update" }).click();
  await page.getByText("Update scheduled. It remains private until its recorded publication time.").waitFor();
});

contract("DRAFT-002", "operators save and reload AI tone instructions while the UI honestly reports an unconfigured provider", async () => {
  const tone = "Lead with customer impact, use concise factual language, and name the next update commitment.";
  await page.goto(`${appUrl}/app/settings#writing`);
  await operatorHydrated(page);
  await page.getByText("No provider configured", { exact: true }).waitFor();
  const toneField = page.getByLabel("Tone instructions");
  await toneField.fill(tone);
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByText("Settings saved and the public snapshot was rebuilt.", { exact: true }).waitFor();
  await page.reload();
  await operatorHydrated(page);
  await page.getByText("No provider configured", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Tone instructions").inputValue(), tone);
});

contract("INTAKE-005", "operators configure a real authenticated source and inspect accepted and rejected redacted receipts", async () => {
  const signingSecret = "browser-alert-source-secret";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appUrl}/app/alerts`);
  await page.getByRole("button", { name: "Add alert source" }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the narrow source editor must not introduce horizontal page overflow");
  await page.getByLabel("Source name").fill("Browser alert source");
  await page.getByLabel("Signing secret").fill(signingSecret);
  await page.getByLabel("Deduplication JSON path").fill("$.event.id");
  await page.getByLabel("Title JSON path").fill("$.event.title");
  await page.getByLabel("State JSON path").fill("$.event.state");
  await page.getByRole("button", { name: "Create source" }).click();
  await page.getByText("Alert source created. Send alerts to the endpoint below.", { exact: true }).waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(), new RegExp(signingSecret));

  await page.getByLabel("Source name").fill("Browser alert source — primary");
  await page.getByRole("button", { name: "Save source" }).click();
  await page.getByText("Alert source updated. Existing secrets remain hidden.", { exact: true }).waitFor();
  const sourceCard = page.locator(".alert-source-card").filter({ has: page.getByRole("heading", { name: "Browser alert source — primary", exact: true }) });
  const endpoint = await sourceCard.locator("code").first().textContent();
  assert.ok(endpoint?.startsWith(`${pageUrl}/api/intake/`), "the configured source must show its real intake endpoint");

  async function sendAlert(payload) {
    const body = JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const signature = createHmac("sha256", signingSecret).update(`${timestamp}.${body}`).digest("base64url");
    return fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-lamp-timestamp": timestamp, "x-lamp-signature": signature }, body });
  }

  const accepted = await sendAlert({ event: { id: "browser-alert-accepted", title: "Browser intake acceptance", state: "firing" } });
  assert.equal(accepted.status, 202, await accepted.text());
  const rejected = await sendAlert({ event: { title: "Browser intake rejection", state: "firing" } });
  assert.equal(rejected.status, 400, await rejected.text());

  await page.reload();
  await page.locator(".alert-source-card").getByRole("heading", { name: "Browser alert source — primary", exact: true }).waitFor();
  const ownReceipts = page.locator(".receipt-card tr").filter({ hasText: "Browser alert source — primary" });
  await ownReceipts.getByText("Accepted", { exact: true }).waitFor();
  await ownReceipts.getByText("Rejected", { exact: true }).waitFor();
  const receiptText = await page.locator(".receipt-card").innerText();
  assert.match(receiptText, /deduplication path/i);
  assert.doesNotMatch(receiptText, /browser-alert-source-secret|browser-alert-accepted/);
});

contract("DRAFT-003", "a configured but failing AI provider leaves the ordinary publish control usable", async () => {
  // Closing the prior Vite document before its Worker restarts prevents its HMR
  // reconnect from cancelling the first navigation against the new config.
  const viewport = await closeAuthenticatedPage();
  await stopWorker();
  await startFailingAiProvider();
  fixtureConfig.write(configWithAiProvider);
  await startWorker(configPath);
  await openAuthenticatedPage(viewport);
  await page.goto(`${appUrl}/app/incidents/${autosaveIncidentId}`);
  await page.getByRole("button", { name: "Suggest update" }).waitFor();
  await page.getByRole("button", { name: "Suggest update" }).click();
  const aiStatus = page.locator(".ai-suggestion [role=status]");
  let status = "";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    status = await aiStatus.textContent() ?? "";
    if (status !== "Drafting suggestion…") break;
    await page.waitForTimeout(100);
  }
  assert.match(status, /AI provider returned 503|Browser AI provider intentionally unavailable/i);
  const publish = page.getByRole("button", { name: "Publish update" });
  await assert.equal(await publish.isEnabled(), true);
  await publish.click();
  await page.getByText("Update published.").waitFor();
});


contract("UPDATE-002", "NOTIFY-019 — composer controls and saved notification branding work on desktop and phone", async () => {
  const component = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({ groupId: null, name: "Responsive composer API", description: "Publication control layout verification", internal: false, displayOrder: 2, note: "" }) });
  assert.equal(component.status, 201);
  const componentId = (await component.json()).component.id;
  const created = await appFetch("/api/app/incidents", { method: "POST", body: JSON.stringify({ title: "Responsive publication controls", components: [{ componentId, state: "Major outage", relationship: "Primary" }] }) });
  assert.equal(created.status, 201);
  const incident = (await created.json()).incident;
  const originalViewport = page.viewportSize();
  try {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${appUrl}/app/incidents/${incident.id}`);
      await operatorHydrated(page);
      const controls = page.getByRole("region", { name: "Publication controls" });
      await controls.getByText("Schedule or backdate", { exact: true }).click();
      const timestamp = controls.getByLabel("Historical publication date and time");
      await timestamp.scrollIntoViewIfNeeded();
      await timestamp.fill("2026-01-02T10:30");
      assert.equal(await timestamp.inputValue(), "2026-01-02T10:30");
      await controls.getByLabel("Email", { exact: true }).uncheck();
      await controls.getByLabel("Webhook", { exact: true }).check();
      assert.equal(await controls.getByLabel("Webhook", { exact: true }).isChecked(), true);
      const geometry = await controls.evaluate((section) => {
        const box = section.getBoundingClientRect();
        const fields = [...section.querySelectorAll("input, label, small, strong, p")];
        return { viewport: innerWidth, left: box.left, right: box.right, fields: fields.map((field) => {
          const rect = field.getBoundingClientRect();
          return { name: field.getAttribute("aria-label") ?? field.textContent, left: rect.left, right: rect.right, width: rect.width, scrollWidth: field.scrollWidth, clientWidth: field.clientWidth };
        }) };
      });
      assert.ok(geometry.left >= 0 && geometry.right <= width, `controls remain in the ${width}px viewport`);
      for (const field of geometry.fields) {
        assert.ok(field.left >= geometry.left && field.right <= geometry.right, `${width}px ${field.name}: contained within publication controls`);
        assert.ok(field.width > 0 && field.scrollWidth <= field.clientWidth + 1, `${width}px ${field.name}: no clipped field or help text`);
      }
      await timestamp.scrollIntoViewIfNeeded();
      if (process.env.LAMP_COMPOSER_SCREENSHOTS) {
        await mkdir(process.env.LAMP_COMPOSER_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: join(process.env.LAMP_COMPOSER_SCREENSHOTS, `composer-${width}.png`), fullPage: true });
      }
    }
  } finally { if (originalViewport) await page.setViewportSize(originalViewport); }
  await emailBrandingBrowserFlow({ page, appUrl, pageUrl, appFetch });
});

contract("HIST-002", "AGENT-005 TEAM-007 HIST-007 — an operator publishes a report, browses audit history and reports subscribers", async () => {
  await postIncidentReportFlow({ page, appFetch, appUrl, pageUrl });
  await auditLogFlow({ page, appUrl, appFetch });
  await subscriberReportingBrowserFlow({ page, appUrl, appFetch });
});
