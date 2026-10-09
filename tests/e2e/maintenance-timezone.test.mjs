import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";

let worker, browser, context, page, statePath, cachePath, origin, sessionId;
let output = "";
before(async () => {
  const port = await reservePort({ label: "Maintenance timezone Worker" });
  origin = `http://127.0.0.1:${port}`;
  statePath = await mkdtemp(join(tmpdir(), "lamp-maintenance-timezone-d1-"));
  cachePath = await mkdtemp(join(tmpdir(), "lamp-maintenance-timezone-vite-"));
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", "deploy/wrangler.template.toml", "--persist-to", statePath], { stdio: "pipe" });
  sessionId = await insertRealOperatorSession({ persistTo: statePath });
  worker = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    detached: true, stdio: "pipe", env: { ...process.env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: cachePath, LAMP_DISABLE_INSPECTOR: "true" },
  });
  worker.stdout.on("data", chunk => { output += chunk; });
  worker.stderr.on("data", chunk => { output += chunk; });
  await waitForWorker({ origin, child: worker, output: () => output, label: "Maintenance timezone Worker" });
  browser = await chromium.launch();

});
after(async () => {
  await browser?.close();
  if (worker && worker.exitCode === null) {
    const closed = new Promise(resolve => worker.once("close", resolve));
    try { process.kill(-worker.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    await closed;
  }
  await Promise.all([statePath, cachePath].filter(Boolean).map(path => rm(path, { recursive: true, force: true })));
});

async function api(path, method = "GET", body) {
  const response = await context.request.fetch(`${origin}${path}`, { method, ...(body ? { data: body } : {}) });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}

for (const scenario of [
  { zone: "Australia/Brisbane", start: "2027-07-15T12:33:35.597Z", end: "2027-07-15T14:33:42.123Z", localStart: "2027-07-15T22:33", localEnd: "2027-07-16T00:33", edit: "2027-07-15T23:00", expected: "2027-07-15T13:00:00.000Z" },
  { zone: "America/New_York", start: "2027-07-15T12:33:35.597Z", end: "2027-07-15T14:33:42.123Z", localStart: "2027-07-15T08:33", localEnd: "2027-07-15T10:33", edit: "2027-07-15T09:00", expected: "2027-07-15T13:00:00.000Z" },
  // The second occurrence of 01:33 must survive an untouched reschedule.
  { zone: "America/New_York", start: "2027-11-07T06:33:35.597Z", end: "2027-11-07T08:33:42.123Z", localStart: "2027-11-07T01:33", localEnd: "2027-11-07T03:33", edit: "2027-11-07T02:00", expected: "2027-11-07T07:00:00.000Z" },
]) {
  test(`native maintenance preserves and edits instants in ${scenario.zone} at ${scenario.start}`, async () => {
    context = await browser.newContext({ timezoneId: scenario.zone });
    await context.addCookies([{ name: "lamp_session", value: sessionId, url: origin }]);
    page = await context.newPage();
    try {
      const { component } = await api("/api/app/components", "POST", { groupId: null, name: `Timezone ${scenario.start} ${scenario.zone}`, description: "", internal: false, displayOrder: 1, note: "" });
      const { maintenance } = await api("/api/app/maintenance", "POST", { title: "Timezone window", startsAt: scenario.start, endsAt: scenario.end, componentIds: [component.id] });
      await page.goto(`${origin}/app/maintenance`);
      const row = page.locator(".maintenance-row").filter({ hasText: maintenance.reference });
      const start = row.getByLabel(`${maintenance.reference} start`, { exact: true });
      const end = row.getByLabel(`${maintenance.reference} end`, { exact: true });
      await row.getByText("Change dates", { exact: true }).click();
      await start.waitFor();
      assert.equal(await start.inputValue(), scenario.localStart);
      assert.equal(await end.inputValue(), scenario.localEnd);
      async function saveAndCheck(expectedStart, expectedEnd) {
        const response = page.waitForResponse(r => r.url().endsWith(`/maintenance/${maintenance.id}/window`) && r.request().method() === "PUT");
        await row.getByRole("button", { name: "Reschedule", exact: true }).click();
        assert.equal((await response).status(), 200);
        const stored = (await api("/api/app/maintenance")).maintenance.find(item => item.id === maintenance.id);
        assert.equal(stored.startsAt, expectedStart);
        assert.equal(stored.endsAt, expectedEnd);
        await page.reload();
        await row.getByText("Change dates", { exact: true }).click();
        await start.waitFor();
      }
      await saveAndCheck(scenario.start, scenario.end);
      await start.fill(scenario.edit);
      await saveAndCheck(scenario.expected, scenario.end);
      assert.equal(await start.inputValue(), scenario.edit);
      assert.equal(await end.inputValue(), scenario.localEnd);
      // Editing only the end also preserves the independently recorded start.
      await end.fill(scenario.localEnd.slice(0, -2) + "45");
      const expectedEnd = await end.evaluate(input => new Date(input.value).toISOString());
      await saveAndCheck(scenario.expected, expectedEnd);
      await saveAndCheck(scenario.expected, expectedEnd);
    } finally { await context.close(); }
  });
}
