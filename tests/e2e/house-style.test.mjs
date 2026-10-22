import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { nativeRequest, openNativeRuntime, origin, publicOrigin } from '../dev-ingress/runtime.mjs';
import { devKey, devKeyHeaders } from '../helpers/dev-key.mjs';
import { operatorHydrated } from './helpers/operator-hydrated.mjs';
import { startFakeWorkersAi } from './helpers/fake-workers-ai.mjs';
import { textContrast } from './helpers/text-contrast.mjs';

// The house style (owner L18): made once at Setup from the site read, stored in the install's R2, shown on the public
// page, and re-made only when the brand changes. Workers AI is the one thing faked, at the network edge; the owner's
// website is the loopback internet Lamp's other journeys read.
const WIDTHS = [1440, 390];
const SUBJECT = { object: 'glass telescope', light: 'a soft glow from its lens', placement: 'standing', base: 'three wooden legs', why: 'It stands for seeing what broke and why.' };
const mark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#262348"/><circle cx="32" cy="32" r="13" fill="#6a5fc1"/></svg>';
const home = `<!doctype html><html><head><title>Error monitoring for developers | Northlight</title>
<meta name="description" content="Northlight watches your apps and tells you what broke. Start free today.">
<meta name="theme-color" content="#6a5fc1"><link rel="icon" type="image/svg+xml" href="/mark.svg"></head>
<body><header><nav><a href="/">Home</a><a href="/products/error-monitoring">Error Monitoring</a><a href="/products/uptime-monitoring">Uptime Monitoring</a><a href="/products/dashboard">Dashboard</a><a href="/pricing">Pricing</a></nav></header></body></html>`;
const evidence = process.env.LAMP_HOUSE_STYLE_EVIDENCE_DIR ? resolve(process.env.LAMP_HOUSE_STYLE_EVIDENCE_DIR) : null;

async function startSite() {
  const site = createServer((request, response) => {
    const host = request.headers['x-lamp-site-host'];
    if (host === 'northlight.example' && request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(home); return; }
    if (host === 'northlight.example' && request.url === '/mark.svg') { response.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(mark); return; }
    response.writeHead(404).end();
  });
  await new Promise((resolveListening) => site.listen(0, '127.0.0.1', resolveListening));
  return { origin: `http://127.0.0.1:${site.address().port}`, close: () => new Promise((resolveClosed) => site.close(resolveClosed)) };
}

