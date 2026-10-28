import { requestHeaders } from "../helpers/request-headers.mjs";
import { assertAppliedStyles } from "../helpers/applied-styles.mjs";
import { withDraftVersion } from "./draft-version-helper.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { after, before } from "node:test";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "playwright";

import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { appOrigin, pageOrigin } from "./helpers/hosts.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { accessibilityFailure, analyzeScriptFreePage, newScriptFreePage, observeAuditPage } from "./subscriber-audit-helper.mjs";
import { baseline } from "../baseline/e2e-baseline/case.mjs";
import { isolatedWranglerConfig } from "../helpers/wrangler-config.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";

const WCAG_22_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const wranglerConfig = resolve("wrangler.jsonc");
const subscriberTokenSecret = "synthetic-accessibility-test-subscriber-token-secret";

let appUrl = "";
let pageUrl = "";
let embedUrl = "";
let statePath;
let viteCachePath;
let fixtureConfig;
let configPath;
let worker;
let embedServer;
let sessionId;
let browser;
let context;
let incidentId;
let incidentReference;
let manageToken;
let unsubscribeToken;
let confirmTokens = [];

async function appFetch(path, init = {}) {
  init = await withDraftVersion(path, init, appFetch);
  return fetch(`${appUrl}${path}`, {
    ...init,
    headers: requestHeaders({ Cookie: `${sessionCookieName(appUrl)}=${sessionId}`, "Content-Type": "application/json" }, init.headers),
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
    const response = await fetch(`${pageUrl}${path}`);
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
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Widget accessibility fixture</title></head><body><main><h1>Embedded status</h1><script src="${pageUrl}/widget.js"></script></main></body></html>`);
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
  return violations.map((violation) => violation.id).join(", ");
}

async function assertWcag22Aa(page, surface, selector) {
  const audit = new AxeBuilder({ page }).withTags(WCAG_22_AA_TAGS);
  if (selector) audit.include(selector);
  const results = await audit.analyze();
  assert.equal(results.violations.length, 0, `${surface} violates automated WCAG 2.2 AA checks: ${violationsText(results.violations)}`);
}

async function startWorker() {
  worker = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--config", configPath, "--persist-to", statePath, "--ip", "127.0.0.1", "--port", new URL(appUrl).port, "--inspector-port", "0", "--show-interactive-dev-session=false"], {
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
  worker.stdout.resume();
  worker.stderr.resume();
  await waitForWorker({ origin: appUrl, child: worker, output: () => "Accessibility Worker diagnostics withheld because they may contain private links.", label: "accessibility Worker" });
}

before(async () => {
  const workerPort = await reservePort({ label: "accessibility Worker" });
  appUrl = appOrigin(workerPort);
  pageUrl = pageOrigin(workerPort);
  statePath = await mkdtemp(resolve(".lamp-accessibility-d1-"));
  // Vite serves an in-root cache through its relative path. Keep that path
  // inside the native development-asset boundary used for optimized modules.
  viteCachePath = await mkdtemp(resolve("node_modules/.lamp-accessibility-vite-"));
  // A checkout's `.dev.vars` would override the fixture's subscriber token secret and make every token this test signs fail verification.
  fixtureConfig = isolatedWranglerConfig(config => ({ ...config, main: resolve("dist/server/index.js"), assets: { directory: resolve("dist/client"), binding: "ASSETS", run_worker_first: true }, vars: { ...config.vars, SUBSCRIBER_TOKEN_SECRET: subscriberTokenSecret } }));
  configPath = fixtureConfig.path;
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", configPath, "--persist-to", statePath], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
  await startWorker();

  const neutralPublicPage = await fetch(`${pageUrl}/`);
  assert.equal(neutralPublicPage.status, 503, "an unconfigured public page stays unavailable until owner setup is complete");
  sessionId = await insertRealOperatorSession({ persistTo: statePath, pageSettings: true });
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
  const initialPublicPage = await fetch(`${pageUrl}/`);
  assert.equal(initialPublicPage.status, 200, "the owner's component mutation publishes the configured accessibility page");
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
  confirmTokens = [
    subscriberToken("01J00000000000000000000087", "confirm"),
    subscriberToken("01J00000000000000000000088", "confirm"),
    subscriberToken("01J00000000000000000000089", "confirm"),
  ];
  manageToken = manage.token;
  ({ token: unsubscribeToken } = unsubscribe);
  const timestamp = new Date().toISOString();
  const confirmationRows = confirmTokens.map((confirm, index) => `('01J0000000000000000000008${index + 4}','email','accessibility-confirm-${index}@example.test',NULL,'pending','all','accessibility-confirm-legacy-${index}',NULL,NULL,'${timestamp}','${timestamp}')`).join(",");
  const confirmationTokenRows = confirmTokens.map((confirm, index) => `('${confirm.id}','01J0000000000000000000008${index + 4}','confirm','${confirm.hash}','2035-01-01T00:00:00.000Z',NULL,'${timestamp}','${timestamp}')`).join(",");
  executeLocalSql(`INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,deactivation_reason,deactivated_at,created_at,updated_at) VALUES ('01J00000000000000000000080','email','accessibility-reader@example.test',NULL,'active','selected','accessibility-legacy-token',NULL,NULL,'${timestamp}','${timestamp}'),${confirmationRows}; INSERT INTO subscriber_components (id,subscriber_id,component_id,created_at,updated_at) VALUES ('01J00000000000000000000083','01J00000000000000000000080','${componentId}','${timestamp}','${timestamp}'); INSERT INTO subscriber_tokens (id,subscriber_id,scope,token_hash,expires_at,revoked_at,created_at,updated_at) VALUES ('${manage.id}','01J00000000000000000000080','manage','${manage.hash}',NULL,NULL,'${timestamp}','${timestamp}'),('${unsubscribe.id}','01J00000000000000000000080','unsubscribe','${unsubscribe.hash}',NULL,NULL,'${timestamp}','${timestamp}'),${confirmationTokenRows};`);
  await startEmbedServer();
  await allowWidgetAt(embedUrl);

  browser = await chromium.launch({ headless: true, executablePath: process.env.LAMP_CHROMIUM_PATH, args: ["--no-sandbox"] });
  context = await browser.newContext({ timezoneId: "Australia/Brisbane", viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: sessionCookieName(appUrl), value: sessionId, url: appUrl }]);
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
    fixtureConfig?.cleanup(),
  ]);
});

async function auditRoute(origin, path, surface, readySelector, options = {}) {
  const routeContext = options.anonymous ? await browser.newContext({ timezoneId: "Australia/Brisbane", viewport: { width: 1440, height: 900 } }) : context;
  const page = await routeContext.newPage();
  const diagnostics = { phase: "navigation", surface };
  observeAuditPage(page, diagnostics);
  try {
    if (options.viewport) await page.setViewportSize(options.viewport);
    const response = await page.goto(`${origin}${path}`);
    assert.equal(response?.status(), 200, `${surface} must be reachable in the local Worker fixture.`);
    diagnostics.phase = "ready content";
    await page.locator(readySelector).first().waitFor();
    if (options.footerCreditToggle) {
      diagnostics.phase = "footer credit toggle";
      const toggle = page.getByRole("checkbox", { name: "Show the Powered by Lamp footer credit" });
      await toggle.waitFor();
      assert.equal(await toggle.isChecked(), true, "the footer credit remains enabled by default");
    }
    if (options.noHorizontalOverflow) {
      diagnostics.phase = "horizontal overflow";
      const layout = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
      assert.ok(layout.documentWidth <= layout.viewportWidth, `${surface} must not overflow a ${layout.viewportWidth}px viewport: ${JSON.stringify(layout)}.`);
    }
    diagnostics.phase = "Axe";
    await assertWcag22Aa(page, surface, options.selector);
  } catch (cause) {
    throw accessibilityFailure(cause, "Accessibility route", diagnostics);
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
    await auditRoute(pageUrl, path, surface, selector);
  }

  await auditRoute(appUrl, "/signin", "Unauthenticated sign-in page", "main", { anonymous: true });
  for (const [path, surface, options] of [
    ["/app", "Operator overview"],
    ["/app/incidents", "Operator incidents"],
    [`/app/incidents/${incidentId}`, "Operator incident detail"],
    ["/app/components", "Operator components"],
    ["/app/maintenance", "Operator maintenance", { noHorizontalOverflow: true, viewport: { width: 1440, height: 900 } }],
    ["/app/subscribers", "Operator subscribers", { noHorizontalOverflow: true, viewport: { width: 1440, height: 900 } }],
    ["/app/deliveries", "Operator deliveries"],
    ["/app/settings", "Operator settings", { footerCreditToggle: true }],
    ["/app/alerts", "Operator alerts"],
  ]) {
    await auditRoute(appUrl, path, surface, "main.operator-main h1", options);
  }

  await scriptFreeSubscriptionJourney();

  const widgetPage = await context.newPage();
  try {
    await widgetPage.goto(`${embedUrl}/`);
    await widgetPage.locator("section[role=status]").waitFor();
    await assertWcag22Aa(widgetPage, "Allow-listed status widget", "section[role=status]");
  } finally {
    await widgetPage.close();
  }
});

async function scriptFreeSubscriptionJourney() {
  const viewports = [{ width: 1440, height: 900 }];
  const surfaces = [
    ["/", "Public status page", "main.root-page"],
    [`/incidents/${incidentReference}`, "Permanent public incident page", "main.page"],
    ["/history", "Public incident history", "main.page"],
    [`/manage/${manageToken}`, "Subscriber management", "main.subscriber-page"],
    [`/unsubscribe/${unsubscribeToken}`, "Subscriber unsubscribe", "main.subscriber-page"],
  ];

  for (const [index, viewport] of viewports.entries()) {
    const routeContext = await browser.newContext({
      timezoneId: "America/New_York",
      javaScriptEnabled: false,
      viewport,
    });
    const page = await newScriptFreePage(routeContext);
    const diagnostics = { phase: "new page", width: viewport.width };
    observeAuditPage(page, diagnostics);
    try {
      for (const [path, surface, selector] of surfaces) {
        diagnostics.surface = surface;
        diagnostics.phase = "navigation";
        const response = await page.goto(`${pageUrl}${path}`, { waitUntil: "networkidle" });
        assert.equal(response?.status(), 200, `${surface} must load at ${viewport.width}px.`);
        diagnostics.phase = "document and stylesheet";
        await page.locator(selector).first().waitFor();
        await assertAppliedStyles(page);
        diagnostics.phase = "horizontal overflow";
        const layout = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
        assert.ok(layout.documentWidth <= layout.viewportWidth, `${surface} must not overflow ${viewport.width}px: ${JSON.stringify(layout)}.`);
        diagnostics.phase = "Axe";
        const results = await analyzeScriptFreePage(page, WCAG_22_AA_TAGS);
        const serious = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
        diagnostics.axeRules = serious.map(violation => violation.id);
        assert.equal(serious.length, 0, `${surface} has serious or critical Axe violations at ${viewport.width}px: ${violationsText(serious)}`);

        if (viewport.width === 390 && surface === "Public status page") {
          diagnostics.phase = "first incident position";
          const firstIncident = page.locator(".history-timeline .timeline-entry.timeline-incident, .history-timeline .timeline-entry.timeline-resolved").first();
          await firstIncident.waitFor();
          const top = await firstIncident.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
          assert.ok(top < 2 * viewport.height, `The first incident must start within the second screen at 390px: ${top}.`);
        }
      }

      diagnostics.surface = "Subscription confirmation";
      diagnostics.phase = "navigation";
      const confirmation = await page.goto(`${pageUrl}/confirm-subscription/${confirmTokens[index].token}`, { waitUntil: "networkidle" });
      assert.equal(confirmation?.status(), 200, `Subscription confirmation must load at ${viewport.width}px.`);
      diagnostics.phase = "document and stylesheet";
      await page.locator("main.subscriber-page").waitFor();
      await assertAppliedStyles(page);
      diagnostics.phase = "horizontal overflow";
      const confirmLayout = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
      assert.ok(confirmLayout.documentWidth <= confirmLayout.viewportWidth, `Subscription confirmation must not overflow ${viewport.width}px: ${JSON.stringify(confirmLayout)}.`);
      diagnostics.phase = "Axe";
      const confirmationAxe = await analyzeScriptFreePage(page, WCAG_22_AA_TAGS);
      const confirmationSerious = confirmationAxe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
      diagnostics.axeRules = confirmationSerious.map(violation => violation.id);
      assert.equal(confirmationSerious.length, 0, `Subscription confirmation has serious or critical Axe violations at ${viewport.width}px: ${violationsText(confirmationSerious)}`);
    } catch (cause) {
      throw accessibilityFailure(cause, "Script-free public surface", diagnostics);
    } finally {
      await routeContext.close();
    }
  }
}
