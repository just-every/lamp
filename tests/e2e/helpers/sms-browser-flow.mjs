import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { operatorHydrated } from './operator-hydrated.mjs';

/** Existing built-Worker fixture, real browser/forms/auth, synthetic Twilio edge. */
export async function smsBrowserFlow({ page, origin, pageOrigin, api, post, messages }) {
  const errors = [];
  page.on('pageerror', error => { if (/hydration|did not match|server rendered/i.test(error.message)) errors.push(error.message); });
  page.on('console', message => { if (/hydration|did not match|server rendered/i.test(message.text())) errors.push(message.text()); });
  const created = await post('/api/app/components', { groupId: null, name: 'synthetic-lamp-401', description: '', internal: false, displayOrder: 0, note: '' });
  assert.equal(created.status, 201, created.text);
  const component = created.body.component;
  const audit = async (label, width) => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} ${width}: no horizontal overflow`);
    assert.deepEqual(await page.locator('button,input,select,textarea').evaluateAll(controls => controls.filter(control => control.offsetWidth && control.scrollWidth > control.clientWidth + 1).map(control => control.getAttribute('aria-label') || control.textContent || control.name)), [], `${label} ${width}: every control retains its full label`);
    assert.deepEqual((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => row.id), [], `${label} ${width}: axe`);
    assert.deepEqual(errors, [], `${label} ${width}: no hydration mismatch`);
    if (process.env.LAMP_BROWSER_EVIDENCE) {
      await mkdir(process.env.LAMP_BROWSER_EVIDENCE, { recursive: true });
      await page.screenshot({ path: join(process.env.LAMP_BROWSER_EVIDENCE, `sms-${label}-${width}.png`), fullPage: true });
    }
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`${origin}/app/settings#notifications`);
    await operatorHydrated(page);
    const settings = page.getByRole('region', { name: 'SMS delivery', exact: true });
    await expect(settings.getByLabel('United States', { exact: true })).toBeChecked();
    await expect(settings.getByLabel('Canada', { exact: true })).toBeChecked();
    await settings.getByLabel('United Kingdom', { exact: true }).check();
    await settings.getByLabel('Support contact', { exact: true }).fill('https://help.example.com');
    const save = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/sms/settings' && response.request().method() === 'PUT');
    await settings.getByRole('button', { name: 'Save SMS settings', exact: true }).click();
    assert.equal((await save).status(), 200);
    await expect(settings.getByRole('status')).toHaveText('SMS settings saved.');
    await page.reload(); await operatorHydrated(page);
    await expect(settings.getByLabel('United Kingdom', { exact: true })).toBeChecked();
    assert.ok((await api('/api/app/sms/settings')).body.settings.countries.includes('GB'));
    await audit('settings', width);

    await page.goto(`${pageOrigin}/`);
    await page.getByRole('heading', { name: 'Subscribe to status updates', exact: true }).waitFor();
    await page.getByText('Get updates by SMS', { exact: true }).click();
    const sms = page.locator('form[action="/subscribe/sms"]');
    await sms.getByText('Choose components', { exact: true }).click();
    await sms.getByRole('checkbox', { name: component.name, exact: true }).check();
    await sms.getByLabel('Mobile number', { exact: true }).fill(width === 1440 ? '+12025550151' : '+12025550152');
    await audit('subscribe', width);
    const optIn = page.waitForResponse(response => new URL(response.url()).pathname === '/subscribe/sms' && response.request().method() === 'POST');
    await sms.getByRole('button', { name: 'Send opt-in text', exact: true }).click();
    assert.equal((await optIn).status(), 202);
    await page.getByRole('heading', { level: 1 }).waitFor();
    assert.equal(messages.filter(message => message.To === (width === 1440 ? '+12025550151' : '+12025550152')).length, 1, 'native subscribe form sends exactly one opt-in');

    await page.goto(`${origin}/app/subscribers`); await operatorHydrated(page);
    const add = page.getByRole('region', { name: 'Add subscriber', exact: true });
    await add.getByLabel('Channel', { exact: true }).selectOption('sms');
    const phone = width === 1440 ? '+12025550161' : '+12025550162';
    await add.getByLabel('Mobile number', { exact: true }).fill(phone);
    await add.getByRole('checkbox', { name: component.name, exact: true }).check();
    await audit('add', width);
    const added = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/subscribers' && response.request().method() === 'POST');
    await add.getByRole('button', { name: 'Add subscriber and send confirmation', exact: true }).click();
    const response = await added;
    assert.equal(response.status(), 201);
    const subscriber = (await response.json()).subscriber;
    assert.equal(subscriber.channel, 'sms');
    assert.deepEqual(subscriber.componentSelections.map(row => row.componentId), [component.id]);
    await page.getByRole('row').filter({ hasText: phone }).getByText('pending', { exact: true }).waitFor();
    assert.equal(messages.filter(message => message.To === phone).length, 1);
    await audit('added', width);

    await page.goto(`${origin}/app/incidents/new`); await operatorHydrated(page);
    await page.getByText('More options', { exact: true }).click();
    const controls = page.getByRole('region', { name: 'Publication controls', exact: true });
    await expect(controls.getByRole('checkbox', { name: 'SMS', exact: true })).toBeVisible();
    await controls.getByRole('checkbox', { name: 'SMS', exact: true }).check();
    await expect(controls.getByRole('checkbox', { name: 'SMS', exact: true })).toBeChecked();
    await audit('composer', width);
  }
}
