import {secret} from '../auth-adoption/runtime.mjs';
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

import { legacyApiFixtureSql } from "./fixtures/legacy-api-fixture.mjs";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";
import { fixtureProcessEnv, isolatedWorkerEnvArgs } from "../helpers/worker-environment.mjs";

const appHost = "127.0.0.1";
const pageHost = "localhost";
let artifactPath;

let appOrigin = "";
let port;
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
    executablePath: process.env.LAMP_CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--use-mock-keychain", "--password-store=basic", `--host-resolver-rules=MAP ${appHost} 127.0.0.1`],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
    await directDetail.getByRole("heading", { name: "Update draft", exact: true }).waitFor();
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
    await page.getByRole("heading", { name: "Update draft", exact: true }).waitFor();
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
  // Wrangler's local metadata belongs to this fixture, never the shared build.
  const builtPath = resolve("dist/server/wrangler.json");
  const built = JSON.parse(await readFile(builtPath, "utf8"));
  const builtDirectory = dirname(builtPath);
  artifactPath = join(statePath, "wrangler.json");
  await writeFile(artifactPath, JSON.stringify({
    ...built, main: resolve(builtDirectory, built.main),
    assets: { ...built.assets, directory: resolve(builtDirectory, built.assets.directory) },
    d1_databases: built.d1_databases.map(database => ({ ...database, migrations_dir: resolve(builtDirectory, database.migrations_dir) })),
  }));
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
});

after(async () => {
  await Promise.all([stopWorker(worker), stopWorker(pageWorker)]);
  await rm(statePath, { recursive: true, force: true });
});

test("DOCS-001 PAGE-020 — the built single Worker preserves public docs, Hono/R2, Start auth, dispatch, 404s, and client navigation", { timeout: 240_000 }, async () => {
  {
  const browser = await chromium.launch({
    executablePath: process.env.LAMP_CHROMIUM_PATH, headless: true, args: ["--no-sandbox", "--use-mock-keychain", "--password-store=basic"] });
  try {
    const page=await browser.newPage({javaScriptEnabled:false,viewport:{width:1440,height:1000}});
    await page.goto(`${appOrigin}/signin`);
    const email=page.getByLabel('Email',{exact:true});
    assert.equal(await email.isEnabled(),true);
    await email.fill('native-form@example.test');
    const submitted=page.waitForRequest(request=>new URL(request.url()).pathname==='/auth/magic-link'&&request.method()==='POST');
    await page.getByRole('button',{name:'Email a sign-in link'}).click();
    assert.equal(new URLSearchParams((await submitted).postData()).get('email'),'native-form@example.test');
  } finally {await browser.close();}
  }
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
  assert.ok(actions.length, "the Lobby offers the owner a sign-in entry");
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
  const vpat = await request("/docs/accessibility/vpat", appHost, { headers: { "Sec-Fetch-Mode": "navigate" } });
  assert.equal(vpat.status, 200, "PAGE-020: nested VPAT document is public on the app host");
  const vpatHtml = await vpat.text();
  assert.ok(vpatHtml.length > 0, "the accessibility report is served as a document");
  assert.equal((await request("/docs/not-a-page", appHost, { headers: { "Sec-Fetch-Mode": "navigate" } })).status, 404, "an unlisted docs address is a real 404");
  const mailEventsOnAppHost = await request("/api/intake/mail-events", appHost, { method: "POST", body: "[]" });
  assert.equal(mailEventsOnAppHost.status, 404, "mail events belong only on the page host");
  // RER's cutover check of a status hostname reads /health there: the page host answers it like the app host.
  const appHealth = await request("/health", appHost);
  assert.equal(appHealth.status, 200);
  const appHealthBody = await appHealth.json();

  await rebuildPublicSnapshot();
  const browser = await browserNavigationProof();
  await stopWorker(worker);
  await startPageWorker();
  assert.equal((await pageRequest("/signin")).status, 404, "sign-in is app-host-only");
  assert.equal((await pageRequest("/lamp")).status, 404, "the former landing address is app-host-only");
  assert.equal((await pageRequest("/docs")).status, 404, "the docs are app-host-only: the page host's paths are the status snapshot's");
  const pageHealth = await pageRequest("/health");
  assert.equal(pageHealth.status, 200, "the page host answers /health like the app host");
  const pageHealthBody = await pageHealth.json();
  assert.deepEqual(pageHealthBody.deployment, appHealthBody.deployment, "the page host reports the same deployment identity");
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

  console.log(JSON.stringify({ status: "passed", artifact: "dist/server/wrangler.json", browser, publicSnapshotReadAfterD1Failure: true }));
});

