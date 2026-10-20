import {secret} from '../auth-adoption/runtime.mjs';
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

import { legacyApiFixtureSql } from "./fixtures/legacy-api-fixture.mjs";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { localWranglerConfig } from "../helpers/wrangler-config.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";
import { fixtureProcessEnv, isolatedWorkerEnvArgs } from "../helpers/worker-environment.mjs";

const appHost = "127.0.0.1";
const pageHost = "status.lamp.test";
const artifactPath = resolve("dist/server/wrangler.json");

let appOrigin = "";
let port;
let privateLoaderPath;
let sessionId;
let statePath;
let envArgs;
let worker;
let workerOutput = "";
let pagePort;
let pageWorker;
let pageWorkerOutput = "";

function run(command, args, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: fixtureProcessEnv(options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveCommand(output) : reject(new Error(`${command} ${args.join(" ")} exited ${code}:\n${output}`)));
  });
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return paths.flat();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Start's browser client serializes a server function's input with seroval
// into the GET request's payload parameter; send exactly that request.
async function clientServerFunctionPath(id, data) {
  const startRequire = createRequire(createRequire(import.meta.url).resolve("@tanstack/react-start/package.json"));
  const { toJSONAsync } = createRequire(startRequire.resolve("@tanstack/start-client-core/package.json"))("seroval");
  const payload = JSON.stringify(await toJSONAsync({ data }));
  return `/_serverFn/${id}?${new URLSearchParams({ payload })}`;
}

async function emittedServerFunctionId(name) {
  const candidates = (await filesUnder(resolve("dist/server"))).filter((path) => path.endsWith(".js"));
  const pattern = new RegExp(`id:\\s*["']([a-f0-9]{64})["']\\s*,\\s*name:\\s*["']${escapeRegExp(name)}["']`);
  for (const path of candidates) {
    const source = await readFile(path, "utf8");
    const match = source.match(pattern);
    if (match) return match[1];
  }
  throw new Error(`No emitted Start server-function ID was found for ${name}.`);
}

function request(path, host, init = {}, targetPort = port) {
  const url = new URL(path, `http://${host}:${targetPort}`);
  return new Promise((resolveResponse, reject) => {
    const requestOptions = {
      method: init.method ?? "GET",
      headers: init.headers,
      signal: init.signal,
      lookup(_hostname, _options, callback) {
        callback(null, [{ address: "127.0.0.1", family: 4 }]);
      },
    };
    const client = httpRequest(url, requestOptions, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
          else if (value !== undefined) headers.set(name, String(value));
        }
        resolveResponse(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500, headers }));
      });
    });
    client.once("error", reject);
    if (init.body !== undefined) client.write(init.body);
    client.end();
  });
}

function appRequest(path, init = {}) {
  return request(path, appHost, {
    ...init,
    headers: { Origin:appOrigin, Cookie: `${sessionCookieName(appOrigin)}=${sessionId}`, ...(init.headers ?? {}) },
  });
}

function pageRequest(path, init = {}) {
  return request(path, pageHost, init, pagePort);
}

async function waitForPublicSnapshot() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await pageRequest("/");
    const body = await response.text();
    if (response.status === 200 && body.includes("Atlas Cloud Status")) return body;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("The page-settings mutation did not produce the real R2 public snapshot.");
}

async function stopWorker(child) {
  if (!child?.pid || child.exitCode !== null) return;
  const stopped = new Promise((resolveExit) => child.once("exit", resolveExit));
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* Worker process group already ended. */ }
  await stopped;
}

async function startPageWorker() {
  pagePort = await reservePort({ label: "page-host Worker" });
  pageWorker = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--config", artifactPath, ...envArgs, "--persist-to", statePath, "--show-interactive-dev-session=false", "--ip", "127.0.0.1", "--port", String(pagePort), "--inspector-port", "0", "--local-upstream", `${pageHost}:${pagePort}`, "--var", `LAMP_PAGE_HOST:${pageHost}`, "--var", `LAMP_APP_HOST:${appHost}`, "--var", `AUTH_ORIGIN:${appOrigin}`, "--var", "AUTH_LOCAL:true", "--var", `SESSION_SECRET:${secret}`, "--var", "SETUP_OPERATOR_EMAIL:operator@example.test", "--log-level", "warn"], {
    cwd: process.cwd(),
    env: fixtureProcessEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  pageWorker.stdout.on("data", (chunk) => { pageWorkerOutput += String(chunk); });
  pageWorker.stderr.on("data", (chunk) => { pageWorkerOutput += String(chunk); });
  await waitForWorker({
    child: pageWorker,
    output: () => pageWorkerOutput,
    label: "Page-host Worker",
    probe: async ({ signal }) => {
      const response = await pageRequest("/", { signal });
      return response.status === 503 || response.status === 200 ? new Response(null, { status: 200 }) : response;
    },
  });
}

