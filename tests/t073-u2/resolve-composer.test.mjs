import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

import { insertRealOperatorSession } from "../e2e/real-session-helper.mjs";
import { waitForWorker } from "../e2e/worker-startup.mjs";

const port = Number(process.env.LAMP_T073_COMPOSER_PORT ?? 57100);
if (!Number.isInteger(port) || port < 57100 || port > 57119) {
  throw new Error("The Lamp composer browser test port must be in 57100–57119.");
}

const origin = `http://127.0.0.1:${port}`;
const testDirectory = await mkdtemp(join(tmpdir(), "lamp-t073-composer-"));
const statePath = join(testDirectory, "worker-state");
const viteCachePath = join(testDirectory, "vite-cache");
let sessionId;
let server;
let serverClosed;
let browser;
let context;
let page;
let serverOutput = "";

async function assertPortAvailable() {
  await new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", () => reject(new Error(`Lamp composer browser test port ${port} is already in use.`)));
    listener.listen(port, "127.0.0.1", () => listener.close((error) => error ? reject(error) : resolve()));
  });
}

async function appFetch(path, init = {}) {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: { Connection: "close", Cookie: `lamp_session=${sessionId}`, "Content-Type": "application/json", ...init.headers },
  });
}

async function readIncident(id) {
  const response = await appFetch(`/api/app/incidents/${id}`);
  assert.equal(response.status, 200);
  return (await response.json()).incident;
}

