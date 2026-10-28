import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { operatorHydrated } from './operator-hydrated.mjs';
import { incidentComposer, newIncidentForm } from './incident-composer.mjs';

/** Settings and composer public doors. Authentication uses only this fixture's
 * private one-click dev link. No cookies are copied and no provider call occurs:
 * the operator explicitly deselects Social before every test publication. */
export async function socialBrowserFlow({ origin, devLink, diagnostic = () => {} }) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LAMP_CHROMIUM_EXECUTABLE ?? (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /hydrat|did not match|server rendered/i.test(message.text())) errors.push(message.text()); });
    // Never let a navigation diagnostic expose the private fragment.
    try { await page.goto(await devLink()); await page.waitForURL(url => url.pathname === '/app'); }
    catch { throw new Error('The fixture one-click owner sign-in did not complete.'); }
    await operatorHydrated(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    async function api(path, init = {}) {
      return page.evaluate(async ({ path, init }) => {
        const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
        return { status: response.status, body: await response.json() };
      }, { path, init });
    }
    async function settings() {
      await page.goto(`${origin}/app/settings#channels`); await operatorHydrated(page);
      const region = page.getByRole('region', { name: 'X, Bluesky and Mastodon', exact: true });
      await expect(region.getByRole('button', { name: 'Connect social account', exact: true })).toBeEnabled();
      return region;
    }
    let panel = await settings();
    await expect(panel.getByRole('checkbox', { name: 'Post by default', exact: true })).not.toBeChecked();
    const accountName = 'synthetic-lamp-browser-1';
    await panel.getByLabel('Social network', { exact: true }).selectOption('x');
    await panel.getByLabel('Account name', { exact: true }).fill(accountName);
    await panel.getByLabel('Post prefix', { exact: true }).fill('Synthetic Lamp:');
    await panel.getByLabel('X OAuth 2.0 user token (tweet.write)', { exact: true }).fill('synthetic-lamp-browser-2');
    await panel.getByRole('button', { name: 'Connect social account', exact: true }).click();
    await expect(panel.getByText('Social account connected.', { exact: true })).toBeVisible();
    await expect(panel.getByLabel('X OAuth 2.0 user token (tweet.write)', { exact: true })).toHaveValue('');
    await expect(panel.getByRole('listitem').filter({ hasText: accountName })).toBeVisible();
    await page.reload(); await operatorHydrated(page); panel = page.getByRole('region', { name: 'X, Bluesky and Mastodon', exact: true });
    await expect(panel.getByLabel('X OAuth 2.0 user token (tweet.write)', { exact: true })).toHaveValue('');
    assert.ok(!(await page.locator('body').innerText()).includes('synthetic-lamp-browser-2'), 'saved credentials never reappear');
    await panel.getByRole('checkbox', { name: 'Post by default', exact: true }).check();
    await expect(panel.getByText('Social posting default saved.', { exact: true })).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: 'Post by default', exact: true })).toBeChecked();
    await inspect('1440px Settings social connection and saved default');
    await maintenanceChoice(1440);

    const created = await api('/api/app/components', { method: 'POST', body: JSON.stringify({ groupId: null, name: 'synthetic-lamp-browser-3', description: '', internal: false, displayOrder: 0, note: '' }) });
    assert.equal(created.status, 201);
    const component = created.body.component;
    await page.goto(`${origin}/app/incidents/new`); await operatorHydrated(page);
    const newForm = newIncidentForm(page);
    await newForm.moreOptions();
    const social = page.getByRole('checkbox', { name: 'Social accounts', exact: true });
    await expect(social).toBeChecked();
    await social.uncheck();
    await newForm.title.fill('Synthetic Lamp social browser publication');
    await newForm.addComponent(component.name);
    await newForm.impact.fill('Customers see a synthetic browser test interruption.');
    await newForm.audience.fill('Synthetic test customers.');
    await page.getByRole('button', { name: '30 min', exact: true }).click();
    await expect(social).not.toBeChecked();
    await inspect('1440px composer keeps explicit social deselection');
    const publish = page.waitForResponse(response => response.url().includes('/publish') && response.request().method() === 'POST');
    await newForm.publish.click();
    assert.equal((await publish).status(), 200);
    await page.waitForURL(url => /^\/app\/incidents\/[A-Z0-9]{26}$/.test(url.pathname));
    await operatorHydrated(page);
    await page.getByRole('button', { name: 'Publish update', exact: true }).waitFor();
    const incidentUrl = page.url();
    const composer = incidentComposer(page);
    await composer.moreOptions();
    await expect(page.getByRole('checkbox', { name: 'Social accounts', exact: true })).toBeChecked();
    const incidentId = new URL(incidentUrl).pathname.split('/').at(-1);
    const afterFirst = await api(`/api/app/incidents/${incidentId}`);
    assert.equal(afterFirst.body.incident.updates.length, 1);
    assert.equal((await api('/api/app/social')).body.posts.length, 0, 'explicit deselection queues no post');

    panel = await settings();
    await panel.getByRole('checkbox', { name: 'Post by default', exact: true }).uncheck();
    await expect(panel.getByText('Social posting default saved.', { exact: true })).toBeVisible();
    await page.goto(incidentUrl); await operatorHydrated(page); await composer.moreOptions();
    const nextSocial = page.getByRole('checkbox', { name: 'Social accounts', exact: true });
    await expect(nextSocial).not.toBeChecked();
    // A manual opt-in belongs to this update and cannot carry over to the next.
    await nextSocial.check(); await nextSocial.uncheck();
    await composer.impact.fill('Customers see the next synthetic browser update.');
    await composer.audience.fill('Synthetic test customers.');
    await page.getByRole('button', { name: '30 min', exact: true }).click();
    await page.getByText('Draft saved', { exact: true }).waitFor();
    const nextPublish = page.waitForResponse(response => response.url().includes('/publish') && response.request().method() === 'POST');
    await composer.publish.click(); assert.equal((await nextPublish).status(), 200);
    await expect(page.getByText('Update published.', { exact: true })).toBeVisible();
    await expect(nextSocial).not.toBeChecked();
    assert.equal((await api('/api/app/social')).body.posts.length, 0, 'repeated deselection queues no post');
    diagnostic('INTEG-002 browser 1440px: Settings connected an account, concealed the saved credential, saved post-by-default on/off; composer respected deselection and reset each new update to the owner default.');

    // The candidate's changed screens are observed once at phone width too.
    await page.setViewportSize({ width: 390, height: 844 });
    panel = await settings();
    await expect(panel.getByRole('listitem').filter({ hasText: accountName })).toBeVisible();
    await inspect('390px Settings social accounts');
    await page.goto(`${origin}/app/incidents/new`); await operatorHydrated(page);
    await newIncidentForm(page).moreOptions();
    await expect(page.getByRole('checkbox', { name: 'Social accounts', exact: true })).not.toBeChecked();
    await inspect('390px new incident social selector');
    await page.goto(incidentUrl); await operatorHydrated(page); await composer.moreOptions();
    await expect(page.getByRole('checkbox', { name: 'Social accounts', exact: true })).not.toBeChecked();
    await inspect('390px composer social selector');
    await maintenanceChoice(390);
    await page.setViewportSize({ width: 1440, height: 1000 }); panel = await settings();
    await panel.getByRole('button', { name: `Remove ${accountName}`, exact: true }).click();
    await expect(panel.getByText(`${accountName} removed.`, { exact: true })).toBeVisible();
    await expect(panel.getByRole('listitem').filter({ hasText: accountName })).toHaveCount(0);
    assert.deepEqual(errors, [], 'social screens have no page or hydration errors');
    diagnostic('INTEG-002 browser: Settings, incident composer and maintenance scheduling at 1440 and 390 have no horizontal overflow or serious/critical accessibility findings; account removed through Settings. Screens retained under ./test-results/social; private sign-in links are never retained.');
    await context.close();
    async function maintenanceChoice(width) {
      await page.goto(`${origin}/app/maintenance`); await operatorHydrated(page);
      const schedule = page.locator('#schedule-maintenance');
      await expect(schedule.getByRole('checkbox', { name: 'Post this notice to social accounts', exact: true })).not.toBeChecked();
      await inspect(`${width}px maintenance social notice choice stays off`);
    }
    async function inspect(name) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no horizontal overflow`);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(axe.violations.filter(violation => ['serious', 'critical'].includes(violation.impact)).map(violation => ({ id: violation.id, targets: violation.nodes.map(node => node.target) })), [], `${name}: accessibility`);
      await mkdir('./test-results/social', { recursive: true });
      await page.screenshot({ path: `./test-results/social/${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`, fullPage: true });
    }
  } finally { await browser.close(); }
}
