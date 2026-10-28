import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { appOrigin, pageOrigin } from "../../e2e/helpers/hosts.mjs";
import { insertRealOperatorSession } from "../../e2e/real-session-helper.mjs";
import { reservePort, waitForWorker } from "../../e2e/worker-startup.mjs";
import { workerBaselineDriver } from "./driver.mjs";
import { localWranglerConfig } from "../../helpers/wrangler-config.mjs";
import { sessionCookieName } from "../../helpers/session-cookie.mjs";

const root = process.cwd();
const secretSentinels = Object.freeze([
  "baseline-subscriber-secret-8a93fe",
]);

function fixtureHeaders(headers = {}) {
  const resolved = new Headers(headers);
  resolved.set("Connection", "close");
  return resolved;
}

async function createFixtureConfig(statePath, omittedBinding = null, bindings = {}) {
  const target = join(statePath, "baseline.wrangler.json");
  await writeFile(target, localWranglerConfig((config) => {
    const vars = { ...config.vars };
    delete vars.SUBSCRIBER_TOKEN_SECRET;
    if (omittedBinding) delete vars[omittedBinding];
    for (const [name, value] of Object.entries(bindings)) if (name in vars) vars[name] = value;
    return { ...config, main: resolve("dist/server/index.js"), assets: { directory: resolve("dist/client"), binding: "ASSETS", run_worker_first: true }, vars };
  }));
  // Local secret input follows Wrangler's secret-file door, so the launcher
  // redacts it in startup diagnostics as a deployed secret would be.
  await writeFile(join(statePath, ".dev.vars"), `SUBSCRIBER_TOKEN_SECRET=${secretSentinels[0]}\n`, { mode: 0o600 });
  return target;
}

function wrangler(statePath, args, options = {}) {
  return execFileSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: root,
    stdio: options.encoding ? ["pipe", "pipe", "pipe"] : "pipe",
    encoding: options.encoding,
    input: options.input,
    env: { ...process.env, LAMP_DISABLE_INSPECTOR: "true" },
  });
}

