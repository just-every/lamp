import { docsSearchFlow } from './docs-search-flow.mjs';
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "playwright";
import { sitePreview } from "@runeditrun/rer/internal/cli/site-preview.mjs";

import { insertRealOperatorSession } from "../e2e/real-session-helper.mjs";
import { requestHeaders } from "../helpers/request-headers.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";
import { appOrigin, pageOrigin } from "../e2e/helpers/hosts.mjs";
import { reservePort, waitForWorker } from "../e2e/worker-startup.mjs";
import { visibleText } from "../helpers/visible-text.mjs";
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
let decoder;

before(async () => {
  const port = await reservePort({ label: "landing page Worker" });
  BASE = appOrigin(port);
  PAGE = pageOrigin(port);
  statePath = await mkdtemp(join(tmpdir(), "lamp-site-d1-"));
  viteCachePath = await mkdtemp(join(tmpdir(), "lamp-site-vite-"));
  // Wrangler and Vite load `.dev.vars` from the directory of the config they are given, and it overrides the config's vars. The fixture's
  // config therefore lives in a directory of its own, so a checkout's local secrets and origin (written by `rer setup`) cannot steer this Worker.
  fixtureConfig = isolatedWranglerConfig((config) => ({ ...config, vars: { ...config.vars, MAIL_PROVIDER_API_KEY: "test-only-signin-presentation-no-delivery" } }));
  wranglerConfig = fixtureConfig.path;
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", wranglerConfig, "--persist-to", statePath], { cwd: process.cwd(), stdio: "pipe" });
  worker = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "pipe",
    env: { ...process.env, LAMP_DISABLE_INSPECTOR: "true", LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: viteCachePath, LAMP_WRANGLER_CONFIG: wranglerConfig },
  });
  worker.stdout.on("data", (chunk) => { workerOutput += chunk; });
  worker.stderr.on("data", (chunk) => { workerOutput += chunk; });
  await waitForWorker({ origin: BASE, child: worker, output: () => workerOutput, label: "landing page Worker" });
  execFileSync("pnpm", ["exec", "rer", "build", "--site"], { cwd: process.cwd(), stdio: "pipe" });
  site = await sitePreview(join(process.cwd(), "dist/site"), { ports: [await reservePort({ label: "run site" })] });
  SITE = site.url;
  browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  decoder = await browser.newPage();
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

/** Opens a browser context that collects console and page errors; `errors()` lists them. */
async function newContext(options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  return { context, page, errors: () => errors };
}

/**
 * Opens the landing page. `motion` chooses prefers-reduced-motion; `holdAt` serves the document with every animation paused at
 * that many milliseconds into the intro, so a moment of the timeline can be looked at. The page must log no console
 * or page errors before it closes.
 */
async function openPage({ width = 1440, height = 900, motion = "reduce", holdAt, setup, javaScriptEnabled = true } = {}) {
  const { context, page, errors } = await newContext({ viewport: { width, height }, reducedMotion: motion, javaScriptEnabled });
  if (holdAt !== undefined) {
    await page.route(`${SITE}/`, async (route) => {
      const response = await route.fetch();
      const hold = `<style>*, *::after { animation-play-state: paused !important; animation-delay: -${holdAt}ms !important; }</style>`;
      await route.fulfill({ response, body: (await response.text()).replace("</head>", `${hold}</head>`) });
    });
  }
  if (setup) await setup(page);
  await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
  if (javaScriptEnabled) {
    await page.waitForSelector(".lamp-intro[data-ready]", { state: "attached" });
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
  }
  return {
    page,
    close: async () => {
      await context.close();
      assert.deepEqual(errors(), [], "no console or page errors");
    },
  };
}

const frames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
const scrollTo = async (page, y) => { await page.evaluate((top) => window.scrollTo(0, top), y); await frames(page); };
// Scrolling the intro's full height takes the hero out of view; the handoff is over by then, however it is tuned.
const introHeight = (page) => page.$eval(".lamp-intro", (intro) => intro.offsetHeight);

/** Scrolls down the whole page and back so every lazy image loads, then waits for them. */
async function scrollThrough(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const reveals = await page.locator("[data-reveal]").count();
  // Deliver layout and intersection observations at each stop, even on a busy runner.
  for (let y = 0; y <= height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    if (reveals) await frames(page);
    else await page.waitForTimeout(20);
  }
  await page.waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 60_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  // Without JavaScript no animation frame ever runs, so this waits on the clock.
  await page.waitForTimeout(100);
}

/**
 * Whether the intro is dim or lit, as a visitor sees it: the lamp's lit drawing, the room's dusk and the headline,
 * each 0 (gone) to 1 (fully there), and whether the lamp hangs in view. The headline is whole at every moment.
 */
