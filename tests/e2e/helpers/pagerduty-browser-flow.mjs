import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { operatorHydrated } from './operator-hydrated.mjs';

/** The owner connects the actual source form, reads its receipts, then erases it. */
export async function pagerDutyBrowserFlow({ api, component, origin, cookie }) {
  const target = await component('PagerDuty API');
  const secret = 'fixture-browser-pagerduty-subscription';
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
      const editor = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Connect PagerDuty', exact: true }) });
      const name = `Production PagerDuty ${width}`;
      await editor.getByLabel('PagerDuty name', { exact: true }).fill(name);
      await editor.getByLabel('Component 1').selectOption(target.id);
      await editor.getByLabel('PagerDuty service ID 1', { exact: true }).fill('PAPI123');
      await editor.getByRole('button', { name: 'Create PagerDuty endpoint', exact: true }).click();
      const card = page.getByRole('article', { name: `PagerDuty source ${name}`, exact: true });
      await card.getByText('Awaiting signing secret', { exact: true }).waitFor();
      await capture(editor, 'pagerduty-endpoint');
      await card.getByRole('button', { name: `Add signing secret for ${name}`, exact: true }).click();
      await editor.getByLabel('PagerDuty subscription secret', { exact: true }).fill(secret);
      await editor.getByRole('button', { name: 'Save PagerDuty source', exact: true }).click();
      await card.getByText('Configured', { exact: true }).waitFor();
      const source = (await api('/api/app/intake/sources')).body.sources.find(row => row.name === name);
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
      await card.getByRole('button', { name: 'Connect responder notes', exact: true }).click();
      await editor.getByLabel('Reconnect PagerDuty REST API key').fill('fixture-browser-write-only-key');
      await editor.getByRole('button', { name: 'Save and reconnect PagerDuty', exact: true }).click();
      await card.getByText('Connected', { exact: true }).waitFor();
      await capture(editor, 'pagerduty-connected');
      const receipts = page.locator('.receipt-card');
      await receipts.getByText(name, { exact: true }).first().waitFor();
      await capture(receipts, 'pagerduty-receipts');
      await card.getByRole('button', { name: 'Erase source', exact: true }).click();
      await capture(card, 'pagerduty-erasure');
      await card.getByRole('button', { name: 'Permanently erase source', exact: true }).click();
      await card.waitFor({ state: 'detached' });
      await receipts.getByText(name, { exact: true }).first().waitFor({ state: 'detached' });
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
