import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before } from "node:test";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "playwright";

import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { baseline } from "../baseline/e2e-baseline/case.mjs";

const WCAG_22_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const wranglerConfig = resolve("deploy/wrangler.template.toml");
const subscriberTokenSecret = "accessibility-test-subscriber-token-secret";

let baseUrl = "";
let embedUrl = "";
let statePath;
let viteCachePath;
let configPath;
let worker;
let workerOutput = "";
let embedServer;
let sessionId;
let browser;
let context;
let incidentId;
let incidentReference;
let manageToken;
let unsubscribeToken;

async function appFetch(path, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Cookie: `lamp_session=${sessionId}`, "Content-Type": "application/json", ...init.headers },
  });
}

function executeLocalSql(statement) {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", wranglerConfig, "--persist-to", statePath, "--command", statement], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
}

function subscriberToken(id, scope) {
  const signature = createHmac("sha256", subscriberTokenSecret).update(`lamp-subscriber-token.v1.${scope}.${id}`).digest("base64url");
  const token = `v1.${scope}.${id}.${signature}`;
  return { id, token, hash: createHash("sha256").update(token).digest("base64url") };
}

async function waitForPublicContent(path, expected) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`);
    if (response.status === 200 && (await response.text()).includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${path} did not contain ${expected} after the local snapshot rebuild.`);
}

async function currentSettings() {
  const response = await appFetch("/api/app/page-settings");
  assert.equal(response.status, 200);
  return (await response.json()).settings;
}

async function allowWidgetAt(origin) {
  const current = await currentSettings();
  const response = await appFetch("/api/app/page-settings", {
    method: "PUT",
    body: JSON.stringify({
      pageName: current.pageName,
      tagline: current.tagline,
      accentColor: current.accentColor,
      timezone: current.timezone,
      hostname: current.hostname,
      footerCreditEnabled: current.footerCreditEnabled,
      mailFromAddress: current.mailFromAddress,
      widgetAllowedOrigins: [origin],
    }),
  });
  assert.equal(response.status, 200);
}

function startEmbedServer() {
  return new Promise((resolveStarted, reject) => {
    const server = createHttpServer((request, response) => {
      if (request.url !== "/") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found.");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Widget accessibility fixture</title></head><body><main><h1>Embedded status</h1><script src="${baseUrl}/widget.js"></script></main></body></html>`);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not start the widget accessibility fixture."));
      embedServer = server;
      embedUrl = `http://127.0.0.1:${address.port}`;
      resolveStarted();
    });
  });
}

function violationsText(violations) {
  return violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`).join("\n");
}

async function assertWcag22Aa(page, surface, selector) {
  const audit = new AxeBuilder({ page }).withTags(WCAG_22_AA_TAGS);
  if (selector) audit.include(selector);
  const results = await audit.analyze();
  assert.deepEqual(results.violations, [], `${surface} violates automated WCAG 2.2 AA checks:\n${violationsText(results.violations)}`);
}

before(async () => {
  const workerPort = await reservePort({ label: "accessibility Worker" });
  baseUrl = `http://127.0.0.1:${workerPort}`;
  statePath = await mkdtemp(join(tmpdir(), "lamp-accessibility-d1-"));
  viteCachePath = await mkdtemp(join(tmpdir(), "lamp-accessibility-vite-"));
  configPath = resolve(`deploy/.accessibility-${process.pid}.toml`);
  writeFileSync(configPath, readFileSync(wranglerConfig, "utf8").replace("\n[[d1_databases]]", `\nSUBSCRIBER_TOKEN_SECRET = "${subscriberTokenSecret}"\n\n[[d1_databases]]`));
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", configPath, "--persist-to", statePath], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
  worker = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(workerPort), "--strictPort"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "pipe",
    env: {
      ...process.env,
      LAMP_DISABLE_INSPECTOR: "true",
      LAMP_WORKERS_STATE_PATH: statePath,
      LAMP_VITE_CACHE_DIR: viteCachePath,
      LAMP_WRANGLER_CONFIG: configPath,
    },
  });
  worker.stdout.on("data", (chunk) => { workerOutput += chunk; });
  worker.stderr.on("data", (chunk) => { workerOutput += chunk; });
  await waitForWorker({ origin: baseUrl, child: worker, output: () => workerOutput, label: "accessibility Worker" });

  const initialPublicPage = await fetch(`${baseUrl}/`);
  assert.equal(initialPublicPage.status, 200);
  sessionId = await insertRealOperatorSession({ persistTo: statePath });
  const component = await appFetch("/api/app/components", {
    method: "POST",
    body: JSON.stringify({
      groupId: null,
      name: "Accessibility test service",
      description: "A real component created only by the local accessibility fixture.",
      internal: false,
      displayOrder: 1,
      note: "",
    }),
  });
  assert.equal(component.status, 201);
  const componentId = (await component.json()).component.id;
  const incident = await appFetch("/api/app/incidents", {
    method: "POST",
    body: JSON.stringify({
      title: "Accessibility fixture incident",
      components: [{ componentId, state: "Degraded performance", relationship: "Primary" }],
    }),
  });
  assert.equal(incident.status, 201);
  const incidentRecord = (await incident.json()).incident;
  incidentId = incidentRecord.id;
  incidentReference = incidentRecord.reference;
  const initialUpdate = {
    lifecycle: "Identified",
    affectedAudience: "Accessibility test readers.",
    customerImpact: "The fixture service is slower than expected.",
    whatStillWorks: "The public status page remains available.",
    details: "A test-owned incident supplies the permanent public page and history record.",
    nextUpdateAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  };
  const savedInitial = await appFetch(`/api/app/incidents/${incidentId}/draft`, { method: "PUT", body: JSON.stringify(initialUpdate) });
  assert.equal(savedInitial.status, 200);
  const publishedInitial = await appFetch(`/api/app/incidents/${incidentId}/publish`, { method: "POST", body: JSON.stringify({ channels: [] }) });
  assert.equal(publishedInitial.status, 200);
  const savedResolution = await appFetch(`/api/app/incidents/${incidentId}/draft`, {
    method: "PUT",
    body: JSON.stringify({ ...initialUpdate, lifecycle: "Resolved", customerImpact: "The fixture service is operating normally." }),
  });
  assert.equal(savedResolution.status, 200);
  const publishedResolution = await appFetch(`/api/app/incidents/${incidentId}/publish`, { method: "POST", body: JSON.stringify({ channels: [] }) });
  assert.equal(publishedResolution.status, 200);
  await waitForPublicContent(`/incidents/${incidentReference}`, "Accessibility fixture incident");
  await waitForPublicContent("/history", "Accessibility fixture incident");

  const manage = subscriberToken("01J00000000000000000000081", "manage");
  const unsubscribe = subscriberToken("01J00000000000000000000082", "unsubscribe");
  manageToken = manage.token;
  unsubscribeToken = unsubscribe.token;
  const timestamp = new Date().toISOString();
  executeLocalSql(`INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,deactivation_reason,deactivated_at,created_at,updated_at) VALUES ('01J00000000000000000000080','email','accessibility-reader@example.test',NULL,'active','selected','accessibility-legacy-token',NULL,NULL,'${timestamp}','${timestamp}'); INSERT INTO subscriber_components (id,subscriber_id,component_id,created_at,updated_at) VALUES ('01J00000000000000000000083','01J00000000000000000000080','${componentId}','${timestamp}','${timestamp}'); INSERT INTO subscriber_tokens (id,subscriber_id,scope,token_hash,expires_at,revoked_at,created_at,updated_at) VALUES ('${manage.id}','01J00000000000000000000080','manage','${manage.hash}',NULL,NULL,'${timestamp}','${timestamp}'),('${unsubscribe.id}','01J00000000000000000000080','unsubscribe','${unsubscribe.hash}',NULL,NULL,'${timestamp}','${timestamp}');`);
  await startEmbedServer();
  await allowWidgetAt(embedUrl);

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ timezoneId: "Australia/Brisbane" });
  await context.addCookies([{ name: "lamp_session", value: sessionId, url: baseUrl }]);
});

