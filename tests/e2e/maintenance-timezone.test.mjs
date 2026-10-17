import {appOrigin} from './helpers/hosts.mjs';
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";
import { operatorHydrated } from "./helpers/operator-hydrated.mjs";

let worker, browser, context, page, statePath, cachePath, origin, sessionId;
let output = "";
before(async () => {
  const port = await reservePort({ label: "Maintenance timezone Worker" });
  origin = appOrigin(port);
  statePath = await mkdtemp(join(tmpdir(), "lamp-maintenance-timezone-d1-"));
  cachePath = await mkdtemp(join(tmpdir(), "lamp-maintenance-timezone-vite-"));
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", statePath], { stdio: "pipe" });
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
  const response = await context.request.fetch(`${origin}${path}`, { method, headers:{Origin:origin}, ...(body ? { data: body } : {}) });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}

test("Native maintenance editing preserves instants across configured zones and daylight saving", async t => {
  for (const scenario of [
  { zone: "Australia/Brisbane", start: "2027-07-15T12:33:35.597Z", end: "2027-07-15T14:33:42.123Z", localStart: "2027-07-15T22:33", localEnd: "2027-07-16T00:33", edit: "2027-07-15T23:00", expected: "2027-07-15T13:00:00.000Z" },
  { zone: "America/New_York", start: "2027-07-15T12:33:35.597Z", end: "2027-07-15T14:33:42.123Z", localStart: "2027-07-15T08:33", localEnd: "2027-07-15T10:33", edit: "2027-07-15T09:00", expected: "2027-07-15T13:00:00.000Z" },
  // The second occurrence of 01:33 must survive an untouched reschedule.
  { zone: "America/New_York", start: "2027-11-07T06:33:35.597Z", end: "2027-11-07T08:33:42.123Z", localStart: "2027-11-07T01:33", localEnd: "2027-11-07T03:33", edit: "2027-11-07T02:00", expected: "2027-11-07T07:00:00.000Z" },
]) {
  t.diagnostic(`native maintenance preserves and edits configured-zone instants despite a different browser zone in ${scenario.zone} at ${scenario.start}`);
    await (async () => {
    context = await browser.newContext({ timezoneId: "America/Los_Angeles" });
    await context.addCookies([{ name: sessionCookieName(origin), value: sessionId, url: origin }]);
    page = await context.newPage();
    try {
      const { settings } = await api("/api/app/page-settings");
      const { pageName, tagline, accentColor, hostname, footerCreditEnabled, widgetAllowedOrigins, mailFromAddress } = settings;
      await api("/api/app/page-settings", "PUT", { pageName, tagline, accentColor, hostname, footerCreditEnabled, widgetAllowedOrigins, mailFromAddress, timezone: scenario.zone });
      const { component } = await api("/api/app/components", "POST", { groupId: null, name: `Timezone ${scenario.start} ${scenario.zone}`, description: "", internal: false, displayOrder: 1, note: "" });
      const { maintenance } = await api("/api/app/maintenance", "POST", { title: "Timezone window", affectedAudience: "Customers of the timezone service", customerImpact: "The service may be unavailable during the displayed window.", startsAt: scenario.start, endsAt: scenario.end, componentIds: [component.id] });
      await page.goto(`${origin}/app/maintenance`);
      await operatorHydrated(page);
      const row = page.locator(".maintenance-row").filter({ hasText: maintenance.reference });
      const start = row.getByLabel(`${maintenance.reference} start`, { exact: true });
      const end = row.getByLabel(`${maintenance.reference} end`, { exact: true });
      await row.getByText("Change dates", { exact: true }).click();
      await start.waitFor();
      assert.match(await row.innerText(), new RegExp(scenario.zone));
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
        await operatorHydrated(page);
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
      const expectedEnd = new Date(Date.parse(scenario.end) + (45 - 33) * 60000).toISOString().replace(/:\d{2}\.\d{3}Z$/, ":00.000Z");
      await saveAndCheck(scenario.expected, expectedEnd);
      await saveAndCheck(scenario.expected, expectedEnd);
    } finally { await context.close(); }
  })(t);
}
});

test("maintenance creation, correction and historical incident entry all use the configured page zone", async () => {
  context = await browser.newContext({ timezoneId: "America/Los_Angeles" });
  await context.addCookies([{ name: sessionCookieName(origin), value: sessionId, url: origin }]);
  page = await context.newPage();
  try {
    const { settings } = await api("/api/app/page-settings");
    const { pageName, tagline, accentColor, hostname, footerCreditEnabled, widgetAllowedOrigins, mailFromAddress } = settings;
    const configure = timezone => api("/api/app/page-settings", "PUT", { pageName, tagline, accentColor, hostname, footerCreditEnabled, widgetAllowedOrigins, mailFromAddress, timezone });
    await configure("Australia/Brisbane");
    const { component } = await api("/api/app/components", "POST", { groupId: null, name: "Configured-zone service", description: "", internal: false, displayOrder: 200, note: "" });
    await page.goto(`${origin}/app/maintenance`);
    await operatorHydrated(page);
    const create = page.locator(".maintenance-schedule-card");
    await create.getByLabel("Title", { exact: true }).fill("Configured-zone window");
    await create.getByLabel("Affected audience", { exact: true }).fill("Customers of the configured-zone service");
    await create.getByLabel("Customer impact", { exact: true }).fill("The service may be unavailable during the displayed window.");
    await create.getByLabel("Configured-zone service", { exact: true }).check();
    await create.getByLabel("Starts", { exact: true }).fill("2027-07-15T09:00");
    await create.getByLabel("Ends", { exact: true }).fill("2027-07-15T10:00");
    await create.getByText("Private draft saved", { exact: true }).waitFor();
    await create.getByRole("button", { name: "Preview notice", exact: true }).click();
    await create.getByRole("region", { name: "Public page and email preview", exact: true }).waitFor();
    const created = page.waitForResponse(response => response.url().endsWith("/api/app/maintenance") && response.request().method() === "POST");
    await create.getByRole("button", { name: "Schedule window", exact: true }).click();
    const window = (await (await created).json()).maintenance;
    assert.equal(window.startsAt, "2027-07-14T23:00:00.000Z"); assert.equal(window.endsAt, "2027-07-15T00:00:00.000Z");
    await page.goto(`${origin}/app/components`);
    await page.locator(".component-row").filter({ hasText: "Configured-zone service" }).getByRole("button", { name: "Status history", exact: true }).click();
    const drawer = page.getByRole("dialog");
    assert.match(await drawer.innerText(), /Australia\/Brisbane/);
    await drawer.getByLabel("Starts at", { exact: true }).fill("2020-07-15T09:00");
    await drawer.getByLabel("Ends at", { exact: true }).fill("2020-07-15T10:00");
    await drawer.getByLabel("Reason", { exact: true }).fill("Recorded outage interval");
    const corrected = page.waitForResponse(response => response.url().endsWith(`/components/${component.id}/history-corrections`));
    await drawer.getByRole("button", { name: "Record correction", exact: true }).click();
    assert.equal((await corrected).status(), 204);
    const correction = (await api(`/api/app/components/${component.id}/history`)).corrections[0];
    assert.equal(correction.startsAt, "2020-07-14T23:00:00.000Z"); assert.equal(correction.endsAt, "2020-07-15T00:00:00.000Z");
    await page.goto(`${origin}/app/incidents`);
    await page.getByRole("button", { name: "Create incident", exact: true }).click();
    await page.getByLabel("Incident title", { exact: true }).fill("Historical configured-zone incident");
    await page.getByLabel("Affected component 1", { exact: true }).selectOption(component.id);
    await page.getByLabel("Opened at", { exact: true }).fill("2020-07-15T09:00");
    const opened = page.waitForResponse(response => response.url().endsWith("/api/app/incidents") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Create incident draft", exact: true }).click();
    assert.equal((await (await opened).json()).incident.openedAt, "2020-07-14T23:00:00.000Z");
    await configure("America/New_York");
    await page.goto(`${origin}/app/maintenance`);
    await operatorHydrated(page);
    await create.getByLabel("Starts", { exact: true }).fill("2027-03-14T02:30");
    await create.getByLabel("Ends", { exact: true }).fill("2027-03-14T04:00");
    await create.getByRole("alert").waitFor();
    assert.equal(await create.getByRole("button", { name: "Schedule window", exact: true }).isEnabled(), false);
    const row = page.locator(".maintenance-row").filter({ hasText: window.reference });
    await row.getByText("Change dates", { exact: true }).click();
    await row.getByLabel(`${window.reference} start`, { exact: true }).fill("2027-11-07T01:30");
    await row.getByRole("button", { name: "Reschedule", exact: true }).click();
    await page.locator('.page-stack > [role="alert"]:has(+ .maintenance-workspace)').waitFor();
    assert.equal(await create.getByRole("alert").isVisible(), true);
    assert.equal((await api("/api/app/maintenance")).maintenance.find(item => item.id === window.id).startsAt, window.startsAt);
  } finally { await context.close(); }
});