export async function createBaselineFixture(options = {}) {
  const statePath = await mkdtemp(join(tmpdir(), "lamp-baseline-d1-"));
  const viteCachePath = await mkdtemp(join(tmpdir(), "lamp-baseline-vite-"));
  const misconfigured = Boolean(options.omitBinding || options.bindings);
  const port = await reservePort({ label: "baseline Worker" });
  const appUrl = appOrigin(port);
  const pageUrl = pageOrigin(port);
  const config = await createFixtureConfig(statePath, options.omitBinding ?? null, options.bindings);
  let server;
  let database;
  let logs = "";

  function sql(statement, json = false) {
    if (!database) throw new Error('The baseline data fixture is not initialized.');
    if (json) return database.prepare(statement).all().map(row => ({ ...row }));
    database.exec(statement);
  }

  async function openFixtureDatabase(directory) {
    const files = [];
    async function visit(path) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const name = join(path, entry.name);
        if (entry.isDirectory()) await visit(name);
        else if (entry.name.endsWith('.sqlite') && entry.name !== 'metadata.sqlite') files.push(name);
      }
    }
    await visit(directory);
    const candidates = [];
    for (const file of files) {
      const db = new DatabaseSync(file);
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='components'").get()) candidates.push(db);
      else db.close();
    }
    if (candidates.length !== 1) {
      for (const db of candidates) db.close();
      throw new Error('Could not identify the migrated baseline D1 database.');
    }
    database = candidates[0];
    database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  }

  function r2Object(key, body, contentType) {
    const action = body === undefined ? "get" : "put";
    const args = ["r2", "object", action, `lamp-local-snapshots/${key}`, "--local", "--persist-to", statePath, "--pipe"];
    if (body !== undefined && contentType) args.push("--content-type", contentType);
    return wrangler(statePath, args, { encoding: "utf8", input: body });
  }

  try {
    if (!misconfigured) {
      execFileSync("pnpm", ["run", "migrate:local"], { cwd: root, stdio: "pipe", env: { ...process.env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_DISABLE_INSPECTOR: "true" } });
      await openFixtureDatabase(statePath);
      sql("INSERT INTO page_settings (id,page_name,tagline,accent_color,timezone,hostname,footer_credit_enabled,logo_key,logo_content_type,widget_allowed_origins,mail_from_address,ai_tone_instructions,feed_id,created_at,updated_at) VALUES ('default','Baseline Status','A real local baseline fixture.','#16794C','UTC','status.baseline.test',1,NULL,NULL,'[]','lamp@localhost.invalid','','baseline-feed-identity-0000001','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z');");
      r2Object("snapshots/test-fixture/page.html", "<!doctype html><html><head><title>Baseline Status</title></head><body><main>Baseline Status</main></body></html>", "text/html; charset=utf-8");
      r2Object("snapshots/current.json", JSON.stringify({ version: "test-fixture", generatedAt: "2026-09-08T00:00:00.000Z", generation: 0, sourceRevision: 0 }), "application/json; charset=utf-8");
    }
    server = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--config", config, "--persist-to", statePath, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--test-scheduled", "--show-interactive-dev-session=false"], {
      cwd: root,
      stdio: "pipe",
      detached: true,
      env: { ...process.env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: viteCachePath, LAMP_WRANGLER_CONFIG: config, LAMP_DISABLE_INSPECTOR: "true" },
    });
    server.stdout.on("data", (chunk) => { logs += String(chunk); });
    server.stderr.on("data", (chunk) => { logs += String(chunk); });
    await waitForWorker({
      child: server,
      output: () => logs,
      label: "baseline Worker",
      probe: async ({ signal }) => {
        const response = await fetch(`${appUrl}/health`, { signal });
        if (!misconfigured) return response;
        return { status: 200, text: () => response.text() };
      },
    });

    async function restoreSession() {
      return insertRealOperatorSession({ persistTo: statePath });
    }
    let sessionId = misconfigured ? undefined : await restoreSession();
    const driver = workerBaselineDriver(request => fetch(new Request(request, { headers: fixtureHeaders(request.headers) })));
    return {
      appUrl,
      pageUrl,
      statePath,
      secrets: [...secretSentinels],
      logs: () => logs,
      driver,
      sql,
      r2Object,
      async session() {
        sessionId = await restoreSession();
        return sessionId;
      },
      async appFetch(path, init = {}) {
        return driver.fetch(new Request(`${appUrl}${path}`, {
          ...init,
          // The local scheduled/queue endpoint can retire its keep-alive
          // socket after returning. Each fixture request stays a real HTTP
          // call and fails normally, but never reuses that retired socket.
          headers: fixtureHeaders({ Origin:appUrl, Cookie: `${sessionCookieName(appUrl)}=${sessionId}`, "Content-Type": "application/json", ...(init.headers ?? {}) }),
        }));
      },
      // An anonymous request to the public status page host.
      async fetch(path, init = {}) {
        return driver.fetch(new Request(`${pageUrl}${path}`, { ...init, headers: fixtureHeaders(init.headers) }));
      },
      // An anonymous request to the operator app host.
      async fetchApp(path, init = {}) {
        return driver.fetch(new Request(`${appUrl}${path}`, { ...init, headers: fixtureHeaders({Origin:appUrl,...init.headers}) }));
      },
      assert,
      async dispose() {
        if (server?.pid && server.exitCode === null) {
          const stopped = new Promise((resolveStop) => server.once("exit", resolveStop));
          try { process.kill(-server.pid, "SIGTERM"); } catch { /* already stopped */ }
          await stopped;
        }
        database?.close();
        await Promise.all([rm(statePath, { recursive: true, force: true }), rm(viteCachePath, { recursive: true, force: true })]);
      },
    };
  } catch (error) {
    if (server?.pid && server.exitCode === null) {
      try { process.kill(-server.pid, "SIGTERM"); } catch { /* already stopped */ }
    }
    database?.close();
    await Promise.all([rm(statePath, { recursive: true, force: true }), rm(viteCachePath, { recursive: true, force: true })]);
    throw error;
  }
}