async function rebuildPublicSnapshot() {
  const current = await appRequest("/api/app/page-settings", { headers: { Accept: "application/json" } });
  assert.equal(current.status, 200, "the real Hono settings endpoint must remain available to rebuild the R2 snapshot");
  const settings = (await current.json()).settings;
  const rebuilt = await appRequest("/api/app/page-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      pageName: settings.pageName,
      tagline: settings.tagline,
      accentColor: settings.accentColor,
      timezone: settings.timezone,
      hostname: settings.hostname,
      footerCreditEnabled: settings.footerCreditEnabled,
      widgetAllowedOrigins: settings.widgetAllowedOrigins,
      mailFromAddress: settings.mailFromAddress,
    }),
  });
  assert.equal(rebuilt.status, 200, "a real authenticated Hono mutation must rebuild the snapshot before the R2-only read probe");
}

async function browserNavigationProof() {
  const browser = await chromium.launch({
    headless: true,
    args: [`--host-resolver-rules=MAP ${appHost} 127.0.0.1`],
  });
  try {
    const context = await browser.newContext();
    await context.addCookies([{
      name: sessionCookieName(appOrigin),
      value: sessionId,
      url: appOrigin,
      httpOnly: true,
      sameSite: "Lax",
    }]);
    const page = await context.newPage();
    const documents = [];
    const pageErrors = [];
    const consoleErrors = [];
    const failedServerFunctions = [];
    page.on("request", (event) => {
      if (event.resourceType() === "document") documents.push(new URL(event.url()).pathname);
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.startsWith("/_serverFn/") && response.status() >= 400) failedServerFunctions.push(`${response.status()} ${response.url()}`);
    });

    const directDetail = await context.newPage();
    const directDetailErrors = [];
    directDetail.on("pageerror", (error) => directDetailErrors.push(error.message));
    await directDetail.goto(`${appOrigin}/app/incidents/01J00000000000000000000020`, { waitUntil: "networkidle" });
    await directDetail.getByRole("heading", { name: "Compose public update", exact: true }).waitFor();
    await directDetail.getByText("Elevated API error rates", { exact: true }).waitFor();
    assert.deepEqual(directDetailErrors, [], "a direct incident-detail document must hydrate its actual composer without errors");
    await directDetail.close();

    await page.goto(`${appOrigin}/app`, { waitUntil: "networkidle" });
    await page.getByText("Contract Operator", { exact: true }).waitFor();
    const before = await page.evaluate(() => performance.timeOrigin);
    await page.getByRole("link", { name: "Incidents", exact: true }).click();
    await page.waitForURL("**/app/incidents");
    await page.getByRole("heading", { name: "Incidents", exact: true }).waitFor();
    await page.getByRole("link", { name: /INC-4821/ }).click();
    await page.waitForURL("**/app/incidents/01J00000000000000000000020");
    await page.getByRole("heading", { name: "Compose public update", exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    const after = await page.evaluate(() => performance.timeOrigin);

    assert.equal(before, after, "operator navigation must preserve the hydrated document");
    assert.deepEqual(documents, ["/app"], "the operator link must not request a second document");
    assert.deepEqual(pageErrors, [], "Start hydration must not raise a page error");
    assert.deepEqual(consoleErrors, [], "Start hydration must not emit a console error");
    assert.deepEqual(failedServerFunctions, [], "client navigation must not fail a generated Start transport request");
    return { documents: documents.length, stableTimeOrigin: before === after };
  } finally {
    await browser.close();
  }
}

before(async () => {
  port = await reservePort({ label: "built Worker" });
  appOrigin = `http://${appHost}:${port}`;
  statePath = await mkdtemp(join(tmpdir(), "lamp-start-runtime-"));
  envArgs = isolatedWorkerEnvArgs(statePath);
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", artifactPath, "--persist-to", statePath]);
  await run("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", artifactPath, "--persist-to", statePath, "--command", legacyApiFixtureSql()]);
  sessionId = await insertRealOperatorSession({ persistTo: statePath, configPath: artifactPath });
  // Enable the native form; its submitted address is not a fixture operator,
  // so native auth accepts the request without attempting mail delivery.
  // The cron dispatch probe must also leave queued notification effects paused.
  worker = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--config", artifactPath, ...envArgs, "--persist-to", statePath, "--show-interactive-dev-session=false", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--local-upstream", `${appHost}:${port}`, "--var", `LAMP_PAGE_HOST:${pageHost}`, "--var", `LAMP_APP_HOST:${appHost}`, "--var", `AUTH_ORIGIN:${appOrigin}`, "--var", "AUTH_LOCAL:true", "--var", `SESSION_SECRET:${secret}`, "--var", "SETUP_OPERATOR_EMAIL:operator@example.test", "--var", "MAIL_PROVIDER_API_KEY:test-only-signin-presentation-no-delivery", "--var", "EFFECTS_PAUSED:1", "--log-level", "warn"], {
    cwd: process.cwd(),
    env: fixtureProcessEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  worker.stdout.on("data", (chunk) => { workerOutput += String(chunk); });
  worker.stderr.on("data", (chunk) => { workerOutput += String(chunk); });
  await waitForWorker({
    child: worker,
    output: () => workerOutput,
    label: "Built Worker",
    probe: ({ signal }) => request("/health", appHost, { signal }),
  });
  privateLoaderPath = await clientServerFunctionPath(await emittedServerFunctionId("loadOperatorSession"), { path: "/app" });
});

