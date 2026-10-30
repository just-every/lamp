import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { operatorHydrated } from './operator-hydrated.mjs';

/** Read the saved operator channels through Settings, without retaining the private sign-in link. */
export async function channelsBrowserFlow({ origin, devLink, channels, componentName, secrets }) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try { await page.goto(await devLink()); await page.waitForURL(url => url.pathname === '/app'); }
    catch { throw new Error('The fixture one-click owner sign-in did not complete.'); }
    await operatorHydrated(page);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.goto(`${origin}/app/settings#channels`);
      await operatorHydrated(page);
      await page.reload();
      await operatorHydrated(page);
      const panel = page.getByRole('region', { name: 'Slack and Teams', exact: true });
      await expect(panel.getByLabel('Incoming webhook URL', { exact: true })).toHaveValue('');
      for (const channel of channels) {
        const row = panel.getByRole('listitem').filter({ has: page.getByText(channel.name, { exact: true }) });
        await expect(row).toHaveCount(1);
        await expect(row).toContainText(channel.host);
        await expect(row).toContainText(channel.kind === 'slack' ? componentName : 'all components');
        await expect(row.getByRole('button', { name: 'Send test post', exact: true })).toBeEnabled();
        await expect(row.getByRole('button', { name: 'Remove', exact: true })).toBeEnabled();
      }
      const markup = await page.content();
      for (const secret of secrets) assert.ok(!markup.includes(secret), 'saved webhook credentials and ciphertext never appear in the Settings document');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'saved channel Settings has no horizontal overflow');
      await mkdir('./test-results/channels', { recursive: true });
      await panel.screenshot({ path: `./test-results/channels/saved-channels-${width}.png` });
    }
    assert.deepEqual(errors, [], 'saved channel Settings has no browser errors');
    await context.close();
  } finally { await browser.close(); }
}