// A claimed make starts from its queued job, or, where none starts within 30 seconds, from the minute Cron or the next
// request's due work. Local Vite development delivers no queue messages and runs no Cron, so every wait below keeps
// reading Lamp, as the Settings card does while a make runs.
async function until(read, label, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (last) return last;
    await new Promise((resolvePause) => setTimeout(resolvePause, 250));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

/** A claimed install whose owner has not run Setup yet, with the owner signed in to a browser. */
async function openInstall({ site, ai, browser }) {
  const runtime = await openNativeRuntime();
  runtime.env.LAMP_DEV_SITE_ORIGIN = site.origin;
  if (ai) runtime.env.LAMP_DEV_WORKERS_AI_ORIGIN = ai.origin;
  await runtime.start();
  await runtime.seedOperator();
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', runtime.state, '--config', 'wrangler.jsonc', '--command', "DELETE FROM setup_readiness WHERE step='first-run'"], { env: runtime.env, stdio: 'pipe' });
  const context = await browser.newContext({ timezoneId: 'UTC' });
  await context.route((url) => url.pathname.startsWith('/@fs/'), (route) => route.continue({ headers: { ...route.request().headers(), 'x-rer-dev-key': devKey } }));
  const entered = await signInAs({ origin, key: devKey });
  await context.addCookies(entered.cookies.map((cookie) => ({ ...cookie, url: origin })));
  const cookie = entered.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
  const api = async (path, init = {}) => {
    const response = await nativeRequest(path, { cookie, ...init });
    assert.ok(response.ok, `${init.method ?? 'GET'} ${path} answered ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  const restart = async (env) => { await runtime.stop(); Object.assign(runtime.env, env); for (const [name, value] of Object.entries(env)) if (value === undefined) delete runtime.env[name]; await runtime.start(); };
  return { runtime, context, api, restart, close: async () => { await context.close(); await runtime.close(); } };
}

/** The owner's Setup in the browser: their website first, then open Lamp. */
async function runSetup(context) {
  const page = await context.newPage();
  await page.goto(`${origin}/app`);
  await page.waitForURL('**/setup');
  await page.getByLabel('Website', { exact: true }).fill('northlight.example');
  await page.getByRole('button', { name: 'Read website', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'northlight.example' }).waitFor();
  await page.getByRole('button', { name: 'Looks right, open Lamp', exact: true }).click();
  await page.waitForURL('**/app');
  return page;
}

const published = async (path = '/') => (await fetch(`${publicOrigin}${path}`, { headers: devKeyHeaders })).text();
const shownTemplate = async () => (await published()).match(/<body data-template="([a-z]+)"/)?.[1] ?? 'default';
const footReason = async () => (await published()).match(/data-house-style data-reason="([a-z-]+)"/)?.[1] ?? null;
const houseStyle = async (install) => (await install.api('/api/app/house-style')).houseStyle;

/** Settings' Template card, as the owner reads it: what it says is showing and why, and the house style's own state. */
async function templateCard(page) {
  await page.goto(`${origin}/app/settings`);
  await operatorHydrated(page);
  const card = page.locator('section', { has: page.locator('#template-title') });
  return { card, select: page.getByRole('combobox', { name: /^Template/ }), status: card.getByRole('status').first() };
}

async function saveSettings(page, edit = async () => {}) {
  await page.goto(`${origin}/app/settings`);
  await operatorHydrated(page);
  await edit(page);
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/app/page-settings' && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  assert.equal((await saved).status(), 200);
}

async function shoot(page, name) {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
}

/** The public page at 1440 and 390: the layout it shows, no sideways scroll, and every text run readable over the
 *  real background behind it, with axe on the same page. */
async function visitPublic(context, name, { contrast = false } = {}) {
  const visitor = await context.newPage();
  const results = {};
  try {
    for (const width of WIDTHS) {
      await visitor.setViewportSize({ width, height: 900 });
      await visitor.goto(`${publicOrigin}/`, { waitUntil: 'networkidle' });
      await visitor.getByRole('heading', { level: 1 }).waitFor();
      assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} has no sideways scroll at ${width}`);
      await shoot(visitor, `${name}-${width}`);
      if (!contrast) continue;
      const axe = await new AxeBuilder({ page: visitor }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map((violation) => violation.id), [], `${name} at ${width} passes axe`);
      const runs = await textContrast(visitor);
      const below = runs.filter((run) => run.worst < run.needs);
      assert.deepEqual(below, [], `${name} at ${width}: every text run meets WCAG AA over the background behind it`);
      results[width] = { runs: runs.length, worst: Math.min(...runs.map((run) => run.worst)), sentence: runs.find((run) => run.needs === 3)?.worst ?? null };
    }
    return results;
  } finally { await visitor.close(); }
}