const introState = (page) => page.evaluate(() => {
  const value = (selector) => Number(getComputedStyle(document.querySelector(selector)).opacity);
  const spans = [...document.querySelectorAll("#lamp-title span")].map((span) => Number(getComputedStyle(span).opacity));
  return { lit: value(".lamp-sprite--on"), dim: value(".lamp-dusk"), title: Math.min(...spans), lamp: getComputedStyle(document.querySelector(".lamp-rig")).visibility === "visible" };
});
const isLit = (state) => state.lit === 1 && state.dim === 0 && state.title === 1;
// The dim start: the lamp off and the room at dusk, with the headline already whole.
const isDim = (state) => state.lit === 0 && state.dim === 1 && state.title === 1;

/** Where the big lamp, the header mark, the mark's slot and the header's bottom edge are. */
const handoffState = (page) => page.evaluate(() => {
  const rect = (selector) => { const { left, top, width, height, bottom } = document.querySelector(selector).getBoundingClientRect(); return { left, top, width, height, bottom }; };
  return { lamp: rect(".lamp-rig__lamp"), mark: rect(".lamp-brand__mark"), slot: rect(".lamp-brand__slot"), ceiling: rect(".lamp-header").bottom };
});
// The bottom of the big lamp's bulb, on its square canvas.
const BULB_BOTTOM = 0.7686;
const inSlot = ({ mark, slot }) => ["left", "top", "width", "height"].every((key) => Math.abs(mark[key] - slot[key]) <= 1);

/** The mean relative luminance of the viewport as rendered. */
async function screenLuminance(page) {
  const png = await page.screenshot();
  return decoder.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * channel(data[i]) + 0.7152 * channel(data[i + 1]) + 0.0722 * channel(data[i + 2]);
    return sum / (data.length / 4);
  }, png.toString("base64"));
}

/** Whether the headline shows on screen, uncovered: the topmost element at its centre is the headline's own. */
const headlineShows = (page) => page.$eval("#lamp-title", (title) => {
  const rect = title.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return title.checkVisibility({ opacityProperty: true }) && rect.bottom > 0 && rect.top < innerHeight && Boolean(hit && title.contains(hit)) && title.innerText.trim().length > 0;
});

/**
 * Samples the intro on every frame from the first, into window.__intro: what `introState` reads and whether the lamp's
 * drawings have decoded. `window.__introStop = true` ends the sampling.
 */
const sampleIntro = (page) => page.addInitScript(() => {
  window.__intro = [];
  const sample = () => {
    const intro = document.querySelector(".lamp-intro");
    const rig = document.querySelector(".lamp-rig");
    const spans = [...document.querySelectorAll("#lamp-title span")];
    if (intro && rig && document.querySelector(".lamp-sprite--on") && spans.length) {
      const value = (selector) => Number(getComputedStyle(document.querySelector(selector)).opacity);
      window.__intro.push({
        lamp: getComputedStyle(rig).visibility === "visible",
        drawn: [...rig.querySelectorAll("img")].every((image) => image.complete && image.naturalWidth > 0),
        lit: value(".lamp-sprite--on"), dim: value(".lamp-dusk"), title: Math.min(...spans.map((span) => Number(getComputedStyle(span).opacity))),
        waiting: !intro.hasAttribute("data-ready") && !intro.hasAttribute("data-late"),
        played: Math.max(0, ...intro.getAnimations({ subtree: true }).map((animation) => Number(animation.currentTime) || 0)),
      });
    }
    if (!window.__introStop) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});
const introSamples = (page) => page.evaluate(() => { window.__introStop = true; return window.__intro; });

/** Holds back every request `matches` picks until `release()` is called. */
async function holdRequests(page, matches) {
  let release;
  const released = new Promise((resolveRelease) => { release = resolveRelease; });
  await page.route("**/*", async (route) => {
    if (matches(route.request())) await released;
    await route.continue();
  });
  return release;
}

const d1 = (command) => JSON.parse(execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", wranglerConfig, "--persist-to", statePath, "--json", "--command", command], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" }))[0].results;
const lobby = async () => {
  const response = await fetch(`${BASE}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  const html = await response.text();
  return { html };
};
const setupState = async () => (await (await fetch(`${BASE}/setup/state`)).json()).state;

async function followLobbyAction(path, email = "") {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${BASE}/`);
    const action = page.locator(".door-card a.btn");
    assert.equal(await action.count(), 1, "the Lobby offers one primary action");
    const target = new URL(await action.getAttribute("href"), page.url());
    assert.equal(target.origin, BASE, "the primary action stays on the app origin");
    assert.equal(target.pathname, path);
    assert.deepEqual([...target.searchParams], email ? [["login_hint", email]] : [], "only the local claimed owner's sign-in carries an email hint");
    assert.ok(!(await page.locator("body").innerText()).includes("operator@example.test"), "the Lobby does not display the owner's email");
    await action.click();
    await page.waitForURL((url) => url.origin === BASE && url.pathname === "/signin");
    const input = page.locator('input[name="email"][type="email"]');
    assert.ok(await input.isVisible(), "the primary action reaches the native sign-in form without JavaScript");
    assert.equal(await input.inputValue(), email, "the local owner can continue with their email already filled in");
    if (email) assert.equal(await page.locator('input[name="token"]').count(), 0, "a claimed owner does not need the spent bootstrap token");
    assert.ok(!(await context.cookies()).some((cookie) => cookie.name === sessionCookieName(BASE)), "following a hint does not authenticate the visitor");
  } finally {
    await context.close();
  }
}

