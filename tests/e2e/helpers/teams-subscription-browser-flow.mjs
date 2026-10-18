import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { operatorHydrated } from './operator-hydrated.mjs';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

/** Called at pending and active milestones of the Worker Teams journey. */
export async function teamsSubscriptionBrowserFlow({ publicOrigin, confirmationUrl, manageUrl, selectedComponent, destination }) {
  assert.equal(process.env.HOME, userInfo().homedir, 'browser uses the real account HOME');
  const proof = process.env.LAMP_SCREENSHOTS;
  if (proof) await mkdir(proof, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  // Axe executes its own audit script; keep it in a separate context so the
  // actual subscription journey remains script-disabled.
  const accessibilityContext = await browser.newContext();
  const accessibilityPage = await accessibilityContext.newPage();
  try {
    for (const width of [1440, 390]) {
      // Both visitors share the test machine's egress. Let the next minute begin
      // before the second signup; the real public rate limiter stays enabled.
      if (confirmationUrl && width === 390) await new Promise(resolve => setTimeout(resolve, Math.min(59999, 60000 - Date.now() % 60000 + 10)));
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
      const screens = confirmationUrl ? [['teams-subscribe', `${publicOrigin}/subscribe/teams`, 'Get updates in Microsoft Teams'], ['teams-confirm', confirmationUrl, 'Confirm Teams subscription']] : [['teams-manage', manageUrl, 'Manage subscription']];
      for (const [name, url, heading] of screens) {
        const response = await page.goto(url); assert.equal(response.status(), 200);
        await page.getByRole('heading', { name: heading, exact: true }).waitFor();
        if (name === 'teams-subscribe') {
          await page.getByLabel('Teams Workflows webhook URL', { exact: true }).fill(destination);
          await page.getByLabel('Contact email', { exact: true }).fill('teams-contact@example.test');
          await page.getByRole('checkbox', { name: selectedComponent, exact: true }).check();
          assert.equal(await page.getByRole('button', { name: 'Send verification card' }).count(), 1);
        }
        if (name === 'teams-manage') {
          await page.getByText('Channel: Microsoft Teams', { exact: true }).waitFor();
          assert.equal(await page.getByRole('checkbox', { name: selectedComponent, exact: true }).isChecked(), true);
          assert.equal(await page.getByRole('button', { name: 'Unsubscribe', exact: true }).count(), 1);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px ${name} fits viewport`);
        if (proof) await page.screenshot({ path: `${proof}/${width}-${name}.png`, fullPage: true });
        if (name === 'teams-subscribe') {
          await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Send verification card', exact: true }).click()]);
          await page.getByRole('heading', { name: 'Check your Teams channel', exact: true }).waitFor();
          if (proof) await page.screenshot({ path: `${proof}/${width}-teams-verification-requested.png`, fullPage: true });
        }
        await accessibilityPage.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
        assert.equal((await accessibilityPage.goto(url)).status(), 200);
        const axe = await new AxeBuilder({ page: accessibilityPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(axe.violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => row.id), []);
      }
    }
    if (confirmationUrl) {
      await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Confirm subscription', exact: true }).click()]);
      await page.getByRole('heading', { name: 'Teams subscription confirmed', exact: true }).waitFor();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        if (proof) await page.screenshot({ path: `${proof}/${width}-teams-confirmed.png`, fullPage: true });
      }
      return { manageUrl: await page.getByRole('link', { name: 'Manage this subscription', exact: true }).getAttribute('href').then(path => new URL(path, publicOrigin).href) };
    }
    await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Save selection', exact: true }).click()]);
    await page.getByRole('heading', { name: 'Subscription updated', exact: true }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      if (proof) await page.screenshot({ path: `${proof}/${width}-teams-selection-saved.png`, fullPage: true });
    }
  } finally { await Promise.allSettled([context.close(), accessibilityContext.close()]); await browser.close(); }
}

/** The operator-facing Teams labels and report filter remain useful after a failure. */
export async function teamsOperatorBrowserFlow({ origin, publicOrigin, cookie, reportIncidentId }) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  const context = await browser.newContext();
  await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })));
  const page = await context.newPage();
  const proof = process.env.LAMP_SCREENSHOTS;
  if (proof) await mkdir(proof, { recursive: true });
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(publicOrigin);
      await page.locator('a[href="/subscribe/teams"]').waitFor();
      await page.locator('a[href="/subscribe/teams"]').scrollIntoViewIfNeeded();
      await inspect('teams-public-page');
      await page.goto(`${origin}/app/subscribers`); await operatorHydrated(page);
      await page.getByRole('heading', { name: 'Subscribers', exact: true }).waitFor();
      await page.getByRole('region', { name: 'Subscriber records', exact: true }).getByText('Microsoft Teams channel', { exact: true }).first().waitFor();
      await page.getByRole('region', { name: 'Subscriber records', exact: true }).scrollIntoViewIfNeeded();
      await inspect('teams-directory');
      const filtered = page.waitForResponse(response => response.url().includes('/api/app/subscriber-reporting?') && response.url().includes('channel=teams'));
      await page.locator('.subscriber-reporting select').selectOption('teams');
      assert.equal((await filtered).status(), 200);
      assert.equal(await page.locator('.subscriber-reporting select').inputValue(), 'teams');
      await page.locator('.subscriber-reporting').scrollIntoViewIfNeeded();
      await inspect('teams-reporting');
      await page.goto(`${origin}/app/deliveries`); await operatorHydrated(page);
      await page.getByRole('heading', { name: 'Deliveries', exact: true }).waitFor();
      await page.getByText('Microsoft Teams channel', { exact: true }).first().waitFor();
      await page.getByText('Microsoft Teams channel', { exact: true }).first().scrollIntoViewIfNeeded();
      await inspect('teams-deliveries');
      await page.goto(`${origin}/app/incidents/${reportIncidentId}`); await operatorHydrated(page);
      const report = page.locator('.report-editor');
      await report.getByRole('textbox', { name: /^Summary/ }).waitFor();
      await report.getByLabel('Teams subscribers', { exact: true }).check();
      await report.getByLabel('Email', { exact: true }).uncheck();
      await report.scrollIntoViewIfNeeded();
      await inspect('teams-report-publication');
    }
    const published = page.waitForResponse(response => response.url().endsWith(`/api/app/incidents/${reportIncidentId}/report/publish`) && response.request().method() === 'POST');
    await page.locator('.report-editor').getByRole('button', { name: 'Publish report', exact: true }).click();
    const response = await published;
    assert.deepEqual(response.request().postDataJSON().channels, ['teams']);
    assert.equal(response.status(), 200);
    const publishedReport = page.locator('.context-section').filter({ has: page.getByRole('heading', { name: 'Post-incident report', exact: true }) });
    await publishedReport.getByText(/^Published /).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await publishedReport.evaluate(element => element.scrollIntoView({ block: 'center' }));
      if (proof) await publishedReport.screenshot({ path: `${proof}/${width}-teams-report-published.png` });
    }
    async function inspect(name) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} fits viewport`);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      assert.deepEqual(axe.violations.filter(row => ['serious','critical'].includes(row.impact)).map(row => row.id), [], `${name} accessibility`);
      if (proof) await page.screenshot({ path: `${proof}/${page.viewportSize().width}-${name}.png` });
    }
  } finally { await context.close(); await browser.close(); }
}
