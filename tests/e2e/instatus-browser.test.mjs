import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { openNativeRuntime, origin, operator, envelopes } from '../dev-ingress/runtime.mjs';
import { devKey } from '../helpers/dev-key.mjs';

test('MOVE-001 Instatus source-first review and Cutover keep provider labels, invalidate switched-source previews and fit desktop/mobile', { timeout: 600000 }, async () => {
  const runtime = await openNativeRuntime(); let browser;
  try {
    await runtime.start(); await runtime.seedOperator(); browser = await chromium.launch();
    const context = await browser.newContext();
    await context.route(url => url.pathname.startsWith('/@fs/'), route => route.continue({ headers: { ...route.request().headers(), 'x-rer-dev-key': devKey } }));
    const page = await context.newPage(); await page.goto(`${origin}/signin`);
    const priorMail = new Set((await envelopes()).map(row => row.id));
    await page.getByLabel('Email', { exact: true }).fill(operator);
    const requested = page.waitForResponse(response => response.url() === origin + '/auth/magic-link' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Email a sign-in link' }).click();
    const sent = await requested;
    // The maintained sign-in page submits a native form, not the JSON API.
    assert.equal(sent.request().isNavigationRequest(), true);
    assert.match(sent.request().headers()['content-type'], /^application\/x-www-form-urlencoded(?:;|$)/);
    assert.equal(sent.status(), 303);
    assert.equal(sent.headers().location, '/signin?notice=sent');
    await page.waitForURL(origin + '/signin?notice=sent');
    await page.getByRole('status').waitFor();
    const signInMail = (await envelopes()).find(row => !priorMail.has(row.id) && row.message.to === operator && row.message.text.includes('/auth/confirm?'));
    assert.ok(signInMail, 'the form submission captures a new sign-in email');
    const link = signInMail.message.text.match(/https?:\/\/[^\s]+/)[0];
    await page.goto(link); await page.getByRole('button', { name: 'Confirm', exact: true }).click(); await page.waitForURL('**/app');
    const before = (await envelopes()).length;
    const evidence = resolve(process.env.LAMP_INSTATUS_EVIDENCE ?? 'visual/instatus'); await mkdir(evidence, { recursive: true });
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
      await openMoveIn(); await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('instatus');
      await page.getByLabel('Instatus page ID', { exact: true }).fill('synthpage01');
      await page.getByLabel('Saved responses', { exact: true }).setInputFiles((await readdir(directory)).map(name => join(directory, name)));
      await page.getByLabel(/This Instatus page and all supplied history/).check();
      await page.getByRole('button', { name: 'Run dry run', exact: true }).click(); await page.getByRole('heading', { name: 'Dry run', exact: true }).waitFor();
      await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('betterstack');
      assert.equal(await page.getByRole('heading', { name: 'Dry run', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Import', exact: true }).count(), 0);
      assert.equal((await envelopes()).length, before);
    }
    await context.close();
  } finally { await browser?.close(); await runtime.close(); }
});
