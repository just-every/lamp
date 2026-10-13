import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { deploymentConfig, renderWranglerToml, resourceNames,  setupPageSettingsStatement } from "../../scripts/ops-config.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { fixtureProcessEnv, isolatedWorkerEnvArgs } from "../helpers/worker-environment.mjs";

const deploymentEnvironment = {
  LAMP_PAGE_HOST: "status.lamp.test",
  LAMP_APP_HOST: "app.lamp.test",
  LAMP_PAGE_NAME: "Lamp",
  LAMP_PAGE_TAGLINE: "System status and incident communication",
  LAMP_PAGE_TIMEZONE: "Australia/Brisbane",
  LAMP_ACCENT_COLOR: "#163C60",
  MAIL_FROM_ADDRESS: "ops@example.test",
  SESSION_SECRET:'test-only-session-secret-'.repeat(3),SETUP_TOKEN:'test-only-setup-token-'.repeat(3),SETUP_OPERATOR_EMAIL: "operator@example.test",
  MAIL_PROVIDER_API_KEY: "01234567890123456789012345678901",
  SUBSCRIBER_TOKEN_SECRET: "abcdefghijklmnopqrstuvwxyz012345",
  WEBHOOK_SIGNING_SECRET: "abcdefghijklmnopqrstuvwxyz012345",
  MAIL_DKIM_SELECTOR: "resend",
  // A real owner may invoke verify with integrations configured in their shell.
  // This local artifact fixture must declare its entire integration surface.
  MAIL_PROVIDER: "resend",
  RESEND_WEBHOOK_SECRET: "",
  SENDGRID_WEBHOOK_PUBLIC_KEY: "",
  RER_MAIL_RELAY_SECRET: "",
  AI_PROVIDER_URL: "",
  AI_PROVIDER_MODEL: "",
  AI_PROVIDER_API_KEY: "",
};

test("generated setup config uses the Start entry and leaves client assets to Vite", () => {
  const ownerEnvironment = process.env;
  let fixture;
  try {
    process.env = { ...ownerEnvironment, LAMP_HOSTING: "workers-dev", LAMP_RESOURCE_PREFIX: "owner-production" };
    fixture = fixtureProcessEnv(deploymentEnvironment);
  } finally {
    process.env = ownerEnvironment;
  }
  const settings = deploymentConfig(fixture, "staging");
  const config = renderWranglerToml(
    settings,
    { ...resourceNames(settings.environment, settings.resourcePrefix), databaseId: "00000000-0000-0000-0000-000000000000" },
  );
  assert.match(config, /^name = "lamp-staging"$/m);
  assert.match(config, /^main = "src\/server\.ts"$/m);
  assert.match(config, /^compatibility_flags = \["nodejs_compat", "global_fetch_strictly_public"\]$/m);
  assert.match(config, /\[assets\]\nbinding = "ASSETS"\nrun_worker_first = true/);
  assert.doesNotMatch(config, /directory = "dist\/client"|not_found_handling/);
});

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: fixtureProcessEnv({ ...deploymentEnvironment, ...options.env }), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise(output) : reject(new Error(`${command} ${args.join(" ")} exited ${code}:\n${output}`)));
  });
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise((resolvePromise) => child.once("exit", resolvePromise));
  // pnpm's wrapper may not forward SIGINT to Wrangler. This test owns the
  // detached group, including workerd; stop that group with a bounded grace.
  const signal = (name) => { try { process.kill(-child.pid, name); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  const force = setTimeout(() => signal("SIGKILL"), 5_000);
  try { signal("SIGTERM"); await stopped; } finally { clearTimeout(force); }
}

async function startBuiltWorker(artifactPath, statePath, localUpstream, readiness = (response) => response.status === 200, variables = []) {
  const port = await reservePort({ label: "built Worker" });
  const envArgs = isolatedWorkerEnvArgs(statePath);
  const readinessPath = localUpstream === "app.lamp.test" ? "/health" : "/";
  const server = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--config", artifactPath, ...envArgs, "--persist-to", statePath, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--local-upstream", localUpstream, "--upstream-protocol", "https", "--log-level", "warn", ...variables.flatMap((value) => ["--var", value])], {
    cwd: process.cwd(),
    env: fixtureProcessEnv(deploymentEnvironment),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += String(chunk); });
  server.stderr.on("data", (chunk) => { output += String(chunk); });
  try { await waitForWorker({
    child: server,
    output: () => output,
    label: `Built Worker for ${localUpstream}`,
    probe: async ({ signal }) => {
      const response = await fetch(`http://127.0.0.1:${port}${readinessPath}`, { headers: { Host: localUpstream }, signal });
      return readiness(response) ? new Response(null, { status: 200 }) : response;
    },
  }); } catch (cause) { await stop(server); throw cause; }
  return { port, server };
}

