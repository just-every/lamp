import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";

let worker, browser, context, page, statePath, cachePath, origin;
let output = "";
before(async () => {
  const port = await reservePort({ label: "UI interaction Worker" });
  origin = `http://127.0.0.1:${port}`;
  statePath = await mkdtemp(join(tmpdir(), "lamp-ui-interactions-d1-"));
  cachePath = await mkdtemp(join(tmpdir(), "lamp-ui-interactions-vite-"));
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", "deploy/wrangler.template.toml", "--persist-to", statePath], { stdio: "pipe" });
  const sessionId = await insertRealOperatorSession({ persistTo: statePath });
  worker = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    detached: true, stdio: "pipe", env: { ...process.env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: cachePath, LAMP_DISABLE_INSPECTOR: "true" },
  });
  worker.stdout.on("data", chunk => { output += chunk; });
  worker.stderr.on("data", chunk => { output += chunk; });
  await waitForWorker({ origin, child: worker, output: () => output, label: "UI interaction Worker" });
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: "lamp_session", value: sessionId, url: origin }]);
  page = await context.newPage();
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

for (const [triggerName, fieldName] of [["Add component", "Component name"], ["Add group", "Group name"]]) {
  test(`${triggerName} contains keyboard focus and restores its trigger`, async () => {
    await page.goto(`${origin}/app/components`);
    const trigger = page.getByRole("button", { name: triggerName, exact: true }).first();
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel(fieldName, { exact: true }).evaluate(node => node === document.activeElement), true);
    const close = dialog.getByRole("button", { name: "Close component panel", exact: true });
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    const submit = dialog.getByRole("button", { name: triggerName === "Add component" ? "Create component" : "Create group", exact: true });
    assert.equal(await submit.evaluate(node => node === document.activeElement), true, "reverse Tab wraps to the final control");
    await page.keyboard.press("Tab");
    assert.equal(await close.evaluate(node => node === document.activeElement), true, "Tab wraps to the first control");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true, "Escape restores the opening control");
  });
}

for (const [route, label] of [["subscribers", "Subscriber records"], ["deliveries", "Delivery records"], ["alerts", "Alert receipt records"]]) {
  test(`${label} can be scrolled with the keyboard on narrow screens`, async () => {
    await page.goto(`${origin}/app/${route}`);
    const region = page.getByRole("region", { name: label, exact: true });
    await region.focus();
    assert.equal(await region.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(label => [...document.querySelectorAll('[role="region"]')].some(node => node.getAttribute("aria-label") === label && node.scrollLeft > 0), label);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
}
