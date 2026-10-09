import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { insertRealOperatorSession } from "../../e2e/real-session-helper.mjs";
import { reservePort, waitForWorker } from "../../e2e/worker-startup.mjs";
import { workerBaselineDriver } from "./driver.mjs";

const root = process.cwd();
const configTemplate = resolve("deploy/wrangler.template.toml");
const secretSentinels = Object.freeze([
  "baseline-subscriber-secret-8a93fe",
]);

function fixtureHeaders(headers = {}) {
  const resolved = new Headers(headers);
  resolved.set("Connection", "close");
  return resolved;
}

async function createFixtureConfig(statePath, omittedBinding = null) {
  const target = join(statePath, "baseline.wrangler.toml");
  const template = await readFile(configTemplate, "utf8");
  const withAbsolutePaths = template
    .replace('main = "../src/server.ts"', `main = ${JSON.stringify(resolve("src/server.ts"))}`)
    .replace('migrations_dir = "../migrations/core"', `migrations_dir = ${JSON.stringify(resolve("migrations/core"))}`);
  let config = withAbsolutePaths.replace(
    'MAIL_FROM_ADDRESS = "lamp@localhost.invalid"',
    `MAIL_FROM_ADDRESS = "lamp@localhost.invalid"\nSUBSCRIBER_TOKEN_SECRET = ${JSON.stringify(secretSentinels[0])}`,
  );
  if (omittedBinding) config = config.replace(new RegExp(`^${omittedBinding} = .+\\n`, "m"), "");
  await writeFile(target, config);
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
  const config = await createFixtureConfig(statePath, options.omitBinding ?? null);
  const port = await reservePort({ label: "baseline Worker" });
  const baseUrl = `http://127.0.0.1:${port}`;
  let server;
  let logs = "";

  function sql(statement, json = false) {
    const output = wrangler(statePath, ["d1", "execute", "DB", "--local", "--config", config, "--persist-to", statePath, "--command", statement, ...(json ? ["--json"] : [])], { encoding: json ? "utf8" : undefined });
    return json ? JSON.parse(output)[0]?.results ?? [] : undefined;
  }

  function r2Object(key, body, contentType) {
    const action = body === undefined ? "get" : "put";
    const args = ["r2", "object", action, `lamp-local-snapshots/${key}`, "--local", "--persist-to", statePath, "--pipe"];
    if (body !== undefined && contentType) args.push("--content-type", contentType);
    return wrangler(statePath, args, { encoding: "utf8", input: body });
  }

  try {
    execFileSync("pnpm", ["run", "migrate:local"], { cwd: root, stdio: "pipe", env: { ...process.env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_DISABLE_INSPECTOR: "true" } });
    sql("INSERT INTO page_settings (id,page_name,tagline,accent_color,timezone,hostname,footer_credit_enabled,logo_key,logo_content_type,widget_allowed_origins,mail_from_address,ai_tone_instructions,feed_id,created_at,updated_at) VALUES ('default','Baseline Status','A real local baseline fixture.','#16794C','UTC','status.baseline.test',1,NULL,NULL,'[]','lamp@localhost.invalid','','baseline-feed-identity-0000001','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z');");
    r2Object("snapshots/test-fixture/page.html", "<!doctype html><html><head><title>Baseline Status</title></head><body><main>Baseline Status</main></body></html>", "text/html; charset=utf-8");
    r2Object("snapshots/current.json", JSON.stringify({ version: "test-fixture", generatedAt: "2026-09-08T00:00:00.000Z", generation: 0, sourceRevision: 0 }), "application/json; charset=utf-8");
    server = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
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
        const response = await fetch(`${baseUrl}/health`, { signal });
        if (!options.omitBinding) return response;
        return { status: 200, text: () => response.text() };
      },
    });

    async function restoreSession() {
      return insertRealOperatorSession({ persistTo: statePath });
    }
    let sessionId = await restoreSession();
    const driver = workerBaselineDriver((request) => fetch(request));
    return {
      baseUrl,
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
        sessionId = await restoreSession();
        return driver.fetch(new Request(`${baseUrl}${path}`, {
          ...init,
          // The local scheduled/queue endpoint can retire its keep-alive
          // socket after returning. Each fixture request stays a real HTTP
          // call and fails normally, but never reuses that retired socket.
          headers: fixtureHeaders({ Cookie: `lamp_session=${sessionId}`, "Content-Type": "application/json", ...(init.headers ?? {}) }),
        }));
      },
      async fetch(path, init = {}) {
        return driver.fetch(new Request(`${baseUrl}${path}`, { ...init, headers: fixtureHeaders(init.headers) }));
      },
      assert,
      async dispose() {
        if (server?.pid && server.exitCode === null) {
          const stopped = new Promise((resolveStop) => server.once("exit", resolveStop));
          try { process.kill(-server.pid, "SIGTERM"); } catch { /* already stopped */ }
          await stopped;
        }
        await Promise.all([rm(statePath, { recursive: true, force: true }), rm(viteCachePath, { recursive: true, force: true })]);
      },
    };
  } catch (error) {
    if (server?.pid && server.exitCode === null) {
      try { process.kill(-server.pid, "SIGTERM"); } catch { /* already stopped */ }
    }
    await Promise.all([rm(statePath, { recursive: true, force: true }), rm(viteCachePath, { recursive: true, force: true })]);
    throw error;
  }
}
