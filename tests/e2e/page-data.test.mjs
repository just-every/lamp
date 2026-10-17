import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { legacyApiFixtureSql } from "./fixtures/legacy-api-fixture.mjs";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { appHost, appOrigin, pageOrigin } from "./helpers/hosts.mjs";
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

// Both pages share one subscriber signing secret, as a recovery given the original's secrets does.
const signingSecret = { SUBSCRIBER_TOKEN_SECRET: "test-only-page-data-subscriber-secret-cccccccccccc" };

async function startPage(seedSql, vars = () => signingSecret) {
  const port = await reservePort({ label: "Page data Worker" });
  const app = appOrigin(port, vars(`http://${appHost}:${port}`));
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
    subscribers: () => JSON.parse(execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--json", "--config", resolve("wrangler.jsonc"), "--persist-to", state, "--command", "SELECT destination, state, deactivation_reason FROM subscribers ORDER BY destination"], { stdio: "pipe" }).toString())[0].results,
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
const withoutTime = ({ exportedAt: _time, integrity: _integrity, ...file }) => file;

test("Page data restores verified consent and holds unverified addresses until confirmation", async () => {
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
    assert.deepEqual(checked.check.consent, { kept: true, provenance: "verified", emailSubscribers: 2 });

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
  await verifyUntrustedPageDataRestore();
});

async function verifyUntrustedPageDataRestore() {
  const source = await startPage(legacyApiFixtureSql());
  let edited;
  try {
    edited = await (await source.request("/api/app/page-data")).json();
  } finally {
    await source.stop();
  }
  edited.records.subscribers.push({ ...edited.records.subscribers.find((row) => row.destination === "ops-team@atlascloud.example"), id: "01J00000000000000000000098", destination: "bought-list@example.test", confirmed_at: "2026-09-08T00:05:00.000Z" });

  // Local mail lets the owner's send complete; it delivers nothing.
  const destination = await startPage(null, (origin) => ({ ...signingSecret, RER_DEV_KEY: "test-only-page-data-dev-key-dddddddddddd", RER_DEV_ORIGIN: origin }));
  try {
    const { integrity: _integrity, ...unsigned } = edited;
    assert.equal((await (await destination.request("/api/app/page-data/check", json(unsigned))).json()).check.consent.provenance, "unsigned");
    const checked = await (await destination.request("/api/app/page-data/check", json(edited))).json();
    assert.deepEqual(checked.check.consent, { kept: false, provenance: "unverified", emailSubscribers: 2 });
    assert.equal((await destination.request("/api/app/page-data/restore", json(edited))).status, 200);
    const held = "held for page data confirmation";
    assert.deepEqual(destination.subscribers(), [
      { destination: "bought-list@example.test", state: "deactivated", deactivation_reason: held },
      { destination: "https://status-receiver.atlascloud.example/events", state: "active", deactivation_reason: null },
      { destination: "ops-team@atlascloud.example", state: "deactivated", deactivation_reason: held },
    ]);
    assert.equal((await (await destination.request("/api/app/page-data/confirmations")).json()).confirmations.held, 2);

    const sent = await (await destination.request("/api/app/page-data/confirmations", { method: "POST", headers: { Accept: "application/json" } })).json();
    assert.deepEqual(sent.confirmations, { sent: 2, held: 0, deleteAfter: null });
    assert.deepEqual(destination.subscribers().map((row) => row.state), ["pending", "active", "pending"], "a confirmation starts each address's pending window");
  } finally {
    await destination.stop();
  }
}