after(async () => {
  await Promise.all([stopWorker(worker), stopWorker(pageWorker)]);
  await rm(statePath, { recursive: true, force: true });
});

// Shared sign-in is a native form and works before any application JavaScript.
test("sign-in submits with JavaScript disabled", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({javaScriptEnabled:false});
    await page.goto(`${appOrigin}/signin`);
    const email=page.getByLabel('Email',{exact:true});
    assert.equal(await email.isEnabled(),true);
    await email.fill('native-form@example.test');
    const submitted=page.waitForRequest(request=>new URL(request.url()).pathname==='/auth/magic-link'&&request.method()==='POST');
    await page.getByRole('button',{name:'Email a sign-in link'}).click();
    assert.equal(new URLSearchParams((await submitted).postData()).get('email'),'native-form@example.test');
  } finally {await browser.close();}
});

test("DOCS-001 — the built single Worker preserves public docs, Hono/R2, Start auth, dispatch, 404s, and client navigation", { timeout: 120_000 }, async () => {
  const signIn = await request("/signin", appHost, { headers: { "Sec-Fetch-Mode": "navigate" } });
  const signInHtml = await signIn.text();
  assert.equal(signIn.status, 200);
  assert.match(signIn.headers.get("content-type") ?? "", /text\/html/);
  assert.match(signInHtml, /<html/i);
  assert.match(signInHtml, /action="\/auth\/magic-link"/);

  const unauthenticatedDocument = await request("/app", appHost, { redirect: "manual", headers: { "Sec-Fetch-Mode": "navigate" } });
  assert.equal(unauthenticatedDocument.status, 302, "native session preflight must preserve Lamp's unauthenticated redirect");
  assert.equal(unauthenticatedDocument.headers.get("location"), `${appOrigin}/signin?returnTo=%2Fapp`);

  const authenticatedDocument = await appRequest("/app", { headers: { "Sec-Fetch-Mode": "navigate" } });
  const authenticatedHtml = await authenticatedDocument.text();
  assert.equal(authenticatedDocument.status, 200);
  assert.match(authenticatedDocument.headers.get("content-type") ?? "", /text\/html/);
  assert.match(authenticatedHtml, /Contract Operator/);
  assert.match(authenticatedHtml, /operator@example\.test/);

  const nativeSession = await appRequest("/api/app/session", { headers: { Accept: "application/json" } });
  assert.equal(nativeSession.status, 200);
  assert.match(nativeSession.headers.get("content-type") ?? "", /application\/json/);
  assert.equal((await nativeSession.json()).operator.email, "operator@example.test", "Hono API dispatch remains session-protected");

  const privateNoOrigin = await request(privateLoaderPath, appHost, { headers: { "x-tsr-serverfn": "true", Accept: "application/json" } });
  assert.equal(privateNoOrigin.status, 403, "the generated private transport requires a same-origin request");
  const privateCrossOrigin = await request(privateLoaderPath, appHost, { headers: { "x-tsr-serverfn": "true", Accept: "application/json", Origin: "https://attacker.example", Cookie: `${sessionCookieName(appOrigin)}=${sessionId}` } });
  assert.equal(privateCrossOrigin.status, 403, "a hostile Origin cannot invoke an authenticated Start server function");
  const privateNoSession = await request(privateLoaderPath, appHost, { headers: { "x-tsr-serverfn": "true", Accept: "application/json", Origin: appOrigin } });
  const privateNoSessionBody = await privateNoSession.text();
  assert.equal(privateNoSession.status, 200);
  assert.match(privateNoSessionBody, /signin/);
  assert.doesNotMatch(privateNoSessionBody, /Contract Operator|operator@example\.test/);
  const privateSession = await appRequest(privateLoaderPath, { headers: { "x-tsr-serverfn": "true", Accept: "application/json", Origin: appOrigin } });
  const privateSessionBody = await privateSession.text();
  assert.equal(privateSession.status, 200);
  assert.match(privateSessionBody, /Contract Operator/);
  assert.match(privateSessionBody, /operator@example\.test/);

  // This is Wrangler's local control endpoint, rather than a Lamp route: it
  // must target the listener itself so workerd invokes the exported event.
  const scheduled = await request("/cdn-cgi/local/scheduled?cron=*+*+*+*+*", "127.0.0.1");
  assert.equal(scheduled.status, 200, "the Worker keeps the scheduled event entrypoint after Start composition");

  for (const { path, host, hono, auth } of [
    { path: "/not-a-document", host: appHost },
    { path: "/app/not-a-route", host: appHost, auth: true },
    { path: "/app-assets/not-a-real-asset.js", host: appHost },
    { path: "/api/app", host: appHost, hono: true },
    { path: "/api/app/not-a-real-route", host: appHost, hono: true },
  ]) {
    const missing = await request(path, host, { headers: { "Sec-Fetch-Mode": "navigate", ...(hono || auth ? { Cookie: `${sessionCookieName(appOrigin)}=${sessionId}` } : {}) } });
    assert.equal(missing.status, 404, `${path} must be a real HTTP 404`);
    if (hono) assert.doesNotMatch(missing.headers.get("content-type") ?? "", /text\/html/, `${path} must stay in Hono rather than becoming a Start document`);
  }
  const lobby = await request("/", appHost, { headers: { "Sec-Fetch-Mode": "navigate" } });
  assert.equal(lobby.status, 200, "the app host's home page is the Lobby");
  assert.match(lobby.headers.get("content-type") ?? "", /text\/html/);
  const lobbyHtml = await lobby.text();
  const actions = [...lobbyHtml.matchAll(/<a class="btn" href="([^"]+)"/g)];
  assert.equal(actions.length, 1, "the Lobby offers one primary owner entry");
  const entry = new URL(actions[0][1], appOrigin);
  assert.equal(entry.origin, appOrigin, "owner entry stays on the app host");
  assert.equal(entry.pathname, "/signin", "the claimed owner can sign in");
  assert.equal(entry.searchParams.get("login_hint"), "operator@example.test", "local owner entry hints the claimed identity");
  const hintedSignIn = await request(entry.pathname + entry.search, appHost, { headers: { "Sec-Fetch-Mode": "navigate" } });
  assert.equal(hintedSignIn.status, 200);
  const emailInput = (await hintedSignIn.text()).match(/<input\b[^>]*\bname="email"[^>]*>/)?.[0];
  assert.ok(emailInput, "the owner entry reaches the email sign-in form");
  assert.equal(emailInput.match(/\bvalue="([^"]*)"/)?.[1], entry.searchParams.get("login_hint"), "the local owner address is prefilled without submitting the form");
  const formerLanding = await request("/lamp", appHost, { redirect: "manual" });
  assert.equal(formerLanding.status, 301);
  assert.equal(formerLanding.headers.get("location"), `${appOrigin}/`);
  const docs = await request("/docs", appHost, { headers: { "Sec-Fetch-Mode": "navigate" } });
  assert.equal(docs.status, 200, "the app host serves the docs without a session");
  const docsPage = await request("/docs/moving-in", appHost, { headers: { "Sec-Fetch-Mode": "navigate" } });
  assert.equal(docsPage.status, 200, "a docs page is rendered by the built Worker");
  assert.match(await docsPage.text(), /class="docs-prose"/, "from the repository's Markdown compiled into the build");
  assert.equal((await request("/docs/not-a-page", appHost, { headers: { "Sec-Fetch-Mode": "navigate" } })).status, 404, "an unlisted docs address is a real 404");
  const mailEventsOnAppHost = await request("/api/intake/mail-events", appHost, { method: "POST", body: "[]" });
  assert.equal(mailEventsOnAppHost.status, 404, "mail events belong only on the page host");
  // RER's cutover check of a status hostname reads /health there: the page host answers it like the app host.
  const appHealth = await request("/health", appHost);
  assert.equal(appHealth.status, 200);
  const appHealthBody = await appHealth.json();

  const clientFiles = (await filesUnder(resolve("dist/client"))).filter((path) => /\.(?:js|mjs|cjs)$/.test(path));
  const clientBundle = (await Promise.all(clientFiles.map((path) => readFile(path, "utf8")))).join("\n");
  for (const marker of ["cloudflare:workers", "drizzle-orm", "createSnapshotRepository", "createSessionRepository", "SUBSCRIBER_TOKEN_SECRET", "WEBHOOK_SIGNING_SECRET", "MAIL_PROVIDER_API_KEY"]) {
    assert.equal(clientBundle.includes(marker), false, `the emitted browser bundle leaked server-only marker ${marker}`);
  }

  await rebuildPublicSnapshot();
  const browser = await browserNavigationProof();
  await stopWorker(worker);
  await startPageWorker();
  const transportOnPageHost = await pageRequest(privateLoaderPath, { headers: { "x-tsr-serverfn": "true", Accept: "application/json", Origin: appOrigin } });
  assert.equal(transportOnPageHost.status, 404, "the generated Start transport is app-host-only");
  assert.equal((await pageRequest("/signin")).status, 404, "sign-in is app-host-only");
  assert.equal((await pageRequest("/lamp")).status, 404, "the former landing address is app-host-only");
  assert.equal((await pageRequest("/docs")).status, 404, "the docs are app-host-only: the page host's paths are the status snapshot's");
  const pageHealth = await pageRequest("/health");
  assert.equal(pageHealth.status, 200, "the page host answers /health like the app host");
  const pageHealthBody = await pageHealth.json();
  assert.deepEqual(pageHealthBody.deployment, appHealthBody.deployment, "the page host reports the same deployment identity");
  assert.deepEqual(Object.keys(pageHealthBody).sort(), Object.keys(appHealthBody).sort(), "the page host adds nothing to the app host's health body");
  assert.equal((await pageRequest("/health", { method: "POST" })).status, 404, "only the health read is shared");
  const mailEventsOnPageHost = await pageRequest("/api/intake/mail-events", { method: "POST", body: "[]" });
  assert.equal(mailEventsOnPageHost.status, 503, "the unconfigured mail receiver must not be shadowed by generic alert intake");
  const missingPageAsset = await pageRequest("/assets/not-a-real-asset.svg", { headers: { "Sec-Fetch-Mode": "navigate" } });
  assert.equal(missingPageAsset.status, 404, "missing public assets must remain real 404s");
  const snapshotBeforeD1Failure = await waitForPublicSnapshot();
  await run("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", artifactPath, "--persist-to", statePath, "--command", "DROP TABLE page_settings"]);
  const snapshotAfterD1Failure = await pageRequest("/?r2-proof=after-d1-failure");
  assert.equal(snapshotAfterD1Failure.status, 200);
  assert.equal(await snapshotAfterD1Failure.text(), snapshotBeforeD1Failure, "the Hono public route serves its R2 bytes unchanged after D1 is unavailable");

  console.log(JSON.stringify({ status: "passed", artifact: "dist/server/wrangler.json", privateTransport: "/_serverFn/<generated-id>", browser, publicSnapshotReadAfterD1Failure: true }));
});

