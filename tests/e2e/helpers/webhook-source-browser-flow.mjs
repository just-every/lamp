import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { chromium } from 'playwright';
import { operatorHydrated } from './operator-hydrated.mjs';

/** INTAKE-005 on a phone: another tool connects with its own signing secret and JSON paths, its name saves as it is typed
 * (a refused save never vanishes as the owner leaves), and its accepted and rejected receipts show without the secret or the payload. */
export async function webhookSourceBrowserFlow({ origin, cookie, api, post }) {
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

    // A link (here through the phone Menu), Close and Back each wait for the pending write. Refused (by the server itself:
    // another tool has the name), the owner stays on the open form with the typed name, the reason and Retry on screen,
    // and the server keeps the saved name. Leaving again with the refusal standing asks once.
    const taken = (await post('/api/app/intake/sources', { name: 'Browser alert source — taken', credentialKind: 'bearer-token', bearerToken: 'synthetic-lamp-1', deduplicationPath: '$.alert.id', titlePath: '$.alert.title', statePath: '$.alert.state' })).body.source;
    const form = page.locator('.tool-form');
    const name = form.getByLabel('Name', { exact: true });
    const state = form.locator('.tool-save-state');
    const retry = state.getByRole('button', { name: 'Retry', exact: true });
    const settled = promise => promise.then(() => true, () => false);
    const menu = async label => { await page.getByRole('button', { name: 'Menu', exact: true }).click(); await page.getByRole('navigation', { name: 'Workspace sections' }).getByRole('link', { name: label, exact: true }).click(); };
    const close = () => form.locator('.tool-form-heading').getByRole('button', { name: 'Close', exact: true }).click();
    const savedName = async () => { await name.fill('Browser alert source — primary'); await state.getByText('Saved', { exact: true }).waitFor(); };
    async function held(how, typed = taken.name) {
      // Held, the refusal shows; let go, the form leaves with the owner.
      await Promise.race([settled(retry.waitFor()), settled(form.waitFor({ state: 'detached' }))]);
      await settled(page.waitForURL(url => url.pathname === '/app/alerts', { timeout: 5_000 }));
      assert.equal(new URL(page.url()).pathname, '/app/alerts', `${how}: the owner stays on Alerts`);
      assert.equal(await form.count(), 1, `${how}: the form stays open`);
      assert.equal(await name.inputValue(), typed, `${how}: the typed name stays`);
      // The reason and Retry come into view wherever the owner was on the page.
      const onScreen = () => { const parts = [...document.querySelectorAll('.tool-form .tool-save-state :is([role="alert"], button)')]; return parts.length === 2 && parts.every(part => { const box = part.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }); };
      await settled(page.waitForFunction(onScreen, null, { timeout: 5_000 }));
      assert.ok(await page.evaluate(onScreen), `${how}: the refusal's reason and Retry are on screen`);
      assert.equal((await api('/api/app/intake/sources')).body.sources.find(source => endpoint.includes(`/api/intake/${source.id}`)).name, 'Browser alert source — primary', `${how}: the server keeps the saved name`);
    }
    await name.fill(taken.name); await menu('Overview'); await held('a link');
    const asked = new Promise(resolve => { page.once('dialog', dialog => { resolve(dialog.type()); void dialog.dismiss(); }); setTimeout(() => resolve('none'), 10_000); });
    await menu('Overview');
    assert.equal(await asked, 'confirm', 'leaving again with the refusal standing asks once');
    await held('the link again, kept');
    await savedName(); await name.fill(taken.name); await close(); await held('Close');
    // Alerts reached in the app, so Back stays in it. A held Back leaves the page alone: with the name at the bottom of
    // the screen the refusal that grows below it stays in view, and offline nothing reloads over the form.
    await savedName(); await menu('Overview'); await page.waitForURL(url => url.pathname === '/app');
    await menu('Alerts'); await page.getByRole('button', { name: 'Edit Browser alert source — primary', exact: true }).click();
    const low = () => name.evaluate(field => scrollBy(0, field.getBoundingClientRect().bottom - innerHeight + 4));
    await low(); await name.fill(taken.name); await page.evaluate(() => history.back()); await held('Back');
    const offline = 'Browser alert source — offline';
    await savedName(); await low(); await name.fill(offline); await context.setOffline(true);
    try { await page.evaluate(() => history.back()); await held('Back offline', offline); }
    finally { await context.setOffline(false); }
    await retry.click(); await state.getByText('Saved', { exact: true }).waitFor();
    assert.equal((await api('/api/app/intake/sources')).body.sources.find(source => endpoint.includes(`/api/intake/${source.id}`)).name, offline, 'online again, Retry stores the name');
    await savedName(); await close(); await form.waitFor({ state: 'detached' });
    assert.equal((await api(`/api/app/intake/sources/${taken.id}`, { method: 'DELETE' })).status, 200);

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