async function madeAtSetup() {
  const site = await startSite();
  const ai = await startFakeWorkersAi({ subject: SUBJECT, seen: 'Telescope' });
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  let install;
  try {
    install = await openInstall({ site, ai, browser });
    // Setup returns while the picture is still being drawn: the make runs as a queued job, never in the request.
    const release = ai.hold();
    const setup = await runSetup(install.context);
    await until(async () => (await houseStyle(install)) && ai.count('picture') === 1, 'the queued make to ask for its picture');
    assert.equal((await houseStyle(install)).record.state, 'making', 'Setup finished before the picture came back');
    assert.equal((await install.api('/api/app/page-settings')).settings.template, 'house', 'a fresh install with the binding saves House style');
    assert.equal(await shownTemplate(), 'calm');
    assert.equal(await footReason(), 'making', 'until it is made the page shows Calm headline and says why');
    release();
    const view = await until(async () => { const current = await houseStyle(install); return current.record?.state === 'ready' ? current : null; }, 'the house style to be made');
    await until(async () => (await shownTemplate()) === 'house', 'the public page to show the house style');

    // One make from the site read: a subject, one picture with the house reference attached, its cut-out named and
    // compared with the object asked for. Three models, one per kind of call.
    const [picture] = ai.pictures();
    assert.ok(picture.prompt.includes(SUBJECT.object) && picture.prompt.includes(SUBJECT.base), 'the picture is asked for the subject, resting on its base');
    assert.ok(picture.reference && picture.reference.bytes > 0, 'the house reference travels with the picture request');
    assert.deepEqual(['subject', 'picture', 'name', 'compare'].map((kind) => ai.count(kind)), [1, 1, 1, 1]);
    const models = new Map(ai.calls.map((call) => [call.kind === 'compare' ? 'subject' : call.kind, call.model]));
    assert.equal(new Set(ai.calls.map((call) => call.model)).size, 3, 'only three models: one picture model, one text model, one vision model');
    assert.equal(models.size, 3);
    const made = view.record.made;
    assert.equal(made.subject.object, SUBJECT.object);
    assert.equal(made.palette.accent, '#6a5fc1', 'the palette starts from the accent the site read gave');
    assert.equal(made.seen, 'Telescope');

    // Stored in the install's own R2: the record, the cut-out and the model's picture, under the house style's keys.
    const r2 = (key) => execFileSync('pnpm', ['exec', 'wrangler', 'r2', 'object', 'get', `lamp-local-snapshots/${key}`, '--local', '--persist-to', install.runtime.state, '--config', 'wrangler.jsonc', '--pipe'], { env: install.runtime.env, maxBuffer: 16 * 1024 * 1024 });
    assert.match(made.picture.key, /^house-style\/pictures\/[0-9A-Z]{26}\.jpg$/);
    assert.equal(made.picture.sourceKey, made.picture.key.replace(/\.jpg$/, '-source.jpg'));
    assert.equal(JSON.parse(r2('house-style/current.json').toString('utf8')).made.picture.key, made.picture.key);
    const cutOut = r2(made.picture.key), source = r2(made.picture.sourceKey);
    assert.deepEqual([...cutOut.subarray(0, 2), ...source.subarray(0, 2)], [0xff, 0xd8, 0xff, 0xd8], 'both pictures are stored as JPEG');
    // Each snapshot publishes the stored cut-out as /assets/moment; Settings shows the same bytes.
    const moment = await fetch(`${publicOrigin}/assets/moment`, { headers: devKeyHeaders });
    assert.equal(moment.headers.get('content-type'), 'image/jpeg');
    assert.ok(Buffer.from(await moment.arrayBuffer()).equals(cutOut), 'the public page links the stored cut-out');

    // The public page: the house layout, the picture, one sentence, components with their 90 days, history, subscribe.
    const visitor = await install.context.newPage();
    const requested = new Set();
    visitor.on('request', (request) => { if (request.resourceType() !== 'document') requested.add(new URL(request.url()).pathname); });
    await visitor.goto(`${publicOrigin}/`, { waitUntil: 'networkidle' });
    assert.equal(await visitor.locator('body').getAttribute('data-template'), 'house');
    // PAGE-003: the picture is one of the page's few requests, all to its own origin.
    assert.ok(requested.size <= 4, `the house page made ${[...requested].join(', ')}`);
    assert.equal(await visitor.locator('img[src="/assets/moment"]').evaluate((image) => image.complete && image.naturalWidth > 0), true, 'the picture loads');
    assert.equal(await visitor.getByRole('heading', { level: 1 }).count(), 1, 'one sentence of status');
    const publicComponents = (await install.api('/api/app/components')).components.filter((component) => !component.internal);
    assert.ok(publicComponents.length > 0, 'Setup kept the components the site read found');
    for (const component of publicComponents) await visitor.getByRole('list', { name: `90-day uptime record for ${component.name}` }).waitFor();
    await visitor.getByRole('heading', { name: 'History', exact: true }).waitFor();
    await visitor.locator('form[action="/subscribe"][method="post"]').getByLabel('Email address', { exact: true }).waitFor({ state: 'attached' });
    await visitor.close();

    // Settings shows it: the picture, the object, the palette, when it was made and with which model, and its state.
    const { card, select } = await templateCard(setup);
    assert.equal(await select.inputValue(), 'house');
    const details = card.locator('.template-house');
    assert.equal(await details.getAttribute('data-state'), 'ready');
    assert.equal(await details.locator('img').evaluate((image) => image.complete && image.naturalWidth > 0), true);
    const facts = await details.innerText();
    for (const fact of [made.subject.object, made.modelName, made.palette.ink, made.palette.stone]) assert.ok(facts.includes(fact), `the card shows ${fact}`);
    for (const width of WIDTHS) {
      await setup.setViewportSize({ width, height: 900 });
      assert.equal(await setup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Settings has no sideways scroll at ${width}`);
      await details.scrollIntoViewIfNeeded();
      if (evidence) await card.screenshot({ path: join(evidence, `settings-template-ready-${width}.png`) });
    }

    // Readable over the picture's light in both states, at both widths: axe, and every text run measured.
    const operational = await visitPublic(install.context, 'house-operational', { contrast: true });
    const [component] = (await install.api('/api/app/components')).components;
    await install.api(`/api/app/components/${component.id}/standing-claim`, { method: 'PUT', json: { state: 'Degraded performance' } });
    await until(async () => (await published()).includes('house-light tone-degraded'), 'the degraded state to publish');
    const degraded = await visitPublic(install.context, 'house-degraded', { contrast: true });
    // At phone width a degraded component's 90 days run the row's full width, as every other row's do.
    const phone = await install.context.newPage();
    await phone.setViewportSize({ width: 390, height: 900 });
    await phone.goto(`${publicOrigin}/`, { waitUntil: 'networkidle' });
    const bars = await phone.locator('.house-row').evaluateAll((rows) => rows.map((row) => ({ state: row.querySelector('.house-state')?.textContent, bar: Math.round(row.querySelector('.house-bar').getBoundingClientRect().width), row: Math.round(row.getBoundingClientRect().width) })));
    assert.ok(bars.some((row) => row.state === 'Degraded performance'));
    for (const row of bars) assert.equal(row.bar, row.row, `the ${row.state} row's bar is full width at 390`);
    await phone.close();

    // Any number of visits makes no AI call: the page, its stylesheet and its picture are stored files.
    const before = ai.count();
    for (let visit = 0; visit < 20; visit += 1) {
      for (const path of ['/', '/assets/template.css', '/assets/moment', '/history']) assert.equal((await fetch(`${publicOrigin}${path}`, { headers: devKeyHeaders })).status, 200);
    }
    await visitPublic(install.context, 'house-revisit');
    assert.equal(ai.count(), before, 'visitors never trigger a make');
    assert.ok(ai.count('picture') <= 2, 'at most two picture calls for the make');
    if (evidence) await writeFile(join(evidence, 'made-at-setup.json'), JSON.stringify({ calls: ai.calls.map(({ kind, model, seed, width, height, steps, reference }) => ({ kind, model, seed, width, height, steps, reference })), models: Object.fromEntries(models), prompt: picture.prompt, record: { ...view.record, made: { ...made, prompt: undefined } }, contrast: { operational, degraded }, bars }, null, 2));
  } finally {
    await install?.close();
    await browser.close();
    await ai.close();
    await site.close();
  }
}

async function withoutHouseStyle() {
  const site = await startSite();
  // Every picture is named something else than the object asked for, so every make fails its check.
  const ai = await startFakeWorkersAi({ subject: SUBJECT, seen: 'Flashlight' });
  ai.answer({ same: false });
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  let install;
  const reasons = [];
  // The kind is the same in the page's foot and in Settings, and each comes with a sentence; the copy is never read.
  async function saysWhy(page, reason, name) {
    assert.equal(await shownTemplate(), 'calm', `${name}: the page shows Calm headline`);
    assert.equal(await footReason(), reason, `${name}: the foot says why`);
    const visitor = await page.context().newPage();
    await visitor.goto(`${publicOrigin}/`);
    assert.ok((await visitor.locator(`[data-house-style][data-reason="${reason}"]`).innerText()).trim().length > 0);
    await visitor.close();
    await visitPublic(page.context(), `fallback-${name}`);
    const { status } = await templateCard(page);
    await until(async () => (await status.getAttribute('data-reason')) === reason, `Settings to say ${reason}`);
    assert.ok((await status.innerText()).trim().length > 0);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      if (evidence) await page.locator('section', { has: page.locator('#template-title') }).screenshot({ path: join(evidence, `settings-template-${name}-${width}.png`) });
    }
    reasons.push(reason);
  }
  try {
    install = await openInstall({ site, ai, browser });
    const page = await runSetup(install.context);
    // A failed check makes once more with the next seed, then fails with its reason.
    const failed = await until(async () => { const view = await houseStyle(install); return view.record?.state === 'failed' ? view : null; }, 'the make to fail its check');
    assert.equal(ai.count('picture'), 2, 'one make and one retry');
    const [first, second] = ai.pictures();
    assert.equal(second.seed, first.seed + 1, 'the retry draws with the next seed');
    assert.equal(failed.record.made, null);
    await until(async () => (await footReason()) === 'failed', 'the page to say the make failed');
    await saysWhy(page, 'failed', 'failed');

    // Make again draws two more; the day's budget then refuses the next, which the page names as its own reason.
    await (await templateCard(page)).card.getByRole('button', { name: 'Make again', exact: true }).click();
    await until(async () => ai.count('picture') === 4 && (await houseStyle(install)).record.state === 'failed', 'Make again to fail its check too');
    const { card } = await templateCard(page);
    await card.getByRole('button', { name: 'Make again', exact: true }).click();
    await until(async () => (await houseStyle(install)).record.state === 'refused', 'the budget to refuse a fifth picture');
    assert.equal(ai.count('picture'), 4, 'a refused make draws nothing');
    await until(async () => (await footReason()) === 'refused', 'the page to say the budget refused it');
    await saysWhy(page, 'refused', 'refused');

    // Without the binding the install can't make one: the page and Settings say it isn't connected.
    await install.restart({ LAMP_DEV_WORKERS_AI_ORIGIN: undefined });
    await saveSettings(page);
    await until(async () => (await footReason()) === 'not-connected', 'the page to say it is not connected');
    assert.equal((await houseStyle(install)).connected, false);
    await saysWhy(page, 'not-connected', 'not-connected');

    // A fresh install without the binding: Setup saves Calm headline, and the page says House style isn't connected.
    execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', install.runtime.state, '--config', 'wrangler.jsonc', '--command', "DELETE FROM setup_readiness WHERE step='first-run'; UPDATE page_settings SET template='default'"], { env: install.runtime.env, stdio: 'pipe' });
    await runSetup(install.context);
    assert.equal((await install.api('/api/app/page-settings')).settings.template, 'calm', 'a fresh install without the binding saves Calm headline');
    await until(async () => (await footReason()) === 'not-connected', 'the fresh page to say it is not connected');
    await saysWhy(page, 'not-connected', 'fresh-not-connected');
    assert.equal(ai.count('picture'), 4, 'nothing was drawn without the binding');
    assert.deepEqual([...new Set(reasons)], ['failed', 'refused', 'not-connected'], 'three distinct kinds');
  } finally {
    await install?.close();
    await browser.close();
    await ai.close();
    await site.close();
  }
}

async function remade() {
  const site = await startSite();
  const ai = await startFakeWorkersAi({ subject: SUBJECT, seen: 'Telescope' });
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  let install;
  const keyNow = async () => (await houseStyle(install)).record?.made?.picture.key ?? null;
  const shownKey = async () => (await published()).match(/data-moment="([^"]+)"/)?.[1] ?? null;
  const ready = async (label) => until(async () => { const view = await houseStyle(install); return view.record?.state === 'ready' || view.record?.state === 'failed' ? view : null; }, label);
  try {
    install = await openInstall({ site, ai, browser });
    const page = await runSetup(install.context);
    await ready('the house style to be made at Setup');
    const firstKey = await keyNow();
    await until(async () => (await shownKey()) === firstKey, 'the page to show the first picture');
    const seeds = () => ai.pictures().map((call) => call.seed);

    // Saving an unchanged brand queues nothing: a queued make would hold the record as making at once.
    const beforeSave = (await houseStyle(install)).record;
    await saveSettings(page);
    assert.deepEqual((await houseStyle(install)).record, beforeSave, 'an unchanged brand is not made again');

    // A changed tagline is a changed brand: exactly one make, from the first seed again, and the page shows it.
    await saveSettings(page, (settings) => settings.locator('label').filter({ hasText: /^Tagline/ }).locator('textarea').fill('Northlight tells you what broke, before your customers do.'));
    const changed = await ready('the changed brand to be made');
    assert.equal(changed.record.state, 'ready');
    assert.equal(ai.count('picture'), 2, 'one make for the changed brand');
    assert.equal(seeds()[1], seeds()[0], 'a new brand starts from the first seed');
    const secondKey = await keyNow();
    assert.notEqual(secondKey, firstKey);
    await until(async () => (await shownKey()) === secondKey, 'the page to show the re-made picture');
    assert.equal((await houseStyle(install)).record.state, 'ready', 'the change queued exactly one make');
    assert.equal(ai.count('picture'), 2);

    // A house style made yesterday under an earlier style version is made again once, from the brand as it is.
    const stored = execFileSync('pnpm', ['exec', 'wrangler', 'r2', 'object', 'get', 'lamp-local-snapshots/house-style/current.json', '--local', '--persist-to', install.runtime.state, '--config', 'wrangler.jsonc', '--pipe'], { env: install.runtime.env }).toString('utf8');
    const older = JSON.parse(stored);
    const signature = JSON.parse(older.signature);
    signature[0] = `${signature[0]}-earlier`;
    const yesterday = (at) => new Date(Date.parse(at) - 26 * 60 * 60_000).toISOString();
    Object.assign(older, { signature: JSON.stringify(signature), at: yesterday(older.at), pictures: older.pictures.map(yesterday) });
    const olderFile = join(install.runtime.directory, 'earlier-house-style.json');
    await writeFile(olderFile, JSON.stringify(older));
    execFileSync('pnpm', ['exec', 'wrangler', 'r2', 'object', 'put', 'lamp-local-snapshots/house-style/current.json', '--file', olderFile, '--content-type', 'application/json; charset=utf-8', '--local', '--persist-to', install.runtime.state, '--config', 'wrangler.jsonc'], { env: install.runtime.env, stdio: 'pipe' });
    await saveSettings(page);
    await until(async () => (await houseStyle(install)) && ai.count('picture') === 3, 'the earlier style version to be made again');
    await ready('the current style version to be made');
    assert.equal((await houseStyle(install)).record.state, 'ready', 'exactly one make for the version bump');
    assert.equal(ai.count('picture'), 3);
    const thirdKey = await keyNow();

    // Make again draws the next seed; while it draws, the page keeps the current picture, then shows the new one.
    const release = ai.hold();
    await (await templateCard(page)).card.getByRole('button', { name: 'Make again', exact: true }).click();
    await until(async () => (await houseStyle(install)) && ai.count('picture') === 4, 'Make again to ask for a picture');
    assert.equal(seeds()[3], seeds()[2] + 1, 'Make again draws with the next seed');
    assert.equal((await houseStyle(install)).record.state, 'making');
    assert.equal(await shownTemplate(), 'house');
    assert.equal(await shownKey(), thirdKey, 'the page keeps the current picture while a new one is made');
    const making = await templateCard(page);
    assert.equal(await making.card.locator('.template-house').getAttribute('data-state'), 'making');
    release();
    await ready('Make again to finish');
    const fourthKey = await keyNow();
    assert.notEqual(fourthKey, thirdKey);
    await until(async () => (await shownKey()) === fourthKey, 'the page to show the new picture');

    // A re-make that fails its check keeps the last house style on the page, and the card says why.
    ai.answer({ seen: 'Flashlight', same: false });
    await (await templateCard(page)).card.getByRole('button', { name: 'Make again', exact: true }).click();
    const failed = await until(async () => { const view = await houseStyle(install); return view.record?.state === 'failed' ? view : null; }, 'the re-make to fail');
    assert.equal(failed.record.made.picture.key, fourthKey, 'the last house style is kept');
    assert.equal(await shownTemplate(), 'house');
    assert.equal(await shownKey(), fourthKey);
    const { card, status } = await templateCard(page);
    await until(async () => (await card.locator('.template-house').getAttribute('data-state')) === 'failed', 'the card to say the re-make failed');
    assert.ok((await card.locator('.template-house-reason').first().innerText()).trim().length > 0, 'with its reason');
    assert.equal(await status.getAttribute('data-reason'), null, 'the page still shows its house style');
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      if (evidence) await card.screenshot({ path: join(evidence, `settings-template-remake-failed-${width}.png`) });
    }
    await visitPublic(install.context, 'house-after-failed-remake');
    if (evidence) await writeFile(join(evidence, 'remade.json'), JSON.stringify({ pictures: ai.pictures().map(({ seed }) => ({ seed })), keys: [firstKey, secondKey, thirdKey, fourthKey], failed: failed.record.reason }, null, 2));
  } finally {
    await install?.close();
    await browser.close();
    await ai.close();
    await site.close();
  }
}

// One registration for the three journeys the L18 build spec names: the seed's test inventory is at its cap of 200.
test('house style: made at setup and never per visit; the chosen template says why without one; re-made once per brand change', { timeout: 1_500_000 }, async (t) => {
  t.diagnostic('house style is made at setup, shown, stored and never made per visit (A1, A2, A5, A7, A8)');
  await madeAtSetup();
  t.diagnostic('without a house style the page shows the chosen template and says why (A4)');
  await withoutHouseStyle();
  t.diagnostic('brand change re-makes once; Make again; a failed re-make keeps the last (A3, A6)');
  await remade();
});