test("vite dev serves Start's client entry and stylesheet through the app host", { timeout: 120_000 }, async () => {
  const devPort = await reservePort({ label: "Vite dev" });
  const devOrigin = `http://${appHost}:${devPort}`;
  const devStatePath = await mkdtemp(join(tmpdir(), "lamp-start-dev-state-"));
  const devViteCachePath = await mkdtemp(join(tmpdir(), "lamp-start-dev-cache-"));
  const devConfigPath = join(await mkdtemp(join(tmpdir(), "lamp-start-dev-config-")), "wrangler.json");
  await writeFile(devConfigPath, localWranglerConfig(config => ({ ...config, vars: { ...config.vars, LAMP_PAGE_HOST: pageHost, LAMP_APP_HOST: appHost } })));
  let devServer;
  let devOutput = "";
  try {
    await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", devConfigPath, "--persist-to", devStatePath]);
    await run("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", devConfigPath, "--persist-to", devStatePath, "--command", legacyApiFixtureSql()]);
    const devSessionId = await insertRealOperatorSession({ persistTo: devStatePath, configPath: devConfigPath });
    devServer = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(devPort), "--strictPort"], {
      cwd: process.cwd(),
      env: fixtureProcessEnv({ AUTH_ORIGIN:devOrigin,AUTH_LOCAL:"true",SESSION_SECRET:secret,SETUP_OPERATOR_EMAIL:"operator@example.test", LAMP_WORKERS_STATE_PATH: devStatePath, LAMP_VITE_CACHE_DIR: devViteCachePath, LAMP_WRANGLER_CONFIG: devConfigPath, __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: appHost }),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    devServer.stdout.on("data", (chunk) => { devOutput += String(chunk); });
    devServer.stderr.on("data", (chunk) => { devOutput += String(chunk); });
    await waitForWorker({
      child: devServer,
      output: () => devOutput,
      label: "Vite dev",
      probe: ({ signal }) => request("/health", appHost, { signal }, devPort),
    });

    const browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP ${appHost} 127.0.0.1`] });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await context.addCookies([{ name: sessionCookieName(devOrigin), value: devSessionId, url: devOrigin, httpOnly: true, sameSite: "Lax" }]);
      const page = await context.newPage();
      const documents = [];
      const failures = [];
      const errors = [];
      const startAssets = [];
      page.on("request", (event) => {
        if (event.resourceType() === "document") documents.push(new URL(event.url()).pathname);
      });
      page.on("requestfailed", (event) => failures.push(`${event.url()} ${event.failure()?.errorText ?? "failed"}`));
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      page.on("response", (response) => {
        const url = response.url();
        if (url.includes("tanstack-start-dev-client-entry") || url.includes("/@tanstack-start/styles.css")) startAssets.push(`${response.status()} ${url}`);
      });

      await page.goto(`${devOrigin}/app`, { waitUntil: "networkidle" });
      await page.getByText("Contract Operator", { exact: true }).waitFor();
      assert.equal(await page.locator(".operator-shell").evaluate((element) => getComputedStyle(element).display), "grid", "the real operator stylesheet must apply in Vite dev");
      assert.equal(await page.locator(".operator-page-link").getAttribute("href"), `http://${pageHost}:${devPort}/`, "hydration must preserve the request-derived public origin, including its local port");
      const before = await page.evaluate(() => performance.timeOrigin);
      await page.getByRole("link", { name: "Incidents", exact: true }).click();
      await page.waitForURL("**/app/incidents");
      await page.getByRole("heading", { name: "Incidents", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => performance.timeOrigin), before, "Vite dev operator navigation must remain hydrated");
      assert.deepEqual(documents, ["/app"], "Vite dev navigation must not load a second document");
      assert.ok(startAssets.some((asset) => asset.startsWith("200 ") && asset.includes("tanstack-start-dev-client-entry")), "Vite dev must serve TanStack Start's virtual client entry");
      assert.ok(startAssets.some((asset) => asset.startsWith("200 ") && asset.includes("/@tanstack-start/styles.css")), "Vite dev must serve TanStack Start's stylesheet");
      assert.deepEqual(failures.filter((failure) => failure.includes("tanstack-start-dev-client-entry") || failure.includes("/@tanstack-start/styles.css")), [], "Start development assets must not abort");
      assert.deepEqual(errors, [], "Vite dev must hydrate without console or page errors");
    } finally {
      await browser.close();
    }
  } finally {
    await stopWorker(devServer);
    await Promise.all([rm(devStatePath, { recursive: true, force: true }), rm(devViteCachePath, { recursive: true, force: true }), rm(resolve(devConfigPath, ".."), { recursive: true, force: true })]);
  }
});