test("the app Lobby leads to setup before owner claim and prefilled sign-in after bootstrap, independently of first-run confirmation; the page host serves status; /lamp redirects home", async () => {
  assert.equal(await setupState(), "unclaimed");
  const waiting = await lobby();
  await followLobbyAction("/setup");
  assert.doesNotMatch(waiting.html, /lamp-home|lamp-intro/, "the landing page lives on the run site, not the installed instance");
  for (const file of [...waiting.html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map(([, path]) => path).filter((path) => path !== "/setup")) {
    assert.equal((await fetch(`${BASE}${file}`)).status, 200, `the Lobby's ${file} is served`);
  }
  const neutral = await fetch(`${PAGE}/`);
  assert.equal(neutral.status, 503, "the unclaimed page stays neutral beside the working homepage");
  const [counts] = d1("SELECT (SELECT COUNT(*) FROM operators) AS owners, (SELECT COUNT(*) FROM page_settings) AS settings");
  assert.equal(counts.owners, 0, "homepage and public reads create no owner");
  assert.equal(counts.settings, 0, "homepage and public reads create no page settings");

  // Bootstrap claims the owner before the page's separate first-run confirmation.
  const session = await insertRealOperatorSession({ persistTo: statePath, configPath: wranglerConfig, pageSettings: false });
  d1("INSERT INTO page_settings(id,page_name,tagline,accent_color,timezone,hostname,footer_credit_enabled,mail_from_address,feed_id,created_at,updated_at) VALUES ('default','Atlas Cloud Status','Current availability and incident communications for Atlas Cloud.','#16794C','America/Los_Angeles','status.atlascloud.example',1,'lamp@localhost.invalid','test-feed-identity-00000000000001','2026-08-31','2026-08-31')");
  assert.equal(await setupState(), "unclaimed", "page setup remains incomplete after owner bootstrap");
  await followLobbyAction("/signin", "operator@example.test");
  assert.doesNotMatch((await lobby()).html, /setup token/, "bootstrap already retired the one-time setup token");
  assert.equal(await setupState(), "unclaimed", "following owner entry does not confirm the page's first-run settings");
  const confirmed = await fetch(`${BASE}/api/app/overview/first-run`, { method: "POST", body: "{}", headers: requestHeaders({ Cookie: `${sessionCookieName(BASE)}=${session}`, "Content-Type": "application/json", Origin: BASE }) });
  assert.equal(confirmed.status, 200, await confirmed.clone().text());
  assert.equal(await setupState(), "claimed");
  const claimed = await lobby();
  await followLobbyAction("/signin", "operator@example.test");
  assert.match(claimed.html, /Atlas Cloud Status/, "the Lobby names the page the owner configured");

  const statusPage = await fetch(`${PAGE}/`);
  assert.equal(statusPage.status, 200);
  assert.match(statusPage.headers.get("content-type") ?? "", /^text\/html/);
  assert.ok(statusPage.headers.get("content-security-policy"), "the status page keeps its CSP");
  const statusHtml = await statusPage.text();
  for (const privateValue of ["operator@example.test", encodeURIComponent("operator@example.test"), "login_hint"]) {
    assert.ok(!statusHtml.includes(privateValue), "the public status page never exposes the owner's email or local sign-in hint");
  }
  const statusContent = statusHtml.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? "";
  assert.ok(visibleText(statusContent).includes("Atlas Cloud Status"), "the configured public page renders the seeded page identity in its body");
  assert.doesNotMatch(statusHtml, /lamp-home|lamp-intro|class="door"/, "the status page carries neither the landing page nor the Lobby");
  assert.equal((await fetch(`${PAGE}/setup/state`)).status, 404, "the page host does not answer the app host's setup state");
  const formerAddress = await fetch(`${BASE}/lamp`, { redirect: "manual" });
  assert.equal(formerAddress.status, 301, "old /lamp links follow home");
  assert.equal(formerAddress.headers.get("location"), `${BASE}/`);
});

test("Lamp introduction remains readable, correctly scaled and resilient to slow drawings", async t => {
  t.diagnostic("the intro starts dim with the hero readable and the lamp clicks on once, leaving the page lit");
  await (async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const dark = await openPage({ width, height, motion: "no-preference", holdAt: 0 });
    let night;
    try {
      const state = await introState(dark.page);
      assert.ok(isDim(state), `at ${width}px the page starts dim, headline whole: ${JSON.stringify(state)}`);
      assert.ok(await headlineShows(dark.page), `the headline is readable from the first frame at ${width}px`);
      assert.ok(await dark.page.$eval(".lamp-dusk", (dusk) => Number(getComputedStyle(dusk).zIndex) < 0), `the dusk is the page's background, behind the header, lamp and text, at ${width}px`);
      assert.equal(await dark.page.getByRole("heading", { level: 1 }).count(), 1, "there is one headline");
      night = await screenLuminance(dark.page);
    } finally {
      await dark.close();
    }
    const { page, close } = await openPage({ width, height, motion: "no-preference" });
    try {
      await page.waitForFunction(() => document.getAnimations().length > 0 && document.getAnimations().every((animation) => animation.playState === "finished"), null, { timeout: 15_000 });
      await frames(page);
      const state = await introState(page);
      assert.ok(isLit(state) && state.lamp, `at ${width}px the lamp ends lit and the room clear: ${JSON.stringify(state)}`);
      assert.ok(await headlineShows(page), `the headline is readable at ${width}px`);
      const day = await screenLuminance(page);
      assert.ok(day > night, `the lit page is lighter than the dim one at ${width}px: ${night.toFixed(3)} -> ${day.toFixed(3)}`);
      // Scrolling through the page and back does not replay the click-on. The moments below the hero may still be
      // playing, so only the intro's own animations are read.
      await scrollThrough(page);
      await frames(page);
      assert.ok(await page.$eval(".lamp-intro", (intro) => intro.getAnimations({ subtree: true }).every((animation) => animation.playState === "finished")),
        `scrolling back up does not replay the intro at ${width}px`);
      assert.ok(isLit(await introState(page)), `still lit after scrolling at ${width}px`);
    } finally {
      await close();
    }
  }
})(t);
  t.diagnostic("the intro fills the first screen on every screen, and the lamp hangs lower on a longer cord when the screen is taller than its stack");
  await (async () => {
  const measure = async (width, height) => {
    const { page, close } = await openPage({ width, height, motion: "reduce" });
    try {
      return await page.evaluate(() => {
        const intro = document.querySelector(".lamp-intro").getBoundingClientRect();
        const lamp = document.querySelector(".lamp-rig__lamp").getBoundingClientRect();
        return { lampTop: lamp.top, bulbBottom: lamp.top + lamp.height * 0.7686, titleTop: document.querySelector(".lamp-intro__title").getBoundingClientRect().top, introHeight: intro.height, nextTop: document.querySelector(".lamp-intro").nextElementSibling.getBoundingClientRect().top,
          heroBottom: document.querySelector(".lamp-intro__alt").getBoundingClientRect().bottom, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
    } finally { await close(); }
  };
  for (const [width, height, taller] of [[1440, 900, 1400], [390, 844, 1200]]) {
    const [normal, tall] = [await measure(width, height), await measure(width, taller)];
    assert.ok(normal.introHeight >= height && normal.nextTop >= height, `the intro is a whole screen and the next section starts below it at ${width}px: ${JSON.stringify(normal)}`);
    assert.ok(normal.heroBottom <= normal.introHeight, `the hero sits inside the intro at ${width}px`);
    assert.ok(tall.introHeight >= taller && tall.nextTop >= taller, `the intro is a whole screen on a taller screen at ${width}px: ${JSON.stringify(tall)}`);
    assert.ok(tall.lampTop > normal.lampTop + 40, `the lamp and hero sit lower on a taller screen at ${width}px: ${normal.lampTop} -> ${tall.lampTop}`);
  }
  // A phone too short for its stack, in portrait and in landscape: the intro grows with its content, the lamp hangs as high as it can, and nothing overlaps or spills sideways.
  for (const [width, height] of [[320, 568], [568, 320]]) {
    const short = await measure(width, height);
    assert.ok(short.introHeight >= height && short.heroBottom <= short.introHeight, `the intro grows to hold the hero at ${width}x${height}: ${JSON.stringify(short)}`);
    assert.ok(short.bulbBottom <= short.titleTop, `the lamp does not overlap the headline at ${width}x${height}: ${JSON.stringify(short)}`);
    assert.equal(short.overflowX, 0, `nothing spills sideways at ${width}x${height}`);
  }
})(t);
  t.diagnostic("when the lamp's drawings are slow the click-on holds at its start, then the page goes lit without them, and the lamp appears only once drawn, already lit");
  await (async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { context, page, errors } = await newContext({ viewport: { width, height }, reducedMotion: "no-preference" });
    try {
      const release = await holdRequests(page, (request) => request.resourceType() === "image");
      await sampleIntro(page);
      await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__intro?.at(-1)?.dim === 0 && window.__intro.at(-1).title === 1, null, { timeout: 30_000, polling: 100 });
      const waiting = await introState(page);
      assert.ok(!waiting.lamp, `the room is lit with no lamp while its drawings are still loading at ${width}px: ${JSON.stringify(waiting)}`);
      assert.ok(await headlineShows(page), `the headline is readable without the drawings at ${width}px`);
      release();
      await page.waitForFunction(() => window.__intro?.at(-1)?.lamp && document.getAnimations().every((animation) => animation.playState === "finished"), null, { timeout: 30_000, polling: 100 });
      await frames(page);
      const samples = await introSamples(page);
      assert.ok(isDim(samples[0]) && !samples[0].lamp, `the first frame is dim with no lamp at ${width}px: ${JSON.stringify(samples[0])}`);
      assert.ok(samples.every((sample) => sample.title === 1), `the headline is whole in every frame at ${width}px`);
      const held = samples.filter((sample) => sample.waiting);
      assert.ok(held.length > 0 && held.every((sample) => sample.played === 0), `the click-on holds at its start while the drawings load at ${width}px: ${JSON.stringify(held.find((sample) => sample.played !== 0))}`);
      for (const sample of samples.filter((entry) => entry.lamp)) {
        assert.ok(sample.drawn && sample.lit === 1, `the lamp shows only once drawn, and already lit, at ${width}px: ${JSON.stringify(sample)}`);
      }
      assert.ok(isLit(samples.at(-1)) && samples.at(-1).lamp, `lit with the lamp at the end at ${width}px: ${JSON.stringify(samples.at(-1))}`);
      assert.deepEqual(errors(), [], "no console or page errors");
    } finally {
      await context.close();
    }
  }
})(t);
});





