import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

import { legacyApiFixtureSql } from "../e2e/fixtures/legacy-api-fixture.mjs";
import { pageOrigin } from "../e2e/helpers/hosts.mjs";
import { reservePort, waitForWorker } from "../e2e/worker-startup.mjs";
import { fixtureFetch as fetch } from "./fixture-fetch.mjs";

const worktreeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sessionRoot = process.env.LAMP_PUBLIC_SNAPSHOT_RUNTIME_DIR ?? resolve(tmpdir(), `lamp-u3-${process.pid}`);
const captureRoot = process.env.LAMP_PUBLIC_SNAPSHOT_CAPTURE_DIR ?? resolve(sessionRoot, "captures");
const safeEnv = () => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}),
  XDG_CONFIG_HOME: resolve(sessionRoot, "config"),
  XDG_CACHE_HOME: resolve(sessionRoot, "cache"),
  XDG_DATA_HOME: resolve(sessionRoot, "data"),
  TMPDIR: resolve(sessionRoot, "tmp"),
  TMP: resolve(sessionRoot, "tmp"),
  TEMP: resolve(sessionRoot, "tmp"),
  LAMP_DEV_OUTBOX_MODE: "local",
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? "0",
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: resolve(sessionRoot, "wrangler.log"),
  CI: "1",
});
const port = Number(process.env.LAMP_PUBLIC_PORT ?? await reservePort({ label: "public snapshot" }));
// Every request here is a public status page read on the page host.
const origin = pageOrigin(port);
const legacyActivePromise = "2026-09-08T03:00:00.000Z";
const legacyResolvedPromise = "2026-09-08T09:00:00.000Z";
// The renderer identity the current source publishes; older pointers must be rebuilt to it.
const rendererVersion = (await readFile(resolve(worktreeRoot, "src/core/features/public-snapshot/service.ts"), "utf8")).match(/PUBLIC_SNAPSHOT_RENDERER_VERSION = "([^"]+)"/)[1];
const activePromiseDisplay = "Sep 7, 2026, 20:00 UTC-07:00";
const resolvedPromiseDisplay = "Sep 8, 2026, 02:00 UTC-07:00";

let statePath;
let viteCachePath;
let server;
let serverOutput = "";

function startWorker(label = "public snapshot Worker") {
  serverOutput = "";
  server = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--mode", "development"], {
    cwd: worktreeRoot,
    stdio: "pipe",
    detached: true,
    env: {
      ...safeEnv(),
      LAMP_DISABLE_INSPECTOR: "true",
      LAMP_WORKERS_STATE_PATH: statePath,
      LAMP_VITE_CACHE_DIR: viteCachePath,
      LAMP_WRANGLER_CONFIG: resolve(worktreeRoot, "wrangler.jsonc"),
    },
  });
  server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });
  return waitForWorker({
    origin,
    child: server,
    output: () => `${serverOutput}\nState: ${statePath}`,
    label,
    probe: async ({ signal }) => {
      const response = await fetch(`${origin}/`, { signal });
      const body = await response.text();
      return { status: response.status === 200 && /Atlas Cloud Status/.test(body) ? 200 : response.status, text: () => body };
    },
  });
}

async function stopWorker() {
  if (server?.pid && server.exitCode === null) {
    const stopped = new Promise((resolveExit) => server.once("exit", resolveExit));
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* Worker already stopped. */ }
    await stopped;
  }
  server = undefined;
}

function run(command, args, { env, ...options } = {}) {
  return execFileSync(command, args, { cwd: worktreeRoot, stdio: "pipe", ...options, env: { ...safeEnv(), ...env } });
}

function runPnpm(args, options = {}) {
  return run("pnpm", args, options);
}

function executeSql(sql) {
  runPnpm(["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", statePath, "--command", sql]);
}

function querySql(sql) {
  const output = runPnpm(["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", statePath, "--command", sql, "--json"], { encoding: "utf8" });
  const result = JSON.parse(output)[0];
  assert.equal(result?.success, true, `local D1 query failed: ${sql}`);
  return result.results;
}

function r2Object(key, input, contentType = "application/json; charset=utf-8") {
  const action = input === undefined ? "get" : "put";
  const args = ["exec", "wrangler", "r2", "object", action, `lamp-local-snapshots/${key}`, "--local", "--persist-to", statePath, "--pipe"];
  if (input !== undefined) args.push("--content-type", contentType);
  return runPnpm(args, { encoding: "utf8", input });
}

function pointer() {
  return JSON.parse(r2Object("snapshots/current.json").trim());
}

async function waitUntil(description, predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  assert.fail(`timed out waiting for ${description}; last value: ${JSON.stringify(last)}`);
}

