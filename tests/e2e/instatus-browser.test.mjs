import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { openNativeRuntime, origin } from '../dev-ingress/runtime.mjs';
import { devKey } from '../helpers/dev-key.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { notificationActivity, assertNoNewNotifications } from '../helpers/import-notifications.mjs';

test('MOVE-001 Instatus source-first review and Cutover keep provider labels, invalidate switched-source previews and fit desktop/mobile', { timeout: 600000 }, async () => {
  const runtime = await openNativeRuntime(); let browser;
  try {
    await runtime.start(); await runtime.seedOperator(); browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
    const context = await browser.newContext();
    await context.route(url => url.pathname.startsWith('/@fs/'), route => route.continue({ headers: { ...route.request().headers(), 'x-rer-dev-key': devKey } }));
    const entered = await signInAs({ origin, key: devKey });
    await context.addCookies(entered.cookies.map(cookie => ({ ...cookie, url: origin })));
    const page = await context.newPage(); await page.goto(origin + entered.location); await page.waitForURL('**/app');
    const before = await notificationActivity(runtime);
    const evidence = resolve(process.env.LAMP_INSTATUS_EVIDENCE ?? 'visual/instatus'); await mkdir(evidence, { recursive: true });
    // Hold the browser entry at the network boundary: a server-rendered select
    // must not accept a source change before React can handle that change.
    let release;
    const hydration = new Promise(resolve => { release = resolve; });
    const holdEntry = async route => { await hydration; await route.continue(); };
    await page.route('**/src/client.tsx', holdEntry);
    try {
      await page.goto(`${origin}/app/move-in`, { waitUntil: 'commit' });
      const source = page.getByRole('combobox', { name: 'Source', exact: true });
      await source.waitFor(); assert.equal(await source.isDisabled(), true);
    } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
    await page.waitForFunction(() => document.querySelector('select')?.disabled === false);
    const openMoveIn = async () => {
      const hydrated = page.waitForResponse(response => response.url() === origin + '/api/app/statuspage-import/jobs' && response.request().method() === 'GET' && response.status() === 200);
      await page.goto(`${origin}/app/move-in`); await hydrated;
    };
    for (const family of ['small', 'large']) {
      await openMoveIn();
      await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('instatus');
      await page.getByRole('heading', { name: 'Move in from Instatus', exact: true }).waitFor();
      assert.doesNotMatch(await page.locator('fieldset').allInnerTexts().then(rows => rows.join(' ')), /Statuspage|Better Stack/);
      await page.getByLabel('Instatus page ID', { exact: true }).fill('synthpage01');
      const directory = resolve('tests/fixtures/instatus', family);
      await page.getByLabel('Saved responses', { exact: true }).setInputFiles((await readdir(directory)).map(name => join(directory, name)));
      await page.getByLabel(/This Instatus page and all supplied history/).check();
      const reviewing = page.waitForResponse(response => response.url().endsWith('/statuspage-import/preview'));
      await page.getByRole('button', { name: 'Run dry run', exact: true }).click();
      const reviewed = await reviewing; assert.equal(reviewed.status(), 200, await reviewed.text());
      await page.getByRole('heading', { name: 'Dry run', exact: true }).waitFor();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.filter(row => ['serious', 'critical'].includes(row.impact)), []);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
        await page.screenshot({ path: join(evidence, `${family}-${width}.png`), fullPage: true });
      }
      await page.getByRole('link', { name: 'Read the Cutover preview', exact: true }).click();
      await page.getByRole('heading', { name: 'Feeds and other readers', exact: true }).waitFor();
      const feeds = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Feeds and other readers', exact: true }) });
      assert.match(await feeds.innerText(), /Instatus/); assert.match(await feeds.innerText(), /\/history\.atom/); assert.match(await feeds.innerText(), /\/history\.rss/);
      assert.doesNotMatch(await feeds.innerText(), /Statuspage|Better Stack|\/index\.json/);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({ path: join(evidence, `${family}-cutover-${width}.png`), fullPage: true });
      }
      await openMoveIn(); await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('instatus');
      await page.getByRole('heading', { name: 'Move in from Instatus', exact: true }).waitFor();
      await page.getByLabel('Instatus page ID', { exact: true }).fill('synthpage01');
      await page.getByLabel('Saved responses', { exact: true }).setInputFiles((await readdir(directory)).map(name => join(directory, name)));
      await page.getByLabel(/This Instatus page and all supplied history/).check();
      await page.getByRole('button', { name: 'Run dry run', exact: true }).click(); await page.getByRole('heading', { name: 'Dry run', exact: true }).waitFor();
      await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('betterstack');
      assert.equal(await page.getByRole('heading', { name: 'Dry run', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Import', exact: true }).count(), 0);
      await assertNoNewNotifications(runtime, before);
    }
    await context.close();
  } finally { await browser?.close(); await runtime.close(); }
});