async function waitForDraft(id, matches) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const incident = await readIncident(id);
    if (incident.draft && matches(incident.draft)) return incident.draft;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The native composer did not persist its latest draft. Worker output:\n${serverOutput}`);
}

async function waitForPublicIncident(reference, expectedText) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${origin}/incidents/${reference}`);
    const html = await response.text();
    if (response.status === 200 && html.includes(expectedText)) return html;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The public incident page did not contain ${expectedText}. Worker output:\n${serverOutput}`);
}

async function createIncident(title, componentName) {
  const componentResponse = await appFetch("/api/app/components", {
    method: "POST",
    body: JSON.stringify({ groupId: null, name: componentName, description: "T-073 native composer browser coverage.", internal: false, displayOrder: 1, note: "" }),
  });
  assert.equal(componentResponse.status, 201);
  const { component } = await componentResponse.json();
  const incidentResponse = await appFetch("/api/app/incidents", {
    method: "POST",
    body: JSON.stringify({ title, components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }] }),
  });
  assert.equal(incidentResponse.status, 201);
  return (await incidentResponse.json()).incident;
}

async function fillUpdate({ audience, impact, details }) {
  await page.getByLabel(/Who is affected/).fill(audience);
  await page.getByLabel(/What is the impact/).fill(impact);
  await page.getByLabel(/Additional details/).fill(details);
}

async function waitForSavedDraft() {
  await page.locator(".autosave-status").getByText("Draft saved", { exact: true }).waitFor();
}

before(async () => {
  await assertPortAvailable();
  await mkdir(viteCachePath, { recursive: true });
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", "deploy/wrangler.template.toml", "--persist-to", statePath], { stdio: "pipe" });
  sessionId = await insertRealOperatorSession({ persistTo: statePath });
  const startupStartedAt = performance.now();
  server = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "pipe",
    env: { ...process.env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: viteCachePath, LAMP_DISABLE_INSPECTOR: "true" },
  });
  console.info(`Lamp composer Vite started: pid=${server.pid}, cwd=${process.cwd()}, at=${new Date().toISOString()}`);
  serverClosed = new Promise((resolve) => server.once("close", (code, signal) => {
    console.info(`Lamp composer Vite closed: pid=${server.pid}, code=${code}, signal=${signal}`);
    resolve();
  }));
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  server.on("exit", (code, signal) => {
    const diagnostic = `Lamp composer Vite exited: code=${code}, signal=${signal}`;
    serverOutput += `\n${diagnostic}\n`;
    console.info(diagnostic);
  });
  await waitForWorker({ origin, child: server, output: () => serverOutput, timeoutMs: 120_000, label: "Lamp composer Worker" });
  console.info(`Lamp composer Worker ready after ${Math.round(performance.now() - startupStartedAt)}ms (120000ms cold-start budget).`);
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ timezoneId: "Australia/Brisbane", viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "lamp_session", value: sessionId, url: origin }]);
  page = await context.newPage();
});

after(async () => {
  await page?.close();
  await context?.close();
  await browser?.close();
  if (server) {
    try { process.kill(-server.pid, "SIGTERM"); }
    catch (cause) { if (cause?.code !== "ESRCH") throw cause; }
    let cleanupTimer;
    try {
      await Promise.race([
        serverClosed,
        new Promise((_, reject) => {
          cleanupTimer = setTimeout(() => reject(new Error(`Composer Vite cleanup timed out: pid=${server.pid}, code=${server.exitCode}, signal=${server.signalCode}`)), 10_000);
        }),
      ]);
    } catch (error) {
      try { process.kill(-server.pid, "SIGKILL"); }
      catch (cause) { if (cause?.code !== "ESRCH") throw cause; }
      throw error;
    } finally {
      clearTimeout(cleanupTimer);
    }
  }
  await rm(testDirectory, { recursive: true, force: true });
});

test("Resolve clears the promise in the native composer and publishes the shared public and email rendering", async () => {
  const invalidActive = await createIncident("Active update validation", "Composer active validation component");
  await page.goto(`${origin}/app/incidents/${invalidActive.id}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Compose public update" }).waitFor();
  await fillUpdate({ audience: "Customers using the API", impact: "Requests are failing.", details: "Operators are investigating." });
  await waitForDraft(invalidActive.id, (draft) => draft.customerImpact === "Requests are failing.");
  await waitForSavedDraft();

  const invalidResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/app/incidents/${invalidActive.id}/publish`);
  await page.getByRole("button", { name: "Publish update", exact: true }).click();
  const invalidPublish = await invalidResponse;
  assert.equal(invalidPublish.status(), 400);
  await page.getByText("Active updates require a valid next update time.", { exact: true }).waitFor();
  const unchangedActive = await readIncident(invalidActive.id);
  assert.equal(unchangedActive.lifecycle, "Investigating");
  assert.equal(unchangedActive.updates.length, 0);
  assert.equal(unchangedActive.components[0].state, "Major outage");

  const resolution = await createIncident("Native Resolve action", "Composer Resolve component");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/app/incidents/${resolution.id}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Compose public update" }).waitFor();
  await fillUpdate({ audience: "Customers using the status API", impact: "Responses are available again.", details: "The service has recovered." });
  await page.getByLabel("Next update date and time").fill("2027-10-06T14:00");
  await waitForDraft(resolution.id, (draft) => draft.nextUpdateAt !== null && draft.customerImpact === "Responses are available again.");
  await waitForSavedDraft();
  assert.equal(await page.getByLabel("Next update date and time").count(), 1);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the composer fits at 1440 pixels");
  const resolveButton = page.getByRole("button", { name: "Resolve incident", exact: true });
  let resolveBounds = await resolveButton.boundingBox();
  assert.ok(resolveBounds && resolveBounds.x >= 0 && resolveBounds.x + resolveBounds.width <= 1440, "the Resolve action is reachable at 1440 pixels");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the composer fits at 390 pixels");
  resolveBounds = await resolveButton.boundingBox();
  assert.ok(resolveBounds && resolveBounds.x >= 0 && resolveBounds.x + resolveBounds.width <= 390, "the Resolve action is reachable at 390 pixels");
  await resolveButton.click();
  assert.equal(await page.getByLabel("Next update date and time").count(), 0, "a resolved draft removes the next-update input");
  await page.getByText("This update closes the incident without a future update commitment.", { exact: true }).waitFor();
  const resolvedDraft = await waitForDraft(resolution.id, (draft) => draft.lifecycle === "Resolved" && draft.nextUpdateAt === null);
  await waitForSavedDraft();

  const previewResponse = await appFetch(`/api/app/incidents/${resolution.id}/draft/preview`, {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(["lifecycle", "affectedAudience", "customerImpact", "whatStillWorks", "details", "nextUpdateAt"].map(key => [key, resolvedDraft[key]]))),
  });
  assert.equal(previewResponse.status, 200);
  const { preview } = await previewResponse.json();
  assert.equal(preview.public.lifecycle, "Resolved");
  assert.doesNotMatch(JSON.stringify(preview.public), /Next update by|Not yet committed/);
  assert.doesNotMatch(preview.email.plainText, /Next update by|Not yet committed/);
  assert.match(preview.email.plainText, /Status: Resolved/);

  const publicCard = page.locator(".preview-panel .preview-card").first();
  await publicCard.getByText("Resolved", { exact: true }).waitFor();
  assert.doesNotMatch(await publicCard.innerText(), /Next update by|Not yet committed/);
  const publicRows = await publicCard.locator("dl div").evaluateAll((rows) => rows.map((row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]));
  assert.deepEqual(publicRows, preview.public.fields.map(({ label, value }) => [label, value]));
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await page.getByLabel("Next update date and time").count(), 0);
  assert.doesNotMatch(await publicCard.innerText(), /Next update by|Not yet committed/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the resolved composer fits at 1440 pixels");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByLabel("Next update date and time").count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the resolved composer fits at 390 pixels");

  const emailDisclosure = page.locator(".email-preview");
  await emailDisclosure.locator("summary").click();
  const emailCard = emailDisclosure.locator(".preview-card");
  assert.equal(await emailCard.locator("h3").innerText(), preview.email.subject);
  assert.deepEqual(await emailCard.locator("dd").allTextContents(), preview.email.plainText.split("\n\n").slice(1));
  assert.doesNotMatch(await emailCard.innerText(), /Next update by|Not yet committed/);

  const publishResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/app/incidents/${resolution.id}/publish`);
  await page.getByRole("button", { name: "Publish update", exact: true }).click();
  const published = await publishResponse;
  assert.equal(published.status(), 200);
  const publishedUpdate = (await published.json()).update;
  assert.equal(publishedUpdate.lifecycle, "Resolved");
  assert.equal(publishedUpdate.nextUpdateAt, null);
  assert.equal(publishedUpdate.customerImpact, resolvedDraft.customerImpact);
  await page.getByText("Update published. The fixed recipient set is now queued for delivery.", { exact: true }).waitFor();

  const publishedIncident = await readIncident(resolution.id);
  assert.equal(publishedIncident.lifecycle, "Resolved");
  assert.ok(publishedIncident.resolvedAt, "publishing the resolved update records the resolution instant");
  assert.equal(publishedIncident.updates[0].nextUpdateAt, null);
  const publicHtml = await waitForPublicIncident(resolution.reference, "Responses are available again.");
  assert.doesNotMatch(publicHtml, /Next update by|Not yet committed/);
});