async function scheduled({ allowFailure = false } = {}) {
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(`${origin}/cdn-cgi/local/scheduled?cron=*+*+*+*+*`);
      if (response.status === 200 || allowFailure) {
        await response.body?.cancel();
        return response;
      }
      if (attempt < 3) await response.body?.cancel();
    } catch (cause) {
      // Miniflare can reset its scheduled-event socket while a build begins.
      if (allowFailure && attempt === 3) return null;
      if (attempt === 3) throw cause;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  assert.equal(response?.status, 200, `local scheduled event failed: ${await response?.text()}\nWorker output: ${serverOutput}`);
}

function resolvedLegacyFixtureSql() {
  let sql = legacyApiFixtureSql();
  const activeIncident = "('01J00000000000000000000020','INC-4821','Elevated API error rates','Monitoring','2026-09-08T00:02:00.000Z',NULL";
  const resolvedIncident = "('01J00000000000000000000020','INC-4821','Elevated API error rates','Resolved','2026-09-08T00:02:00.000Z','2026-09-08T04:00:00.000Z'";
  assert.ok(sql.includes(activeIncident), "the unchanged legacy fixture still contains INC-4821");
  sql = sql.replace(activeIncident, resolvedIncident);
  return `${sql}
INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES
  ('01J00000000000000000000025','01J00000000000000000000020','Resolved','Customers using the Public API in us-east-1 and eu-west-1.','The API has recovered.','Dashboard viewing, user management, and data exports continue to work.','The mitigation is complete.','${legacyResolvedPromise}','2026-09-08T04:00:00.000Z','01J00000000000000000000001','2026-09-08T04:00:00.000Z','2026-09-08T04:00:00.000Z');`;
}

async function settleRebuild() {
  await scheduled();
  return waitUntil("snapshot work to settle", () => {
    const [work] = querySql("SELECT requested_revision, completed_revision FROM public_snapshot_work WHERE id = 'default'");
    return work && Number(work.completed_revision) >= Number(work.requested_revision) ? work : null;
  });
}

async function rebuildFromVersion(version) {
  const before = pointer();
  r2Object("snapshots/current.json", JSON.stringify({ ...before, rendererVersion: version }));
  await scheduled();
  const afterPointer = await waitUntil(`renderer version ${rendererVersion}`, () => {
    const current = pointer();
    return current.rendererVersion === rendererVersion && current.generation > before.generation ? current : null;
  });
  return { before, after: afterPointer };
}

before(async () => {
  await mkdir(resolve(sessionRoot, "tmp"), { recursive: true });
  await mkdir(captureRoot, { recursive: true });
  statePath = await mkdtemp(resolve(sessionRoot, "tmp/lamp-u3-state-"));
  viteCachePath = await mkdtemp(resolve(sessionRoot, "tmp/lamp-u3-vite-"));
  runPnpm(["run", "migrate:local"], { env: { LAMP_WORKERS_STATE_PATH: statePath } });
  // The legacy rows are attribution data inserted after the auth migration.
  // Give this initialized installation its active owner so development can
  // publish the first snapshot; public readers need no session or credentials.
  executeSql(`${resolvedLegacyFixtureSql()}
INSERT INTO oa_operators (id,email,display_name,role,status,created_at)
  SELECT id,email,display_name,'owner','active',unixepoch(created_at) * 1000 FROM operators WHERE is_setup_operator = 1;
INSERT INTO oa_bootstrap (singleton,claim_id,claimed_at)
  SELECT 1,id,created_at FROM oa_operators WHERE role = 'owner';
UPDATE maintenance SET starts_at = '2027-09-09T06:00:00.000Z', ends_at = '2027-09-09T07:00:00.000Z' WHERE reference = 'SCH-144';
DELETE FROM notification_deliveries;`);

  await startWorker();
  await waitUntil("initial snapshot pointer", () => {
    try { return pointer(); } catch { return null; }
  });
  await settleRebuild();
});

after(async () => {
  await stopWorker();
  await Promise.all([
    statePath ? rm(statePath, { recursive: true, force: true }) : Promise.resolve(),
    viteCachePath ? rm(viteCachePath, { recursive: true, force: true }) : Promise.resolve(),
  ]);
});

test("renderer identity rebuilds old and malformed pointers once, while the current identity remains stable", async () => {
  const current = pointer();
  assert.equal(current.rendererVersion, rendererVersion);
  const workBefore = querySql("SELECT requested_revision, completed_revision FROM public_snapshot_work WHERE id = 'default'")[0];
  await scheduled();
  const unchanged = pointer();
  const workAfter = querySql("SELECT requested_revision, completed_revision FROM public_snapshot_work WHERE id = 'default'")[0];
  assert.equal(unchanged.generation, current.generation, "the current renderer identity does not trigger a rebuild loop");
  assert.deepEqual(workAfter, workBefore, "an unchanged renderer does not request new snapshot work");

  const older = await rebuildFromVersion("lamp-public-snapshot-v1");
  assert.ok(older.after.generation > older.before.generation);
  const missingBefore = pointer();
  const { rendererVersion: _removedRendererVersion, ...legacyPointer } = missingBefore;
  r2Object("snapshots/current.json", JSON.stringify(legacyPointer));
  await scheduled();
  const migrated = await waitUntil("legacy pointer migration", () => {
    const value = pointer();
    return value.rendererVersion === rendererVersion && value.generation > missingBefore.generation ? value : null;
  });
  assert.ok(migrated.generation > missingBefore.generation);

  const malformedBefore = pointer();
  r2Object("snapshots/current.json", JSON.stringify({ ...malformedBefore, rendererVersion: { unexpected: true } }));
  await scheduled();
  const repaired = await waitUntil("malformed renderer identity repair", () => {
    const value = pointer();
    return value.rendererVersion === rendererVersion && value.generation > malformedBefore.generation ? value : null;
  });
  assert.ok(repaired.generation > malformedBefore.generation);
});