test("Motion-free and script-free entry and reversible lamp handoff", async t => {
  t.diagnostic("under reduced motion the page is simply lit: nothing animates and the mark already sits in its slot");
  await (async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { page, close } = await openPage({ width, height, motion: "reduce" });
    try {
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0, `no animation at ${width}px`);
      assert.ok(isLit(await introState(page)), `lit at ${width}px`);
      assert.ok(await headlineShows(page), `the headline is readable at ${width}px`);
      const start = await handoffState(page);
      assert.ok(inSlot(start), `the mark sits in its slot at ${width}px: ${JSON.stringify(start)}`);
      await scrollTo(page, (await introHeight(page)) / 2);
      assert.ok(inSlot(await handoffState(page)), `the mark stays in its slot while scrolling at ${width}px`);
      await scrollThrough(page);
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0, `nothing below the hero animates either at ${width}px`);
    } finally {
      await close();
    }
  }
})(t);
  t.diagnostic("without JavaScript the page is simply lit, the mark in its slot and nothing running");
  await (async () => {
  const { page, close } = await openPage({ width: 1440, height: 900, motion: "no-preference", javaScriptEnabled: false });
  try {
    await page.waitForFunction(() => [...document.images].every((image) => image.loading === "lazy" || image.complete));
    const state = await introState(page);
    assert.ok(isLit(state) && state.lamp, `lit with the lamp: ${JSON.stringify(state)}`);
    assert.ok(await headlineShows(page), "the headline is readable");
    assert.ok(inSlot(await handoffState(page)), "the mark sits in its slot");
    assert.equal(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length), 0);
  } finally {
    await close();
  }
})(t);
  t.diagnostic("the scroll handoff lifts the big lamp away and lands the header mark in its slot, continuously and reversibly");
  await (async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { page, close } = await openPage({ width, height, motion: "no-preference", holdAt: 3000 });
    try {
      const distance = await introHeight(page);
      const start = await handoffState(page);
      assert.ok(!inSlot(start) && start.mark.bottom <= 0, `the mark waits out of view at the top at ${width}px: ${JSON.stringify(start.mark)}`);
      assert.ok(start.lamp.bottom > 0 && start.lamp.top < height, `the big lamp hangs in view at ${width}px`);
      const steps = 16;
      const states = [start];
      for (let step = 1; step <= steps; step += 1) {
        await scrollTo(page, (distance * step) / steps);
        states.push(await handoffState(page));
      }
      for (let step = 1; step <= steps; step += 1) {
        const [previous, now] = [states[step - 1], states[step]];
        assert.ok(now.mark.top >= previous.mark.top - 0.01, `the mark only descends at ${width}px, step ${step}`);
        assert.ok(now.lamp.top <= previous.lamp.top + 0.01, `the big lamp only rises at ${width}px, step ${step}`);
      }
      // The page never shows neither: until the lamp's bulb has passed up into the header, or once the mark shows.
      states.forEach((state, step) => assert.ok(state.lamp.top + state.lamp.height * BULB_BOTTOM > state.ceiling || state.mark.bottom > 0,
        `the lamp or the header mark is always in view at ${width}px, step ${step}: ${JSON.stringify(state)}`));
      const landed = states.at(-1);
      assert.ok(inSlot(landed), `the mark lands in its slot at ${width}px: ${JSON.stringify(landed)}`);
      assert.ok(landed.lamp.top < start.lamp.top, `the big lamp has risen away at ${width}px`);
      await scrollTo(page, distance * 1.5);
      assert.ok(inSlot(await handoffState(page)), `the mark stays in its slot past the handoff at ${width}px`);
      await scrollTo(page, distance / 2);
      const middle = await handoffState(page);
      assert.ok(Math.abs(middle.mark.top - states[steps / 2].mark.top) <= 1, `scrolling back passes through the same state at ${width}px`);
      await scrollTo(page, 0);
      const back = await handoffState(page);
      assert.ok(!inSlot(back) && Math.abs(back.mark.top - start.mark.top) <= 1, `the mark returns out of view at ${width}px`);
      assert.ok(Math.abs(back.lamp.top - start.lamp.top) <= 1, `the big lamp returns at ${width}px`);
    } finally {
      await close();
    }
  }
})(t);
});





