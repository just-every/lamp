import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { openSubscriberManagementFixture } from './subscriber-management-fixture.mjs';

// The local public host serves the actual token-authorized management form.
export async function webhookFormatBrowserFlow() {
  const fixture = await openSubscriberManagementFixture({ pageHost: 'localhost' });
  const contact = 'synthetic-lamp-18001@example.test';
  const added = await fixture.post('/api/app/subscribers', { channel: 'webhook', destination: 'https://receiver.example.test/synthetic-lamp-18001', contactEmail: contact, componentIds: [], webhookFormat: 'statuspage' });
  assert.equal(added.status, 201, added.text);
  await fixture.confirm(contact);
  const manageUrl = fixture.messagesFor(contact)[0].text.match(/https?:\/\/\S+\/manage\/\S+/)?.[0];
  assert.ok(manageUrl); const subscriberId = added.body.subscriber.id;
  await fixture.createComponent('Synthetic subscription component');
  const { publicOrigin } = fixture;
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        const hydrationErrors = [];
        page.on('console', message => { if (/hydration|did not match|server rendered/i.test(message.text())) hydrationErrors.push(message.text()); });
        page.on('pageerror', error => { if (/hydration|did not match|server rendered/i.test(error.message)) hydrationErrors.push(error.message); });
        const publicResponse = await page.goto(publicOrigin);
        assert.equal(publicResponse.status(), 200);
        const subscribe = page.getByRole('region', { name: 'Subscribe to status updates', exact: true });
        await subscribe.waitFor();
        for (const action of ['/subscribe', '/subscribe/slack', '/subscribe/teams']) {
          const form = subscribe.locator(`form[action="${action}"]`);
          if (action !== '/subscribe') await form.locator('..').locator(':scope > summary').click();
          for (const summary of await form.locator('details > summary').all()) await summary.click();
          assert.equal(await form.getByRole('checkbox', { name: 'Incidents', exact: true }).isChecked(), true);
          assert.equal(await form.getByRole('checkbox', { name: 'Maintenance', exact: true }).isChecked(), true);
          assert.equal(await form.getByRole('checkbox', { name: 'Component status changes', exact: true }).isChecked(), false);
          assert.equal(await form.getByRole('checkbox', { name: 'Only incidents reaching Partially unavailable or worse', exact: true }).isChecked(), false);
          await form.getByRole('checkbox', { name: 'Synthetic subscription component', exact: true }).check();
          await form.getByRole('checkbox', { name: 'Component status changes', exact: true }).check();
          assert.equal(await form.getByRole('checkbox', { name: 'Component status changes', exact: true }).isChecked(), true);
          assert.equal(await form.getAttribute('method'), 'post');
        }
        await subscribe.locator('form[action="/subscribe/teams"]').getByRole('textbox', { name: 'Teams Workflows webhook URL', exact: true }).fill('https://not-microsoft.example.test/synthetic-lamp-1');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `expanded public subscription controls fit ${width}`);
        const publicAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(publicAxe.violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => row.id), [], `public subscription controls axe ${width}`);
        if (process.env.LAMP_BROWSER_EVIDENCE) { await mkdir(process.env.LAMP_BROWSER_EVIDENCE, { recursive: true }); await page.screenshot({ path: join(process.env.LAMP_BROWSER_EVIDENCE, `public-subscriptions-${width}.png`), fullPage: true }); }
        const url = `${publicOrigin}${new URL(manageUrl).pathname}`;
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
        const management = page.locator('form').first();
        await management.getByRole('checkbox', { name: 'Incidents', exact: true }).uncheck();
        await management.getByRole('checkbox', { name: 'Maintenance', exact: true }).check();
        await management.getByRole('checkbox', { name: 'Component status changes', exact: true }).uncheck();
        await management.getByRole('checkbox', { name: 'Only incidents reaching Partially unavailable or worse', exact: true }).check();
        await Promise.all([page.waitForNavigation(), management.getByRole('button', { name: 'Save selection', exact: true }).click()]);
        await page.getByRole('heading', { name: 'Subscription updated', exact: true }).waitFor();
        await page.goto(url);
        await page.getByRole('heading', { name: 'Manage subscription', exact: true }).waitFor();
        assert.equal(await management.getByRole('checkbox', { name: 'Incidents', exact: true }).isChecked(), false);
        assert.equal(await management.getByRole('checkbox', { name: 'Maintenance', exact: true }).isChecked(), true);
        assert.equal(await management.getByRole('checkbox', { name: 'Component status changes', exact: true }).isChecked(), false);
        assert.equal(await management.getByRole('checkbox', { name: 'Only incidents reaching Partially unavailable or worse', exact: true }).isChecked(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `management selector fits ${width}`);
        const managedAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(managedAxe.violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => row.id), [], `management preferences axe ${width}`);
        assert.deepEqual(hydrationErrors, [], `public subscription and management hydration ${width}`);
        if (process.env.LAMP_BROWSER_EVIDENCE) { await mkdir(process.env.LAMP_BROWSER_EVIDENCE, { recursive: true }); await page.screenshot({ path: join(process.env.LAMP_BROWSER_EVIDENCE, `webhook-management-${width}.png`), fullPage: true }); }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await fixture.close(); }
}
