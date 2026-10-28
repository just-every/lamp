import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "playwright";
import { sitePreview } from "@runeditrun/rer/internal/cli/site-preview.mjs";

import { insertRealOperatorSession } from "../e2e/real-session-helper.mjs";
import { requestHeaders } from "../helpers/request-headers.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";
import { appOrigin, pageOrigin } from "../e2e/helpers/hosts.mjs";
import { reservePort, waitForWorker } from "../e2e/worker-startup.mjs";
import { isolatedWranglerConfig } from "../helpers/wrangler-config.mjs";

// The Lamp landing page, the run site's home page (run-lamp.com), through its public door: the site `rer build --site` writes,
// served as Cloudflare's static assets serve it. The flows a visitor or the business would notice breaking. The intro starts
// dim with the hero already readable, a pendant lamp clicks on and lights the room; slow drawings never keep the page dim;
// without JavaScript or motion it is simply lit; scrolling hands the lamp to the header mark and back; the product cards
// below end in a close and the footer, and everything renders, fits, stays on the page's origin, and is reachable and
// accessible. The installed instance, on a private local Worker, answers its app host's / with the Lobby.
const WCAG_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

let BASE = "";
let PAGE = "";
let SITE = "";
let site;
let wranglerConfig = "";
let fixtureConfig;
let statePath;
let viteCachePath;
let worker;
let workerOutput = "";
let browser;


before(async () => {
  const port = await reservePort({ label: "landing page Worker" });
  BASE = appOrigin(port);
  PAGE = pageOrigin(port);
  statePath = await mkdtemp(join(tmpdir(), "lamp-site-d1-"));
  viteCachePath = await mkdtemp(resolve("node_modules/.lamp-site-vite-"));
  // Wrangler and Vite load `.dev.vars` from the directory of the config they are given, and it overrides the config's vars. The fixture's
  // config therefore lives in a directory of its own, so a checkout's local secrets and origin (written by `rer setup`) cannot steer this Worker.
  fixtureConfig = isolatedWranglerConfig((config) => ({ ...config, vars: { ...config.vars, MAIL_PROVIDER_API_KEY: "test-only-signin-presentation-no-delivery" } }));
  wranglerConfig = fixtureConfig.path;
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", wranglerConfig, "--persist-to", statePath], { cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024, stdio: "pipe" });
  worker = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "pipe",
    env: { ...process.env, LAMP_DISABLE_INSPECTOR: "true", LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: viteCachePath, LAMP_WRANGLER_CONFIG: wranglerConfig },
  });
  worker.stdout.on("data", (chunk) => { workerOutput += chunk; });
  worker.stderr.on("data", (chunk) => { workerOutput += chunk; });
  await waitForWorker({ origin: BASE, timeoutMs: 180_000, child: worker, output: () => workerOutput, label: "landing page Worker" });
  assert.ok(existsSync("dist/site/index.html"), "Build the public Lamp site before this journey: pnpm build:site");
  site = await sitePreview(join(process.cwd(), "dist/site"), { ports: [await reservePort({ label: "run site" })] });
  SITE = site.url;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] });

});

after(async () => {
  await browser?.close();
  await site?.close();
  if (worker?.pid && worker.exitCode === null) {
    const stopped = new Promise((resolveStopped) => worker.once("exit", resolveStopped));
    try { process.kill(-worker.pid, "SIGTERM"); } catch { /* Worker already exited. */ }
    await stopped;
  }
  await Promise.all([rm(statePath, { recursive: true, force: true }), rm(viteCachePath, { recursive: true, force: true })]);
  fixtureConfig?.cleanup();
});


// Follow the public front door from a new installation to the product site and
// its owner docs, including an ordinary visitor with no JavaScript.
test('DOCS-001 PAGE-020 — Lobby, public Lamp site and accessible owner documentation journey', { timeout: 300_000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${BASE}/`);
    const action = page.locator('.door-card a.btn');
    const setup = new URL(await action.getAttribute('href'), BASE);
    assert.equal(setup.origin, BASE); assert.equal(setup.pathname, '/setup');
    await action.click(); await page.waitForURL(url => url.pathname === '/signin');
    await page.locator('input[name="email"]').waitFor();
    assert.equal((await fetch(`${PAGE}/`)).status, 503, 'an unclaimed status page does not invent an all-clear');

    const session = await insertRealOperatorSession({ persistTo: statePath, configPath: wranglerConfig });
    const claimed = await fetch(`${BASE}/api/app/overview/first-run`, { method: 'POST', body: '{}', headers: requestHeaders({ Cookie: `${sessionCookieName(BASE)}=${session}`, 'Content-Type': 'application/json', Origin: BASE }) });
    assert.equal(claimed.status, 200);
    await page.goto(`${BASE}/`);
    await action.click(); await page.waitForURL(url => url.pathname === '/signin');
    assert.equal(await page.locator('input[name="email"]').inputValue(), 'operator@example.test');
    assert.equal((await context.cookies()).some(cookie => cookie.name === sessionCookieName(BASE)), false, 'a sign-in hint is not a session');
    const publicPage = await fetch(`${PAGE}/`);
    assert.equal(publicPage.status, 200);
    assert.equal((await publicPage.text()).includes('operator@example.test'), false);
    assert.equal((await fetch(`${PAGE}/docs`)).status, 404, 'operator documentation stays off the status host');

    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(SITE, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).waitFor();
    assert.equal(await page.locator('#lamp-title').isVisible(), true);
    await page.locator('.lamp-footer').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(requests.every(url => new URL(url).origin === SITE), 'the site runs from its own origin');
    await page.locator('.lamp-header').getByRole('link', { name: 'Docs', exact: true }).click();
    await page.waitForURL(`${SITE}/docs`);
    const cards = page.locator('.docs-index-card');
    assert.ok(await cards.count());
    await cards.first().click();
    await page.locator('.docs-prose').waitFor();
    const axe = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
    assert.deepEqual(axe.violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => ({ id: row.id, nodes: row.nodes.map(node => node.target) })), []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.goto(`${SITE}/docs/moving-in`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    const linked = page.locator('.docs-prose a[href^="/docs/"]').first();
    if (await linked.count()) { await linked.click(); await page.locator('.docs-prose').waitFor(); }
    assert.equal((await fetch(`${SITE}/docs/not-a-page`)).status, 404);
    assert.equal((await fetch(`${BASE}/docs`)).status, 200);
    if (process.env.LAMP_SCREENSHOTS) { const { mkdir } = await import('node:fs/promises'); await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.LAMP_SCREENSHOTS, '1440-owner-docs.png'), fullPage: true }); }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }

  const plain = await browser.newContext({ viewport: { width: 1440, height: 1000 }, javaScriptEnabled: false });
  try {
    const page = await plain.newPage();
    await page.goto(SITE);
    assert.equal(await page.getByRole('heading', { level: 1 }).isVisible(), true);
    await page.locator('.lamp-header').getByRole('link', { name: 'Docs', exact: true }).click();
    await page.locator('.docs-index-card').first().click();
    await page.locator('.docs-prose').waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('lamp-skip')), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id === 'docs-content' || document.activeElement.tagName === 'MAIN'), true);
  } finally { await plain.close(); }
});