test("Complete responsive landing content stays on its own origin", async t => {
  t.diagnostic("every section renders below the hero, in order, under one h1: the product cards, then a close that offers a way in, then the footer");
  await (async () => {
  const { page, close } = await openPage({ width: 1440, height: 900, motion: "no-preference" });
  try {
    // With motion on, each section plays its moment as it is scrolled into view; once every moment has played,
    // nothing may be left hidden.
    await scrollThrough(page);
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === "finished"), null, { timeout: 15_000 });
    const outline = await page.evaluate(() => {
      const rect = (element) => { const { top, bottom, width, height } = element.getBoundingClientRect(); return { top: top + scrollY, bottom: bottom + scrollY, width, height }; };
      const [hero, ...sections] = document.querySelectorAll("main > section");
      const footer = document.querySelector("main ~ footer");
      return {
        h1: [...document.querySelectorAll("h1")].map((heading) => hero.contains(heading)),
        hero: rect(hero),
        sections: sections.map((section) => {
          const heading = section.querySelector("h2");
          const shown = (element) => element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
          const plates = [...section.querySelectorAll(".lamp-plate")].map((plate) => {
            const { width, height } = plate.getBoundingClientRect();
            return shown(plate) && width > 0 && height > 0;
          });
          const action = [...section.querySelectorAll("a[href]")].some((link) => link.checkVisibility());
          return { ...rect(section), heading: heading ? shown(heading) && heading.textContent.trim().length > 0 : false, plates, action };
        }),
        levels: [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((heading) => Number(heading.tagName[1])),
        images: [...document.querySelectorAll("main img")].filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.currentSrc),
        footer: footer ? { ...rect(footer), shown: footer.checkVisibility() } : null,
      };
    });
    assert.deepEqual(outline.h1, [true], "one h1, in the hero");
    assert.ok(outline.sections.length > 0, "sections follow the hero");
    outline.sections.forEach((section, index) => {
      assert.ok(section.height > 0 && section.width > 0, `section ${index + 1} renders`);
      assert.ok(section.heading, `section ${index + 1} has a visible heading`);
      assert.ok(section.top >= (index ? outline.sections[index - 1].bottom : outline.hero.bottom) - 0.5, `section ${index + 1} sits below what comes before it`);
    });
    outline.levels.forEach((level, index) => assert.ok(index === 0 || level <= outline.levels[index - 1] + 1, `heading ${index} skips a level: ${outline.levels}`));
    assert.deepEqual(outline.images, [], "every drawing below the hero loads");
    // Every section but the close shows the product through cards of its UI, and every card renders.
    outline.sections.slice(0, -1).forEach((section, index) => assert.ok(section.plates.length > 0, `section ${index + 1} shows a card of the product's UI`));
    outline.sections.forEach((section, index) => assert.ok(section.plates.every(Boolean), `every card in section ${index + 1} renders`));
    assert.ok(outline.sections.at(-1).plates.length === 0 && outline.sections.at(-1).action, "the cards end in a close that offers a way in");
    assert.ok(outline.footer?.shown && outline.footer.top >= outline.sections.at(-1).bottom - 0.5, "the footer follows the sections");
  } finally {
    await close();
  }
})(t);
  t.diagnostic("nothing overflows sideways at a narrow phone and a wide desktop width");
  await (async () => {
  for (const [width, height] of [[320, 568], [1920, 1080]]) {
    const { page, close } = await openPage({ width, height });
    try {
      await scrollThrough(page);
      const layout = await page.evaluate(() => {
        const outside = [...document.querySelectorAll(".lamp-header a:not(.lamp-skip), main h1, main h2, main p, .lamp-plate, .lamp-footer a")].filter((element) => {
          const rect = element.getBoundingClientRect();
          return element.checkVisibility() && rect.width > 0 && (rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5);
        }).map((element) => element.className || element.tagName);
        return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, outside };
      });
      assert.ok(layout.scroll <= layout.client, `no horizontal overflow at ${width}px: ${JSON.stringify(layout)}`);
      assert.deepEqual(layout.outside, [], `everything stays on screen at ${width}px`);
    } finally {
      await close();
    }
  }
})(t);
  t.diagnostic("every request the page makes stays on its own origin");
  await (async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const requests = [];
    const { page, close } = await openPage({ width, height, motion: "no-preference", setup: (p) => p.on("request", (request) => requests.push(request.url())) });
    try {
      await scrollThrough(page);
      await page.waitForTimeout(300);
      assert.ok(requests.length > 0, "requests were seen");
      for (const url of requests) assert.equal(new URL(url).origin, SITE, `${url} stays on the page's origin at ${width}px`);
    } finally {
      await close();
    }
  }
})(t);
});