test("resolved legacy promises stay hidden on every public surface and missing permalinks are branded HTML 404s", async () => {
  const paths = ["/", "/history", "/incidents/INC-4821", "/feed.atom", "/widget.js"];
  const responses = new Map();
  for (const path of paths) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    responses.set(path, await response.text());
  }

  for (const path of ["/", "/history", "/incidents/INC-4821", "/feed.atom", "/widget.js"]) {
    assert.equal(responses.get(path).includes(legacyResolvedPromise), false, `${path} suppresses the resolved legacy timestamp`);
    assert.equal(responses.get(path).includes(resolvedPromiseDisplay), false, `${path} suppresses the resolved legacy promise display`);
  }
  assert.ok(responses.get("/incidents/INC-4821").includes(legacyActivePromise), "the published active promise remains immutable historical content");
  assert.ok(responses.get("/history").includes(legacyActivePromise), "history preserves the active update's original promise");
  assert.ok(responses.get("/feed.atom").includes(activePromiseDisplay), "Atom preserves the active update's original promise");

  const missing = await fetch(`${origin}/incidents/INC-999999`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type") ?? "", /text\/html/);
  assert.ok((missing.headers.get("content-security-policy") ?? "").startsWith(`default-src ${origin};`), "the 404 keeps the page origin's CSP");
  assert.equal(missing.headers.get("x-content-type-options"), "nosniff");
  assert.equal(missing.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  const missingHtml = await missing.text();
  assert.match(missingHtml, /Atlas Cloud Status/);
  assert.match(missingHtml, /We couldn't find that incident/);
  assert.match(missingHtml, /href="\/"[^>]*>Current status/);
  assert.match(missingHtml, /href="\/history"[^>]*>Resolved history/);

  const browser = await chromium.launch({ headless: true, env: safeEnv() });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, javaScriptEnabled: false });
      const response = await page.goto(`${origin}/incidents/INC-999999`, { waitUntil: "networkidle" });
      assert.equal(response?.status(), 404);
      assert.match(await page.locator("body").innerText(), /We couldn't find that incident/);
      const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      assert.ok(dimensions.content <= dimensions.viewport, `${width}px 404 overflows horizontally: ${JSON.stringify(dimensions)}`);
      await page.screenshot({ path: resolve(captureRoot, `missing-permalink-${width}.jpg`), type: "jpeg", quality: 86, fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("failed renderer upgrade keeps last known public bytes readable without D1", async () => {
  const priorPointer = pointer();
  const priorPage = r2Object(`snapshots/${priorPointer.version}/page.html`);
  r2Object("snapshots/current.json", JSON.stringify({ ...priorPointer, rendererVersion: "lamp-public-snapshot-v1" }));
  executeSql("DROP TABLE page_settings");

  await scheduled({ allowFailure: true });
  await waitUntil("failed rebuild stale marker", async () => {
    const response = await fetch(`${origin}/`);
    await response.body?.cancel();
    return response.status === 200 && response.headers.get("x-lamp-snapshot-state") === "stale" ? true : null;
  });

  const afterFailure = pointer();
  assert.deepEqual(afterFailure, { ...priorPointer, rendererVersion: "lamp-public-snapshot-v1" }, "failed renderer work does not advance the public pointer");
  const stalePage = await fetch(`${origin}/`);
  const staleBody = await stalePage.text();
  assert.equal(stalePage.status, 200);
  assert.match(staleBody, /Last known state/);
  assert.match(staleBody, /Atlas Cloud Status/);
  assert.equal(stalePage.headers.get("x-lamp-snapshot-generated-at"), priorPointer.generatedAt);
  assert.equal(staleBody.replace(/<aside role="status"[^>]*>[\s\S]*?<\/aside>/, ""), priorPage.trim(), "the stale label wraps the exact last-known page artifact");

  await stopWorker();
  await startWorker("public snapshot Worker after D1 loss");
  const missing = await fetch(`${origin}/incidents/INC-999998`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /We couldn't find that incident/);
  for (const path of ["/history", "/incidents/INC-4821", "/feed.atom", "/widget.js"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, `${path} is served from the published snapshot after D1 settings are unavailable`);
    await response.body?.cancel();
  }
});
