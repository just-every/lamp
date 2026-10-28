import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { nativeRequest, openNativeRuntime, origin, publicOrigin } from '../dev-ingress/runtime.mjs';
import { devKey } from '../helpers/dev-key.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { notificationActivity, assertNoNewNotifications, moveInDoor } from '../helpers/import-notifications.mjs';
import { reservePort } from './worker-startup.mjs';

// One owner migration through the actual wizard and Cutover documents. The source
// table changes the saved export, not the behavior or the viewport under test.
test('MOVE-013 MOVE-014 MOVE-001 MOVE-002 MOVE-003 MOVE-004 MOVE-005 MOVE-006 MOVE-009 — owner reviews three providers, checks surviving public addresses, deliberately invites and undoes through Cutover', { timeout: 600_000 }, async () => {
  const runtime = await openNativeRuntime(); let browser;
  try {
    await runtime.start(); await runtime.seedOperator();
    browser = await chromium.launch({ executablePath: process.env.LAMP_CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route(url => url.pathname.startsWith('/@fs/'), route => route.continue({ headers: { ...route.request().headers(), 'x-rer-dev-key': devKey } }));
    const entered = await signInAs({ origin, key: devKey });
    await context.addCookies(entered.cookies.map(cookie => ({ ...cookie, url: origin })));
    const page = await context.newPage(); await page.goto(origin + entered.location); await page.waitForURL('**/app');
    await fetch(publicOrigin + '/');
    const evidence = process.env.LAMP_CUTOVER_EVIDENCE;
    if (evidence) await mkdir(evidence, { recursive: true });
    const moveIn = moveInDoor(async (path, body, headers) => {
      const response = await nativeRequest(path, { cookie: entered.header, ...(body === undefined ? {} : { method: 'POST', json: body }), headers });
      return { status: response.status, body: await response.json() };
    });
    const openWizard = async () => {
      const hydrated = page.waitForResponse(response => response.url() === origin + '/api/app/statuspage-import/jobs' && response.request().method() === 'GET' && response.status() === 200);
      await page.goto(origin + '/app/move-in'); await hydrated;
    };
    for (const source of ['statuspage', 'betterstack', 'instatus']) {
      const quiet = await notificationActivity(runtime);
      await openWizard();
      await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption(source);
      const directory = resolve('tests/fixtures', source, 'small');
      const files = (await readdir(directory)).map(name => join(directory, name));
      const review = async () => {
        await page.getByLabel('Saved responses', { exact: true }).setInputFiles(files);
        if (source === 'instatus') await page.getByLabel('Instatus page ID', { exact: true }).fill('synthpage01');
        if (source !== 'statuspage') await page.getByLabel(source === 'instatus' ? /This Instatus page and its history/ : /This Better Stack page is public/).check();
        const reviewing = page.waitForResponse(response => response.url() === origin + '/api/operator/import/plan');
        await page.getByRole('button', { name: 'Run dry run', exact: true }).click();
        const reviewed = await reviewing; assert.equal(reviewed.status(), 200, await reviewed.text());
        await page.getByRole('heading', { name: 'Dry run', exact: true }).waitFor();
      };
      await review();
      // A different source invalidates the reviewed upload before the owner can apply it.
      await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption(source === 'statuspage' ? 'instatus' : 'statuspage');
      assert.equal(await page.getByRole('button', { name: 'Import', exact: true }).count(), 0);
      await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption(source); await review();
      await page.getByRole('link', { name: 'Read the Cutover preview', exact: true }).click();
      await page.getByRole('heading', { name: 'Old public addresses', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Send invitations', exact: true }).isDisabled(), true);
      await openWizard(); await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption(source); await review();
      await page.getByLabel('I reviewed what changes, is skipped or is refused.').check();
      const applying = page.waitForResponse(response => /\/api\/app\/statuspage-import\/jobs\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'GET');
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      const result = await (await applying).json(); assert.equal(result.job.state, 'completed');
      await page.goto(origin + `/app/cutover?job=${result.job.id}`);
      await page.getByRole('heading', { name: 'Old public addresses', exact: true }).waitFor();
      await page.getByLabel('Public address', { exact: true }).fill(publicOrigin);
      await page.getByRole('button', { name: 'Use this address for checks' }).click();
      const checks = page.getByRole('button', { name: 'Check opens', exact: true });
      assert.ok(await checks.count(), 'imported bookmarks have an explicit open check');
      for (const button of await checks.all()) {
        await button.click(); await button.locator('..').getByRole('status').filter({ hasText: /^Opens$/ }).waitFor();
      }
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.filter(row => ['serious', 'critical'].includes(row.impact)), []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      if (evidence) await page.screenshot({ path: join(evidence, `${source}-cutover-1440.png`), fullPage: true });
      await assertNoNewNotifications(runtime, quiet, 'navigation, checks and history reads remain silent');
      await page.getByLabel('Public address', { exact: true }).fill(`http://127.0.0.1:${await reservePort()}`);
      await page.getByRole('button', { name: 'Use this address for checks' }).click();
      const first = page.getByRole('button', { name: 'Check opens', exact: true }).first(); await first.click();
      await first.locator('..').getByRole('status').filter({ hasText: 'Could not verify' }).waitFor();
      const sending = page.waitForResponse(response => response.url().endsWith('/send-invitations'));
      await page.getByRole('button', { name: 'Send invitations', exact: true }).click();
      const sent = await sending; assert.equal(sent.status(), 200, await sent.text());
      assert.equal((await sent.json()).report.cutover.invitations.eligible, 0);
      assert.equal(await page.getByRole('button', { name: 'Send invitations', exact: true }).isDisabled(), true);
      await page.reload(); await page.getByRole('heading', { name: 'Old public addresses', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Send invitations', exact: true }).isDisabled(), true);
      const repeated = await moveIn.read(result.job.id); assert.equal(repeated.body.report.cutover.invitations.eligible, 0);
      const undone = await moveIn.undo(result.door); assert.equal(undone.status, 200, JSON.stringify(undone.body));
      assert.equal(undone.body.job.state, 'undone');
      for (const row of result.report.cutover.rows) assert.equal((await fetch(publicOrigin + row.path)).status, 404);
    }
    await context.close();
  } finally { await browser?.close(); await runtime.close(); }
});