test("Landing keyboard navigation and WCAG AA accessibility", async t => {
  t.diagnostic("the keyboard reaches the skip link first and then every link, each with a visible focus ring, and focus lifts the dusk");
  await (async () => {
  for (const holdAt of [0, 3000]) {
    const { page, close } = await openPage({ width: 1440, height: 900, motion: "no-preference", holdAt });
    try {
      const focusables = await page.$$eval("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])", (elements) => elements.length);
      assert.equal(await page.$eval(".lamp-skip", (link) => link.getBoundingClientRect().bottom <= 0), true, "the skip link is out of view until focused");
      const reached = [];
      for (let index = 0; index < focusables; index += 1) {
        await page.keyboard.press("Tab");
        reached.push(await page.evaluate(() => {
          const element = document.activeElement;
          const all = [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")];
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const target = element.getAttribute("href")?.startsWith("#") ? document.querySelector(element.getAttribute("href")) : null;
          return {
            index: all.indexOf(element), skip: element.classList.contains("lamp-skip"), target: Boolean(target),
            inside: rect.width > 0 && rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
            ring: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0,
            dim: Number(getComputedStyle(document.querySelector(".lamp-dusk")).opacity),
          };
        }));
      }
      assert.ok(reached[0].skip && reached[0].target, `the first Tab reaches the skip link, which points into the page: ${JSON.stringify(reached[0])}`);
      assert.deepEqual(reached.map((item) => item.index), [...Array(focusables).keys()], "Tab reaches every link in document order");
      for (const item of reached) assert.ok(item.inside && item.ring, `a focused link is in view with a visible focus ring (held at ${holdAt}ms): ${JSON.stringify(item)}`);
      assert.equal(reached[0].dim, 0, `keyboard focus lifts the dusk (held at ${holdAt}ms)`);
    } finally {
      await close();
    }
  }
})(t);
  t.diagnostic("automated WCAG AA checks find nothing on the lit page, at the top and at every section");
  await (async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { page, close } = await openPage({ width, height });
    try {
      await scrollThrough(page);
      const sections = await page.$$eval("main > section", (list) => list.length);
      for (let index = 0; index < sections; index += 1) {
        await page.evaluate((at) => document.querySelectorAll("main > section")[at].scrollIntoView({ block: "start", behavior: "instant" }), index);
        await frames(page);
        const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
        assert.deepEqual(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), [], `axe at ${width}px, section ${index}`);
      }
    } finally {
      await close();
    }
  }
})(t);
});