test("compiled generated Start Worker serves operator routes and prepares fresh managed public snapshots", async () => {
  await run("pnpm", ["run", "deploy", "--", "--dry-run", "--environment", "staging"]);
  const artifactPath = resolve("dist/server/wrangler.json");
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  assert.equal(artifact.main, "index.js");
  assert.equal(artifact.configPath, resolve("wrangler.dry-run.toml"));
  assert.equal(artifact.userConfigPath, resolve("wrangler.dry-run.toml"));
  assert.equal(artifact.assets?.directory, "../client");
  assert.equal(artifact.assets?.binding, "ASSETS");
  assert.equal(artifact.assets?.run_worker_first, true);
  assert.ok(artifact.compatibility_flags?.includes("nodejs_compat"));
  assert.ok(artifact.compatibility_flags?.includes("global_fetch_strictly_public"));

  const statePath = await mkdtemp(join(tmpdir(), "lamp-built-worker-"));
  let server;
  try {
    await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", artifactPath, "--persist-to", statePath]);
    // Deploy uploads the sign-in secrets with the Worker; the local artifact receives them as Worker variables.
    let runtime = await startBuiltWorker(artifactPath, statePath, "app.lamp.test", undefined, ["SESSION_SECRET", "SETUP_TOKEN"].map((name) => `${name}:${deploymentEnvironment[name]}`));
    server = runtime.server;
    const signIn = await fetch(`http://127.0.0.1:${runtime.port}/signin`, { headers: { Host: "app.lamp.test" } });
    assert.equal(signIn.status, 200);
    assert.match(await signIn.text(), /<form method="post" action="\/auth\/magic-link"/, "the built app host serves Base's email-link sign-in");
    const lobby = await fetch(`http://127.0.0.1:${runtime.port}/`, { headers: { Host: "app.lamp.test" } });
    assert.equal(lobby.status, 200, "the app host's home page is the Lobby");
    assert.match(await lobby.text(), /href="\/setup">Finish setup/, "before the owner's claim the Lobby offers Finish setup");
    const docs = await fetch(`http://127.0.0.1:${runtime.port}/docs`, { headers: { Host: "app.lamp.test" } });
    assert.equal(docs.status, 200, "the app host serves the docs");
    const script = (await docs.text()).match(/src="(\/app-assets\/[^\"]+\.js)"/)?.[1];
    assert.ok(script, "a built Start document must refer to the bundled Start client asset");
    const asset = await fetch(`http://127.0.0.1:${runtime.port}${script}`, { headers: { Host: "app.lamp.test" } });
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);
    const workspace = await fetch(`http://127.0.0.1:${runtime.port}/app`, { headers: { Host: "app.lamp.test" }, redirect: "manual" });
    assert.equal(workspace.status, 302, "a signed-out operator document is sent to sign in");
    assert.equal(new URL(workspace.headers.get("location")).pathname, "/signin");
    await stop(server);

    runtime = await startBuiltWorker(artifactPath, statePath, "status.lamp.test", (response) => response.status === 503 || response.status === 200);
    server = runtime.server;
    const page = await fetch(`http://127.0.0.1:${runtime.port}/`, { headers: { Host: "status.lamp.test" } });
    assert.equal(page.status, 503, "the page host reports no snapshot instead of manufacturing all-clear content");
    const operatorPathOnPageHost = await fetch(`http://127.0.0.1:${runtime.port}/signin`, { headers: { Host: "status.lamp.test" } });
    assert.equal(operatorPathOnPageHost.status, 404);
    await stop(server);

    runtime = await startBuiltWorker(artifactPath, statePath, "unknown.lamp.test", () => true);
    server = runtime.server;
    const unknownHost = await fetch(`http://127.0.0.1:${runtime.port}/`, { headers: { Host: "unknown.lamp.test" } });
    assert.equal(unknownHost.status, 404);
    await stop(server);

    // Use a separate D1/R2/DO state with the real installation setup statements.
    // No operator settings mutation or scheduled event creates its first snapshot.
    const managedStatePath = join(statePath, "managed");
    const managedVariables = ["RER_INSTALLATION_ID:lamp-readiness-test"];
    await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", artifactPath, "--persist-to", managedStatePath]);
    const setupConfig = deploymentConfig(deploymentEnvironment, "staging");
    const setupSql = join(statePath, "managed-setup.sql");
    await writeFile(setupSql, `${setupPageSettingsStatement(setupConfig)}\n`);
    await run("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", artifactPath, "--persist-to", managedStatePath, "--file", setupSql]);
    // Each local runtime answers as one host, so the page host and the app host run in turn over one state.
    runtime = await startBuiltWorker(artifactPath, managedStatePath, "status.lamp.test", (response) => response.status === 503, managedVariables);
    server = runtime.server;
    const beforeHealth = await fetch(`http://127.0.0.1:${runtime.port}/`, { headers: { Host: "status.lamp.test" } });
    assert.equal(beforeHealth.status, 503, "managed public reads alone do not manufacture the first snapshot");
    await stop(server);
    runtime = await startBuiltWorker(artifactPath, managedStatePath, "app.lamp.test", () => true, managedVariables);
    server = runtime.server;
    const health = await fetch(`http://127.0.0.1:${runtime.port}/health`, { headers: { Host: "app.lamp.test" }, signal: AbortSignal.timeout(30_000) });
    assert.equal(health.status, 200);
    await stop(server);
    runtime = await startBuiltWorker(artifactPath, managedStatePath, "status.lamp.test", () => true, managedVariables);
    server = runtime.server;
    const readyPage = await fetch(`http://127.0.0.1:${runtime.port}/`, { headers: { Host: "status.lamp.test" }, signal: AbortSignal.timeout(30_000) });
    assert.equal(readyPage.status, 200, "managed health completes the first snapshot before returning");
    assert.match(await readyPage.text(), /Snapshot generated/);
    const generatedAt = readyPage.headers.get("X-Lamp-Snapshot-Generated-At");
    assert.ok(generatedAt && Number.isFinite(Date.parse(generatedAt)));
    for (const path of ["/feed.atom", "/widget.js", "/api/public/status"]) {
      const response = await fetch(`http://127.0.0.1:${runtime.port}${path}`, { headers: { Host: "status.lamp.test" } });
      assert.equal(response.status, 200, `${path} is ready from the same first snapshot`);
      assert.equal(response.headers.get("X-Lamp-Snapshot-Generated-At"), generatedAt);
      if (path === "/api/public/status") {
        const status = await response.json();
        assert.equal(status.generatedAt, generatedAt);
        assert.equal(status.incident, null, "readiness does not create sample incidents");
      }
    }
  } finally {
    if (server) await stop(server);
    await rm(statePath, { recursive: true, force: true });
  }
});
