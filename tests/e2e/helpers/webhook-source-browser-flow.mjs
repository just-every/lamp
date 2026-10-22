import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { chromium } from 'playwright';
import { operatorHydrated } from './operator-hydrated.mjs';

/** INTAKE-005 on a phone: another tool connects with its own signing secret and JSON paths, its name saves as it is
 * typed, and its accepted and rejected receipts show without the secret or the payload. */
export async function webhookSourceBrowserFlow({ origin, cookie }) {
  const signingSecret = 'browser-alert-source-secret';
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })));
    const page = await context.newPage();
    await page.goto(`${origin}/app/alerts`); await operatorHydrated(page);
    await page.getByRole('button', { name: 'Another tool', exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the narrow source form must not introduce horizontal page overflow');
    await page.getByLabel('Name', { exact: true }).fill('Browser alert source');
    await page.getByLabel('Proof').selectOption('hmac');
    await page.getByLabel("The tool's own signing secret").fill(signingSecret);
    await page.locator('.tool-form summary').filter({ hasText: 'Payload fields' }).click();
    await page.getByLabel('Deduplication JSON path').fill('$.event.id');
    await page.getByLabel('Title JSON path').fill('$.event.title');
    await page.getByLabel('State JSON path').fill('$.event.state');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    const endpoint = await page.getByLabel('Address', { exact: true }).inputValue();
    assert.doesNotMatch(await page.locator('body').innerText(), new RegExp(signingSecret));
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    const row = page.getByRole('listitem', { name: 'Browser alert source', exact: true });
    await row.getByRole('button', { name: 'Edit Browser alert source', exact: true }).click();
    await page.locator('.tool-form').getByLabel('Name', { exact: true }).fill('Browser alert source — primary');
    await page.locator('.tool-save-state').getByText('Saved', { exact: true }).waitFor();
    assert.equal(await page.locator('.tool-form').getByLabel('Address', { exact: true }).inputValue(), endpoint);
    assert.ok(endpoint.includes('/api/intake/'), 'the connected source shows its real intake endpoint');

    async function sendAlert(payload) {
      const body = JSON.stringify(payload);
      const timestamp = new Date().toISOString();
      const signature = createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('base64url');
      return fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lamp-timestamp': timestamp, 'x-lamp-signature': signature }, body });
    }
    const accepted = await sendAlert({ event: { id: 'browser-alert-accepted', title: 'Browser intake acceptance', state: 'firing' } });
    assert.equal(accepted.status, 202, await accepted.text());
    const rejected = await sendAlert({ event: { title: 'Browser intake rejection', state: 'firing' } });
    assert.equal(rejected.status, 400, await rejected.text());

    await page.reload(); await operatorHydrated(page);
    await page.getByRole('listitem', { name: 'Browser alert source — primary', exact: true }).waitFor();
    const ownReceipts = page.locator('.receipt-card tr').filter({ hasText: 'Browser alert source — primary' });
    await ownReceipts.getByText('Accepted', { exact: true }).waitFor();
    await ownReceipts.getByText('Rejected', { exact: true }).waitFor();
    const receiptText = await page.locator('.receipt-card').innerText();
    assert.match(receiptText, /deduplication path/i);
    assert.doesNotMatch(receiptText, /browser-alert-source-secret|browser-alert-accepted/);
    await context.close();
  } finally { await browser.close(); }
}