// The docs at /docs: the landing page's own pages for the repository's docs, drawn from its Markdown at build time. The
// run site serves them as built; an installed instance serves the same pages on its app host.
const docsPaths = async () => {
  const html = await (await fetch(`${SITE}/docs`)).text();
  return [...new Set([...html.matchAll(/href="(\/docs\/[a-z0-9-]+)"/g)].map(([, path]) => path))];
};

/** Opens a docs address; the page must log no console or page errors before it closes. */
async function openDocs(path, { width = 1440, height = 900, javaScriptEnabled = true, setup } = {}) {
  const { context, page, errors } = await newContext({ viewport: { width, height }, reducedMotion: "reduce", javaScriptEnabled });
  if (setup) await setup(page);
  await page.goto(`${SITE}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  return { page, close: async () => { await context.close(); assert.deepEqual(errors(), [], "no console or page errors"); } };
}

test("Repository docs remain complete, responsive, private and accessible", async t => {
  await docsSearchFlow(browser, SITE);
  t.diagnostic("the landing page's Docs links lead to the site's own docs, which read the repository's docs under the same header, link to each other and answer 404 off the list");
  await (async () => {
  const landing = await openPage({ width: 1440, height: 900 });
  try {
    const docsLinks = await landing.page.$$eval("a", (links) => links.filter((link) => /^(Docs|Read the docs)$/.test(link.textContent.trim())).map((link) => new URL(link.href).origin + new URL(link.href).pathname));
    assert.ok(docsLinks.length > 0 && docsLinks.every((link) => link === `${SITE}/docs`), `every Docs link on the landing page is the site's own /docs: ${docsLinks}`);
  } finally {
    await landing.close();
  }

  const home = await openDocs("/docs");
  try {
    assert.equal(await home.page.getByRole("heading", { level: 1 }).count(), 1, "one h1");
    assert.equal(await home.page.locator(".lamp-header .lamp-brand").count(), 1, "the landing page's header");
    assert.equal(await home.page.locator(".lamp-header a[aria-current=page]").count(), 1, "the header marks Docs as the current page");
    assert.equal(await home.page.locator(".lamp-intro").count(), 0, "no intro on the docs");
    const cards = await home.page.$$eval(".docs-index-card", (list) => list.map((card) => card.getAttribute("href")));
    assert.ok(cards.length > 3, "the docs home lists every page");
    await home.page.locator(".docs-index-card").first().click();
    await home.page.waitForURL(`${SITE}${cards[0]}`);
    assert.equal(await home.page.locator(".docs-prose").count(), 1, "a card opens its page");
  } finally {
    await home.close();
  }

  // The page reads the repository's own file: a heading of docs/moving-in.md is a heading of /docs/moving-in.
  const source = (await readFile("docs/moving-in.md", "utf8")).match(/^## (.+)$/m)[1];
  const moving = await (await fetch(`${SITE}/docs/moving-in`)).text();
  assert.ok(moving.includes(`>${source}</h2>`), "a heading of docs/moving-in.md is on its docs page");

  // Every link between docs lands on a page that exists, at a heading that exists.
  let between = 0;
  for (const path of await docsPaths()) {
    const response = await fetch(`${SITE}${path}`);
    assert.equal(response.status, 200, `${path} is served`);
    const prose = (await response.text()).split('class="docs-prose"')[1] ?? "";
    for (const [, target, hash] of prose.matchAll(/<a href="(\/docs\/[a-z0-9-]+)(?:#([^"]+))?"/g)) {
      between += 1;
      const found = await fetch(`${SITE}${target}`);
      assert.equal(found.status, 200, `${path} links to ${target}`);
      if (hash) assert.ok((await found.text()).includes(`id="${hash}"`), `${path} links to #${hash} of ${target}, which has it`);
    }
  }
  assert.ok(between > 0, "docs link to each other");

  for (const missing of ["/docs/not-a-page", "/docs/not/a/page"]) {
    assert.equal((await fetch(`${SITE}${missing}`)).status, 404, `${missing} is a real 404 on the run site`);
    const response = await fetch(`${BASE}${missing}`);
    assert.equal(response.status, 404, `${missing} is a real 404 on an installed instance`);
    assert.match(await response.text(), /docs-shell/, `${missing} answers inside the installed instance's docs`);
  }
  assert.equal((await fetch(`${BASE}/docs`)).status, 200, "an installed instance serves the docs on its app host");
  assert.equal((await fetch(`${PAGE}/docs`)).status, 404, "the status page's host has no docs: its paths are the snapshot's");
})(t);
  t.diagnostic("every docs page fits the screen, stays on its own origin, works without JavaScript and passes the WCAG AA checks");
  await (async () => {
  const paths = ["/docs", ...(await docsPaths())];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const path of paths) {
      const requests = [];
      const { page, close } = await openDocs(path, { width, height, setup: (p) => p.on("request", (request) => requests.push(request.url())) });
      try {
        for (const url of requests) assert.equal(new URL(url).origin, SITE, `${url} stays on the page's origin (${path} at ${width}px)`);
        const layout = await page.evaluate(() => {
          const outside = [...document.querySelectorAll(".lamp-header a, main h1, main h2, main p, .docs-code, .docs-table, .lamp-footer a")].filter((element) => {
            const rect = element.getBoundingClientRect();
            return element.checkVisibility() && rect.width > 0 && (rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5);
          }).map((element) => element.className || element.tagName);
          return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, outside };
        });
        assert.ok(layout.scroll <= layout.client, `no horizontal overflow at ${width}px on ${path}: ${JSON.stringify(layout)}`);
        assert.deepEqual(layout.outside, [], `everything stays on screen at ${width}px on ${path}`);
        const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
        assert.deepEqual(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), [], `axe at ${width}px on ${path}`);
      } finally {
        await close();
      }
    }
  }
  const phone = await openDocs("/docs", { width: 320, height: 568 });
  try {
    assert.ok(await phone.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "the docs home fits a 320px phone");
  } finally {
    await phone.close();
  }
  const plain = await openDocs(paths[1], { javaScriptEnabled: false });
  try {
    assert.equal(await plain.page.getByRole("heading", { level: 1 }).count(), 1, "without JavaScript the page is whole");
    assert.ok((await plain.page.locator(".docs-prose").innerText()).length > 200, "and its text is there");
    await plain.page.keyboard.press("Tab");
    assert.equal(await plain.page.evaluate(() => document.activeElement?.classList.contains("lamp-skip")), true, "the first Tab reaches the skip link");
    assert.equal(await plain.page.evaluate(() => Boolean(document.querySelector(document.activeElement.getAttribute("href")))), true, "which points into the page");
  } finally {
    await plain.close();
  }
})(t);
});
