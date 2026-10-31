import { stripVTControlCharacters } from "node:util";
import {appHost, appOrigin, pageOrigin} from './helpers/hosts.mjs';
import { devKey } from '../helpers/dev-key.mjs';
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";
import { operatorHydrated } from "./helpers/operator-hydrated.mjs";

let worker, browser, context, page, statePath, cachePath, origin, sessionId;
let output = "";
const subscriberTokenSecret = "synthetic-lamp-020-subscriber-token-secret";
before(async () => {
  const port = await reservePort({ label: "Unsaved work Worker" });
  // Exercise the shipped silent development-mail transport. Its local key
  // stays in this isolated Worker fixture; the real operator session remains
  // the authority because development identity is disabled.
  origin = appOrigin(port, { SUBSCRIBER_TOKEN_SECRET: subscriberTokenSecret,
    RER_DEV_KEY: devKey, RER_DEV_ORIGIN: `http://${appHost}:${port}`, RER_DEV_IDENTITY: "off" });
  statePath = await mkdtemp(join(tmpdir(), "lamp-unsaved-work-d1-"));
  cachePath = await mkdtemp(resolve("node_modules/.lamp-unsaved-work-vite-"));
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", statePath], { maxBuffer: 8 * 1024 * 1024, stdio: "pipe" });
  sessionId = await insertRealOperatorSession({ persistTo: statePath });
  worker = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    detached: true, stdio: "pipe", env: { ...process.env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: cachePath, LAMP_DISABLE_INSPECTOR: "true" },
  });
  worker.stdout.on("data", chunk => { output += chunk; });
  worker.stderr.on("data", chunk => { output += chunk; });
  await waitForWorker({ origin, timeoutMs: 180_000, isListening: () => stripVTControlCharacters(output).includes(`${origin}/`), child: worker, output: () => output, label: "Unsaved work Worker" });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ["--no-sandbox", "--use-mock-keychain", "--password-store=basic"] });

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

test("A refused Impact save keeps the chosen value for Retry, and an unsaved SMS delivery draft asks before a pane switch drops it", { timeout: 360_000 }, async () => {
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: sessionCookieName(origin), value: sessionId, url: origin }]);
  page = await context.newPage();
  const dialogs = []; let answer = false;
  page.on("dialog", dialog => { dialogs.push(dialog.message()); return answer ? dialog.accept() : dialog.dismiss(); });
  const { component } = await api("/api/app/components", "POST", { groupId: null, name: "Unsaved-work API", description: "", internal: false, displayOrder: 0, note: "" });
  const { incident } = await api("/api/app/incidents", "POST", { title: "Unsaved-work incident", components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }] });

  await page.goto(`${origin}/app/incidents/${incident.id}`);
  await operatorHydrated(page);
  await page.getByRole("button", { name: /^Impact/ }).click();
  const select = page.getByLabel("Set public impact", { exact: true });
  let refuse = true;
  await page.route(`**/api/app/incidents/${incident.id}/impact`, route => refuse && route.request().method() === "PUT" ? route.fulfill({ status: 503, json: { error: "The service is unavailable." } }) : route.continue());
  await select.selectOption("major");
  await page.getByText("The service is unavailable.", { exact: true }).waitFor();
  assert.equal(await select.inputValue(), "major", "a refused Impact save keeps the chosen value in the select");
  refuse = false;
  const saved = page.waitForResponse(response => response.url().endsWith(`/incidents/${incident.id}/impact`) && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  assert.equal((await saved).status(), 200);
  assert.equal((await api(`/api/app/incidents/${incident.id}/impact`)).impact.impactOverride, "major", "Retry saves the chosen impact");

  await page.goto(`${origin}/app/settings#notifications`);
  await operatorHydrated(page);
  const contact = page.getByLabel("Support contact", { exact: true });
  await contact.fill("support-draft@example.test");
  await page.getByRole("link", { name: "Writing", exact: true }).click();
  await page.waitForTimeout(500);
  assert.deepEqual(dialogs, ["SMS delivery changes have not been saved. Leave them behind?"], "a pane switch asks before dropping an unsaved SMS draft");
  assert.equal(await contact.inputValue(), "support-draft@example.test", "declining keeps the draft where it was typed");
  assert.equal(new URL(page.url()).hash, "#notifications");
  answer = true;
  await page.getByRole("link", { name: "Writing", exact: true }).click();
  await page.waitForFunction(() => location.hash === "#writing");
});
