import { execFile } from "node:child_process";
import { once } from "node:events";
import { ownedGroupMembers } from "../e2e/owned-process-group.mjs";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { waitForWorker } from "../e2e/worker-startup.mjs";
import { startIncidentWorker, stopIncidentWorker } from "./incident-worker.mjs";

test("owned foreign listener preserves concurrent real publication journeys and explicit strict failure", async () => {
  let requests = 0;
  const foreign = createServer((_request, response) => { requests += 1; response.end("foreign listener"); });
  await new Promise((resolve) => foreign.listen(0, "127.0.0.1", resolve));
  const port = foreign.address().port;
  const directory = await mkdtemp(join(tmpdir(), "lamp-t073-collision-"));
  try {
    const env = { ...process.env };
    delete env.LAMP_T073_INCIDENT_PORT;
    delete env.NODE_TEST_CONTEXT;
    const { stdout } = await promisify(execFile)(process.execPath,
      ["--test", "--test-reporter=tap", "tests/t073-u0/t073-incident-publishing.test.mjs"], { env });
    assert.match(stdout, /^# tests 3$/m);
    assert.match(stdout, /^# pass 3$/m);
    assert.match(stdout, /^# fail 0$/m);
    assert.equal(requests, 0, "default publication must use its own spawned app");
    await assert.rejects(startIncidentWorker({ port, statePath: join(directory, "state"), viteCachePath: join(directory, "cache") }),
      (error) => /exited before it became ready/.test(error.message) && new RegExp(`Port ${port} is already in use`).test(error.message));
    assert.equal(requests, 0, "readiness must not probe a listener this child never owned");
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/health`)).text(), "foreign listener");
    assert.equal(foreign.listening, true, "startup failure cleanup must preserve another listener");
  } finally {
    await new Promise((resolve) => foreign.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("a real signalled Vite child cannot satisfy startup during or before a health probe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lamp-t073-signalled-"));
  let server;
  let foreign;
  let output = "";
  try {
    await promisify(execFile)("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", "deploy/wrangler.template.toml", "--persist-to", join(directory, "state")]);
    const worker = await startIncidentWorker({ statePath: join(directory, "state"), viteCachePath: join(directory, "cache"), onOutput: (chunk) => { output += chunk; } });
    server = worker.server;
    let probes = 0;
    await assert.rejects(waitForWorker({ child: server, output: () => output, label: "Signalled Vite", probe: async ({ signal }) => {
      probes += 1;
      const response = await fetch(`${worker.baseUrl}/health`, { signal });
      assert.equal(response.status, 200);
      await stopIncidentWorker(server);
      return response;
    } }), /Signalled Vite exited/);
    assert.equal(probes, 1, "a response cannot establish readiness after its child is signalled");
    assert.equal(server.exitCode, null);
    assert.equal(server.signalCode, "SIGTERM");
    let requests = 0;
    foreign = createServer((_request, response) => { requests += 1; response.end("foreign after exit"); });
    await new Promise((resolve, reject) => {
      foreign.once("error", reject);
      foreign.listen(Number(new URL(worker.baseUrl).port), "127.0.0.1", resolve);
    });
    await assert.rejects(waitForWorker({ origin: worker.baseUrl, child: server, output: () => output, label: "Exited Vite" }), /Exited Vite exited before it became ready/);
    assert.equal(requests, 0, "an exited child's previous announcement must not authorize a foreign health response");
    assert.equal(await (await fetch(`${worker.baseUrl}/health`)).text(), "foreign after exit");
    await new Promise((resolve) => foreign.close(resolve));
    foreign = undefined;
    const restarted = await startIncidentWorker({ statePath: join(directory, "state"), viteCachePath: join(directory, "cache") });
    server = restarted.server;
    const exited = once(server, "exit");
    process.kill(server.pid, "SIGKILL");
    await exited;
    assert.equal(server.signalCode, "SIGKILL");
    assert.ok(ownedGroupMembers(server).length > 0, "leader-only death must leave real descendants for this cleanup regression");
    await stopIncidentWorker(server);
    assert.deepEqual(ownedGroupMembers(server), [], "cleanup must release descendants even when the leader has already died");
  } finally {
    await stopIncidentWorker(server);
    if (foreign?.listening) await new Promise((resolve) => foreign.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
