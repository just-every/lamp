import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { appOrigin } from './follow-ups-runtime.mjs';
import { openSubscriberManagementFixture, eventuallySubscriber } from './subscriber-management-fixture.mjs';

// The local public host serves the actual token-authorized management form.
export async function webhookFormatBrowserFlow() {
  const fixture = await openSubscriberManagementFixture({ pageHost: 'localhost' });
  const contact = 'synthetic-lamp-18001@example.test';
  await fixture.createComponent('synthetic-lamp-18001');
  await eventuallySubscriber(async () => (await fixture.raw('http://localhost/')).status, status => status === 200, 'the public generation serves management styles');
  const added = await fixture.post('/api/app/subscribers', { channel: 'webhook', destination: 'https://receiver.example.test/synthetic-lamp-18001', contactEmail: contact, componentIds: [], webhookFormat: 'statuspage' });
  assert.equal(added.status, 201, added.text);
  await fixture.confirm(contact);
  const manageUrl = fixture.messagesFor(contact)[0].text.match(/https?:\/\/\S+\/manage\/\S+/)?.[0];
  assert.ok(manageUrl); const subscriberId = added.body.subscriber.id;
  const port = new URL(appOrigin).port;
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        const url = `http://localhost:${port}${new URL(manageUrl).pathname}`;
        const response = await page.goto(url); assert.equal(response.status(), 200);
        await page.getByRole('heading', { name: 'Manage subscription', exact: true }).waitFor();
        for (const value of ['lamp', 'statuspage']) {
          await page.getByLabel('Webhook format', { exact: true }).selectOption(value);
          await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Save selection', exact: true }).click()]);
          await page.getByRole('heading', { name: 'Subscription updated', exact: true }).waitFor();
          await page.goto(url);
          assert.equal(await page.getByLabel('Webhook format', { exact: true }).inputValue(), value);
          assert.equal((await fixture.list()).find(row => row.id === subscriberId).webhookFormat, value);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `management selector fits ${width}`);
        if (process.env.LAMP_BROWSER_EVIDENCE) { await mkdir(process.env.LAMP_BROWSER_EVIDENCE, { recursive: true }); await page.screenshot({ path: join(process.env.LAMP_BROWSER_EVIDENCE, `webhook-management-${width}.png`), fullPage: true }); }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await fixture.close(); }
}
