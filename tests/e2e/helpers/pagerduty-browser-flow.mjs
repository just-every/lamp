import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { operatorHydrated } from './operator-hydrated.mjs';

/** The owner connects PagerDuty from the Alerts picker, reads its receipts, then removes it. */
export async function pagerDutyBrowserFlow({ api, component, origin, cookie }) {
  const target = await component('PagerDuty API');
  const secret = 'synthetic-browser-pagerduty-subscription';
  const fixture = JSON.parse(await readFile(new URL('../../fixtures/pagerduty/triggered.json', import.meta.url), 'utf8'));
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })));
    const page = await context.newPage();
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${origin}/app/alerts`); await operatorHydrated(page);
      await page.getByRole('button', { name: 'PagerDuty', exact: true }).click();
      const editor = page.locator('section.tool-form');
      await editor.getByLabel('Component 1').selectOption(target.id);
      await editor.getByLabel('Service ID 1', { exact: true }).fill('PAPI123');
      await editor.getByRole('button', { name: 'Connect PagerDuty', exact: true }).click();
      // PagerDuty makes the subscription's signing secret, so this one paste remains, saved by its own button.
      const secretField = editor.getByLabel('PagerDuty signing secret', { exact: true });
      await secretField.waitFor();
      const sourceId = (await editor.getByLabel('PagerDuty address', { exact: true }).inputValue()).split('/').pop();
      const card = page.getByRole('listitem', { name: 'PagerDuty', exact: true });
      await card.getByText('Needs its signing secret', { exact: true }).waitFor();
      await capture(editor, 'pagerduty-endpoint');
      await secretField.fill(secret);
      await editor.getByRole('button', { name: 'Save secret', exact: true }).click();
      await editor.getByText('Signing secret saved.').waitFor();
      const source = (await api('/api/app/intake/sources')).body.sources.find(row => row.id === sourceId);
      assert.ok(source.webhookConnected);
      const send = async payload => {
        const raw = JSON.stringify(payload);
        const response = await fetch(source.endpointUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PagerDuty-Signature': `v1=${createHmac('sha256', secret).update(raw).digest('hex')}` }, body: raw });
        assert.equal(response.status, payload.event.data.service.id === 'PAPI123' ? 202 : 400, await response.text());
      };
      fixture.event.id = `browser-trigger-${width}`;
      fixture.event.data.id = `browser-incident-${width}`;
      await send(fixture);
      fixture.event.id = `browser-unmapped-${width}`; fixture.event.data.service.id = 'PUNKNOWN';
      await send(fixture); fixture.event.data.service.id = 'PAPI123';
      await page.reload(); await operatorHydrated(page);
      await card.getByText('Connected', { exact: true }).waitFor();
      await card.getByRole('button', { name: 'Edit PagerDuty', exact: true }).click();
      await editor.locator('summary').filter({ hasText: 'Send your updates back to PagerDuty' }).click();
      await editor.getByLabel('PagerDuty REST API key').fill('fixture-browser-write-only-key');
      await editor.getByRole('button', { name: 'Save key', exact: true }).click();
      await editor.locator('summary').filter({ hasText: 'Updates go back to PagerDuty as notes' }).waitFor();
      await capture(editor, 'pagerduty-connected');
      const receipts = page.locator('.receipt-card');
      await receipts.getByText('PagerDuty', { exact: true }).first().waitFor();
      await capture(receipts, 'pagerduty-receipts');
      await card.getByRole('button', { name: 'Remove PagerDuty', exact: true }).click();
      await capture(card, 'pagerduty-erasure');
      await page.getByRole('group', { name: 'Remove PagerDuty?' }).getByRole('button', { name: 'Remove PagerDuty', exact: true }).click();
      await card.waitFor({ state: 'detached' });
      await receipts.getByText('PagerDuty', { exact: true }).first().waitFor({ state: 'detached' });
      assert.ok(!(await api('/api/app/intake/sources')).body.sources.some(row => row.id === source.id));
      async function capture(locator, suffix) {
        await locator.scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} PagerDuty has no horizontal overflow`);
        if (process.env.LAMP_SCREENSHOTS) await locator.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-${suffix}.png` });
      }
    }
    await context.close();
  } finally { await browser.close(); }
}
