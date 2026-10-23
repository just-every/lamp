import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { operatorHydrated } from './operator-hydrated.mjs';

/** The operator links a signed Slack identity using the visible Settings door. */
export async function chatLinksBrowserFlow({ origin, cookie, signingSecret, diagnostic = () => {} }) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })));
    const page = await context.newPage();
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${origin}/app/settings`); await operatorHydrated(page);
      await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Slack and Teams', exact: true }).click();
      const panel = page.getByRole('region', { name: 'Chat links', exact: true });
      await panel.getByRole('button', { name: 'Create link code', exact: true }).click();
      const command = panel.locator('code').first();
      await expect(command).toHaveText(/^\/lamp link [a-f0-9]{48}$/);
      const text = await command.innerText();
      const raw = new URLSearchParams({ command: '/lamp', team_id: 'synthetic-lamp-1', user_id: `synthetic-lamp-${width}`, text: text.slice('/lamp '.length) }).toString();
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${raw}`).digest('hex')}`;
      const send = () => fetch(`${origin}/api/chat/slack`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Slack-Request-Timestamp': timestamp, 'X-Slack-Signature': signature }, body: raw });
      assert.equal((await send()).status, 200, 'the signed Slack door accepts the Settings code');
      assert.equal((await send()).status, 409, 'the Settings code can link only once');
      await panel.getByRole('button', { name: 'Refresh chat links', exact: true }).click();
      const link = panel.getByRole('listitem').filter({ hasText: `synthetic-lamp-${width}` });
      await expect(link).toBeVisible();
      await panel.getByRole('button', { name: 'Hide link code', exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px Chat links does not overflow`);
      if (process.env.LAMP_SCREENSHOTS) await panel.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-chat-linked.png` });
      await link.getByRole('button', { name: 'Remove chat link', exact: true }).click();
      await expect(link).toHaveCount(0);
      await expect(panel.getByText('No chat identities linked.', { exact: true })).toBeVisible();
      diagnostic(`INCIDENT-012 ${width}px Settings: minted, linked once through signed Slack and removed`);
    }
    await context.close();
  } finally { await browser.close(); }
}