after(async () => {
  await context?.close();
  await browser?.close();
  if (embedServer) await new Promise((resolve) => embedServer.close(resolve));
  if (worker?.pid && worker.exitCode === null) {
    const stopped = new Promise((resolve) => worker.once("exit", resolve));
    try { process.kill(-worker.pid, "SIGTERM"); } catch { /* Worker already exited. */ }
    await stopped;
  }
  await Promise.all([
    rm(statePath, { recursive: true, force: true }),
    rm(viteCachePath, { recursive: true, force: true }),
    rm(configPath, { force: true }),
  ]);
});

async function auditRoute(path, surface, readySelector, options = {}) {
  const routeContext = options.anonymous ? await browser.newContext({ timezoneId: "Australia/Brisbane" }) : context;
  const page = await routeContext.newPage();
  try {
    if (options.viewport) await page.setViewportSize(options.viewport);
    const response = await page.goto(`${baseUrl}${path}`);
    assert.equal(response?.status(), 200, `${surface} must be reachable in the local Worker fixture.`);
    await page.locator(readySelector).first().waitFor();
    if (options.noHorizontalOverflow) {
      const layout = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
      assert.ok(layout.documentWidth <= layout.viewportWidth, `${surface} must not overflow a ${layout.viewportWidth}px viewport: ${JSON.stringify(layout)}.`);
    }
    await assertWcag22Aa(page, surface, options.selector);
  } finally {
    await page.close();
    if (options.anonymous) await routeContext.close();
  }
}

baseline("BASE-PUBLIC-003", "Axe WCAG 2.2 AA passes real local public, operator, and widget surfaces", async () => {
  for (const [path, surface, selector] of [
    ["/", "Public status page", "main.root-page"],
    [`/incidents/${incidentReference}`, "Permanent public incident page", "main.page"],
    ["/history", "Public incident history", "main.page"],
    [`/manage/${manageToken}`, "Subscriber management page", "main"],
    [`/unsubscribe/${unsubscribeToken}`, "Subscriber unsubscribe page", "form"],
  ]) {
    await auditRoute(path, surface, selector);
  }

  await auditRoute("/signin", "Unauthenticated sign-in page", "main.signin-page", { anonymous: true });
  for (const [path, surface, options] of [
    ["/app", "Operator overview"],
    ["/app/incidents", "Operator incidents"],
    [`/app/incidents/${incidentId}`, "Operator incident detail"],
    ["/app/components", "Operator components"],
    ["/app/maintenance", "Operator maintenance", { noHorizontalOverflow: true, viewport: { width: 1024, height: 1536 } }],
    ["/app/subscribers", "Operator subscribers", { noHorizontalOverflow: true, viewport: { width: 390, height: 844 } }],
    ["/app/deliveries", "Operator deliveries"],
    ["/app/settings", "Operator settings"],
    ["/app/alerts", "Operator alerts"],
  ]) {
    await auditRoute(path, surface, "main.operator-main h1", options);
  }

  const widgetPage = await context.newPage();
  try {
    await widgetPage.goto(`${embedUrl}/`);
    await widgetPage.locator("section[role=status]").waitFor();
    await assertWcag22Aa(widgetPage, "Allow-listed status widget", "section[role=status]");
  } finally {
    await widgetPage.close();
  }
});
