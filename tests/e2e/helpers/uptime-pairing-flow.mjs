import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright';
import { operatorHydrated } from './operator-hydrated.mjs';

// run-uptime creates each webhook destination's signing secret itself and shows it only to its own owner
// (notification-destinations.server.ts), so this secret never reaches Lamp. The paired address carries
// the key Lamp made; Uptime's X-Lamp-Timestamp still bounds replays.
const uptimeSecret = 'synthetic-secret-only-uptime-holds';
function uptimeEvent(monitorId, monitorName, key, kind = 'trigger') {
  if (kind === 'test') return { schemaVersion: 2, id: `test:${key}`, kind: 'test', eventType: 'uptime.notification.test', incidentKey: null, state: 'test', title: 'Test notification: Uptime', monitorId: null, monitorRevision: null, monitorName: 'Test notification', url: '', slotId: null, observedAt: Date.now(), visibility: 'private', evidenceRef: '', explanation: 'This is a test notification. No monitor state or incident was changed.', probes: [], consoleUrl: 'https://uptime.example.test' };
  const recovered = kind === 'recovery';
  return { schemaVersion: 2, id: `${key}:${kind}`, kind, eventType: recovered ? 'uptime.incident.recovered' : 'uptime.incident.firing', incidentKey: key, state: recovered ? 'recovered' : 'firing', title: `${recovered ? 'Recovered' : 'Down'}: ${monitorName}`, monitorId, monitorRevision: 1, monitorName, url: 'https://shop.example.test/health', slotId: key, observedAt: Date.now() - 60000, visibility: 'private', evidenceRef: `/api/monitors/${monitorId}/history`, explanation: 'Confirmed scheduled failure.', probes: [{ name: 'us-east', outcome: recovered ? 'pass' : 'target_failure', reason: recovered ? 'All checks passed' : 'Expected HTTP 200; received 503' }], consoleUrl: 'https://uptime.example.test', webhookContext: { monitorType: 'http', httpStatusCode: recovered ? 200 : 503, ...(recovered ? {} : { failedAssertion: 'status' }) }, incidentContext: { version: 2, confirmedStartedAt: Date.now() - 60000, confirmedRecoveredAt: recovered ? Date.now() : null, downtimeSeconds: recovered ? 60 : null, originalReason: 'Expected HTTP 200; received 503', failedLocations: [{ probe: 'us-east', name: 'US East', reason: 'HTTP 503' }], timeZone: 'UTC' } };
}
async function send(address, payload, { timestamp = new Date().toISOString(), stamp = true } = {}) {
  const body = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json', ...(stamp ? { 'X-Lamp-Timestamp': timestamp, 'X-Lamp-Signature': createHmac('sha256', uptimeSecret).update(`${timestamp}.${body}`).digest('base64url') } : {}) };
  const response = await fetch(address, { method: 'POST', headers, body });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** The owner connects Uptime from the Alerts picker with nothing to type, then pairs it by picking the monitors Uptime's own events name. */
export async function uptimePairingFlow({ api, component, origin, cookie }) {
  const storefront = await component('Storefront');
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ["--no-sandbox", '--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })));
    const page = await context.newPage();
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    for (const width of [1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const open = async () => { await page.goto(`${origin}/app/alerts`); await operatorHydrated(page); };
      const inspect = async (name, { axe = false } = {}) => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${name} has no horizontal overflow`);
        assert.deepEqual(await page.locator('.tool-picker button, .tool-row button, .tool-form button').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent)), [], `${width} ${name} controls keep their full labels`);
        if (axe) {
          const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
          assert.deepEqual(result.violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => row.id), [], `${width} ${name} accessibility`);
        }
        if (process.env.LAMP_SCREENSHOTS) await page.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-uptime-pairing-${name}.png`, fullPage: true });
      };
      await open();
      assert.ok(await page.getByRole('heading', { name: 'Connect a tool', exact: true }).isVisible(), 'Alerts opens on the picker');
      assert.deepEqual(await Promise.all(['.tool-form', '.receipt-card', '.connected-tools'].map(selector => page.locator(selector).count())), [0, 0, 0], 'no form, receipts or connected list before anything is connected');
      await inspect('picker', { axe: true });

      await page.getByRole('button', { name: 'Uptime', exact: true }).click();
      await page.getByRole('heading', { name: 'Connect Uptime', exact: true }).waitFor();
      assert.deepEqual(await Promise.all(['.tool-form', '.tool-picker', '.tool-form input, .tool-form select, .tool-form textarea'].map(selector => page.locator(selector).count())), [1, 0, 0], 'only Uptime is open, and it asks for nothing');
      await page.getByRole('button', { name: 'Make the Uptime address', exact: true }).click();
      const address = await page.getByLabel('Uptime address', { exact: true }).inputValue();
      assert.match(address, /\/api\/intake\/[0-9A-HJKMNP-TV-Z]{26}\/[A-Za-z0-9_-]{40,}$/, 'Lamp makes the key and puts it in the address');
      assert.equal(await page.locator('input[type=password]').count(), 0, 'no secret to type anywhere');
      assert.equal(await page.locator('.receipt-card').count(), 0);
      await inspect('address', { axe: true });
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      const row = page.getByRole('listitem', { name: 'Uptime', exact: true });
      await row.getByText('Waiting for the first alert', { exact: true }).waitFor();
      assert.equal(await page.locator('.tool-form').count(), 0, 'a connected tool shows as its row, its form closed');
      const source = (await api('/api/app/intake/sources')).body.sources.find(row => address.includes(`/api/intake/${row.id}/`));
      assert.equal(source.credentialKind, 'bearer-token');
      assert.ok(!(await api('/api/app/intake/sources')).text.includes(address.split('/').pop()), 'the key is shown once');

      // Only Lamp's key with a fresh Uptime stamp gets in; refused requests are not arrivals.
      const key = `incident:paired-${width}`;
      const monitorId = `storefront-${width}`;
      assert.equal((await send(address.replace(/[^/]+$/, 'not-the-key'), uptimeEvent(monitorId, 'Storefront', key))).status, 401);
      assert.equal((await send(address, uptimeEvent(monitorId, 'Storefront', key), { stamp: false })).status, 401);
      assert.equal((await send(address, uptimeEvent(monitorId, 'Storefront', key), { timestamp: new Date(Date.now() - 6 * 60000).toISOString() })).status, 401, 'INTAKE-008 replay outside five minutes');
      await open();
      assert.equal(await page.locator('.receipt-card').count(), 0, 'receipts wait for an arrival');

      // Uptime's Send test proves the address; its first alert names the monitor to pick.
      assert.equal((await send(address, uptimeEvent(null, null, key, 'test'))).status, 400);
      assert.equal((await send(address, uptimeEvent(monitorId, 'Storefront', key))).status, 400, 'an unpicked monitor opens no draft');
      await open();
      await row.getByText('1 monitor to pick', { exact: true }).waitFor();
      const receipts = page.locator('.receipt-card');
      await receipts.getByText('Monitor not picked yet. Pick its component under Uptime.', { exact: true }).waitFor();
      await receipts.getByText("An Uptime test. Only Uptime's alerts open drafts.", { exact: true }).waitFor();
      await inspect('first-arrival');

      await row.getByRole('button', { name: 'Edit Uptime', exact: true }).click();
      const pick = page.getByLabel('Storefront', { exact: true });
      await pick.selectOption({ label: 'Storefront' });
      await page.locator('.tool-save-state').getByText('Saved', { exact: true }).waitFor();
      await inspect('picked', { axe: true });
      assert.deepEqual((await api('/api/app/intake/sources')).body.sources.find(row => row.id === source.id).monitorMappings, [{ monitorId, componentId: storefront.id }]);
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      const second = `${key}:after-pick`;
      const firing = await send(address, uptimeEvent(monitorId, 'Storefront', second));
      assert.equal(firing.status, 202, JSON.stringify(firing));
      const incident = (await api(`/api/app/incidents/${firing.body.incidentId}`)).body.incident;
      assert.deepEqual(incident.components.map(row => row.componentId), [storefront.id], 'the draft carries the picked component');
      assert.equal(incident.updates.length, 0, 'nothing is published');
      await open();
      await row.getByText('Connected', { exact: true }).waitFor();
      const accepted = receipts.locator('tr').filter({ has: page.locator(`a[href="/app/incidents/${firing.body.incidentId}"]`) });
      await accepted.getByText('Accepted', { exact: true }).waitFor();
      await inspect('receipts', { axe: true });
      await accepted.getByRole('link', { name: 'Open draft' }).click(); await operatorHydrated(page);
      await page.getByRole('heading', { name: 'Brief', exact: true }).waitFor();
      assert.ok(await page.getByText('Storefront').first().isVisible(), 'the mapped component shows on the draft');
      await page.locator('#brief-A1 summary').click();
      assert.ok(await page.locator('#brief-A1').getByText(/Vantages: US East/).isVisible(), 'the brief lists the vantages');
      assert.equal((await send(address, uptimeEvent(monitorId, 'Storefront', second, 'recovery'))).status, 202);
      assert.equal((await api(`/api/app/incidents/${incident.id}`)).body.incident.lifecycle, 'Resolved', 'recovery closes the never-published draft');

      // Remove asks once; the address stops working and its receipts go with it.
      await open();
      await row.getByRole('button', { name: 'Remove Uptime', exact: true }).click();
      await page.getByRole('group', { name: 'Remove Uptime?' }).getByRole('button', { name: 'Remove Uptime', exact: true }).click();
      await row.waitFor({ state: 'detached' });
      await receipts.waitFor({ state: 'detached' });
      assert.equal((await send(address, uptimeEvent(monitorId, 'Storefront', `${key}:removed`))).status, 404);
    }
    await context.close();
  } finally { await browser.close(); }
}
