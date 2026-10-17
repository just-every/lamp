import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { legacyApiFixtureSql } from "./fixtures/legacy-api-fixture.mjs";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { appOrigin, pageOrigin } from "./helpers/hosts.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { fixtureFetch as fetch } from "../public-snapshots/fixture-fetch.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";

const logo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jm4kAAAAASUVORK5CYII=", "base64");

// A former teammate authored one update; subscribers hold every consent state.
const ownerHistorySql = `
INSERT INTO oa_operators (id,email,display_name,role,status,created_at) VALUES ('01J00000000000000000000099','former@example.test','Former Teammate','owner','inactive',1788825600000);
INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES
  ('01J00000000000000000000025','01J00000000000000000000020','Investigating','API customers','Some requests fail.','Dashboards','We are investigating.',NULL,'2026-09-08T00:30:00.000Z','01J00000000000000000000099','2026-09-08T00:30:00.000Z','2026-09-08T00:30:00.000Z');
INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,deactivation_reason,deactivated_at,created_at,updated_at) VALUES
  ('01J00000000000000000000044','email','left@customer.example',NULL,'deactivated','all','fixture-left','unsubscribed','2026-09-10T00:00:00.000Z','2026-09-08T00:00:00.000Z','2026-09-10T00:00:00.000Z'),
  ('01J00000000000000000000045','email','pending@customer.example',NULL,'pending','all','fixture-pending',NULL,NULL,'2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z');
INSERT INTO subscriber_tokens (id,subscriber_id,scope,token_hash,expires_at,revoked_at,created_at,updated_at) VALUES
  ('01J00000000000000000000060','01J00000000000000000000040','confirm','fixture-confirm-40','2026-09-11T00:00:00.000Z','2026-09-08T00:05:00.000Z','2026-09-08T00:00:00.000Z','2026-09-08T00:05:00.000Z'),
  ('01J00000000000000000000061','01J00000000000000000000044','confirm','fixture-confirm-44','2026-09-11T00:00:00.000Z','2026-09-08T00:06:00.000Z','2026-09-08T00:00:00.000Z','2026-09-08T00:06:00.000Z'),
  ('01J00000000000000000000062','01J00000000000000000000044','manage','fixture-manage-44',NULL,'2026-09-10T00:00:00.000Z','2026-09-08T00:06:00.000Z','2026-09-10T00:00:00.000Z');
INSERT INTO reference_counters (namespace,last_number) VALUES ('INC',4821) ON CONFLICT(namespace) DO UPDATE SET last_number=excluded.last_number;
`;

async function startPage(seedSql) {
  const port = await reservePort({ label: "Page data Worker" });
  const app = appOrigin(port);
  const state = await mkdtemp(join(tmpdir(), "lamp-page-data-d1-"));
  const cache = await mkdtemp(join(tmpdir(), "lamp-page-data-vite-"));
  execFileSync("pnpm", ["run", "migrate:local"], { stdio: "pipe", env: { ...process.env, LAMP_WORKERS_STATE_PATH: state } });
  if (seedSql) execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", resolve("wrangler.jsonc"), "--persist-to", state, "--command", seedSql], { stdio: "pipe" });
  const server = spawn("pnpm", ["exec", "vite", "--host", "0.0.0.0", "--port", String(port), "--strictPort"], {
    stdio: "pipe",
    detached: true,
    env: { ...process.env, LAMP_DISABLE_INSPECTOR: "true", LAMP_WORKERS_STATE_PATH: state, LAMP_VITE_CACHE_DIR: cache },
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += String(chunk); });
  server.stderr.on("data", (chunk) => { output += String(chunk); });
  await waitForWorker({ origin: app, child: server, output: () => output, label: "Page data Worker" });
  const session = await insertRealOperatorSession({ persistTo: state });
  const cookie = `${sessionCookieName(app)}=${session}`;
  return {
    page: pageOrigin(port),
    request: (path, init = {}) => fetch(`${app}${path}`, { ...init, headers: { Cookie: cookie, Origin: app, ...init.headers } }),
    async stop() {
      if (server.pid && server.exitCode === null) {
        const stopped = new Promise((resolveStopped) => server.once("exit", resolveStopped));
        try { process.kill(-server.pid, "SIGTERM"); } catch { /* already exited */ }
        await stopped;
      }
      await Promise.all([rm(state, { recursive: true, force: true }), rm(cache, { recursive: true, force: true })]);
    },
  };
}

const json = (body) => ({ method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Accept: "application/json" } });
const withoutTime = ({ exportedAt: _time, ...file }) => file;

test("The owner's page data downloads from the app and restores identically into a new installation", async () => {
  const source = await startPage(`${legacyApiFixtureSql()}\n${ownerHistorySql}`);
  let exported;
  try {
    const form = new FormData();
    form.set("logo", new Blob([logo], { type: "image/png" }), "logo.png");
    assert.equal((await source.request("/api/app/page-settings/logo", { method: "POST", body: form, headers: { Accept: "application/json" } })).status, 200);
    const download = await source.request("/api/app/page-data");
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /attachment; filename=lamp-page-data-\d{4}-\d{2}-\d{2}\.json/);
    exported = await download.json();
    assert.equal(exported.format, "lamp-page-data");
    assert.equal(exported.page.logo.base64, logo.toString("base64"));
    assert.deepEqual(exported.people.map((person) => person.email), ["former@example.test", "operator@example.test"]);
    const subscribers = Object.fromEntries(exported.records.subscribers.map((row) => [row.destination, row]));
    assert.equal(subscribers["ops-team@atlascloud.example"].confirmed_at, "2026-09-08T00:05:00.000Z");
    assert.equal(subscribers["left@customer.example"].state, "deactivated");
    assert.equal(subscribers["left@customer.example"].confirmed_at, "2026-09-08T00:06:00.000Z");
    assert.equal(subscribers["pending@customer.example"].confirmed_at, null);
    assert.ok(exported.records.subscribers.every((row) => !("token_hash" in row)), "an installation credential left in the file");
    assert.ok(exported.records.incident_updates.some((row) => row.author_email === "former@example.test"));

    const populated = await (await source.request("/api/app/page-data/check", json(exported))).json();
    assert.equal(populated.check.ok, false, "a page that already holds records must refuse a restore");
    assert.match(populated.check.problems[0], /already holds/);
  } finally {
    await source.stop();
  }

  const destination = await startPage();
  try {
    const foreign = await (await destination.request("/api/app/page-data/check", json({ page: {} }))).json();
    assert.match(foreign.check.problems[0], /not a Lamp page data file/);
    const checked = await (await destination.request("/api/app/page-data/check", json(exported))).json();
    assert.equal(checked.check.ok, true, checked.check.problems.join(" "));
    assert.equal(checked.check.counts.subscribers, 4);

    const restored = await destination.request("/api/app/page-data/restore", json(exported));
    assert.equal(restored.status, 200, JSON.stringify(await restored.clone().json()));
    const again = await (await destination.request("/api/app/page-data")).json();
    assert.deepEqual(withoutTime(again), withoutTime(exported));

    const publicPage = await (await fetch(`${destination.page}/`)).text();
    assert.match(publicPage, /Elevated API error rates/);
    const repeat = await destination.request("/api/app/page-data/restore", json(exported));
    assert.equal(repeat.status, 409, "a second restore must not duplicate the page");
  } finally {
    await destination.stop();
  }
});
