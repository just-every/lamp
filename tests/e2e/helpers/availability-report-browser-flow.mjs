import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { operatorHydrated } from './operator-hydrated.mjs';

export async function availabilityReportBrowserFlow({ api, post, component, origin, cookie }) {
  // Close a historical interval through the operator API so wall-clock time
  // cannot change the figure between the API read and the browser download.
  const now = new Date(), date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = date.toISOString().slice(0, 7), startsAt = `${month}-15T09:00:00.000Z`, endsAt = `${month}-15T10:00:00.000Z`;
  const target = await component('Customer API availability');
  const created = await post('/api/app/incidents', { title: 'Checkout requests were unavailable', openedAt: startsAt, components: [{ componentId: target.id, state: 'Major outage', relationship: 'Primary' }] });
  assert.equal(created.status, 201, created.text);
  const incidentId = created.body.incident.id, componentId = target.id;
  const draft = { lifecycle: 'Investigating', affectedAudience: 'Customers checking out.', customerImpact: 'Checkout requests were unavailable.', whatStillWorks: 'Browsing remained available.', details: '', nextUpdateAt: endsAt };
  assert.equal((await api(`/api/app/incidents/${incidentId}/draft`, { method: 'PUT', body: JSON.stringify(draft) })).status, 200);
  assert.equal((await post(`/api/app/incidents/${incidentId}/publish`, { channels: [], publishedAt: startsAt })).status, 200);
  assert.equal((await api(`/api/app/incidents/${incidentId}/draft`, { method: 'PUT', body: JSON.stringify({ ...draft, lifecycle: 'Resolved', nextUpdateAt: null }) })).status, 200);
  assert.equal((await post(`/api/app/incidents/${incidentId}/publish`, { channels: [], publishedAt: endsAt })).status, 200);
  const report = (await api(`/api/app/availability-report?component=${componentId}&month=${month}&format=json`)).body;
  assert.ok(report.incidents.some(row => row.id === incidentId));
  const expectedMonthUptime = report.uptime, expectedRecord = created.body.incident.reference;
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })));
    const page = await context.newPage();
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${origin}/app/components`); await operatorHydrated(page);
      const card = page.locator('.availability-report');
      await card.getByLabel('Component').selectOption(componentId);
      await card.getByLabel('Month', { exact: true }).fill(month);
      await inspect('availability-month');
      let downloadEvent = page.waitForEvent('download');
      await card.getByRole('button', { name: 'Download CSV', exact: true }).click();
      let download = await downloadEvent;
      assert.equal(await download.failure(), null);
      const csv = await readDownload(download);
      assert.ok(csv.toString('utf8').includes(expectedMonthUptime));
      assert.ok(csv.toString('utf8').includes(expectedRecord));
      await card.getByLabel('Period').selectOption('quarter');
      await card.getByLabel('Year', { exact: true }).fill(month.slice(0, 4));
      await card.getByLabel('Quarter', { exact: true }).selectOption(String(Math.floor((Number(month.slice(5)) - 1) / 3) + 1));
      await inspect('availability-quarter');
      downloadEvent = page.waitForEvent('download');
      await card.getByRole('button', { name: 'Download PDF', exact: true }).click();
      download = await downloadEvent;
      assert.equal(await download.failure(), null);
      assert.ok((await readDownload(download)).subarray(0, 5).equals(Buffer.from('%PDF-')));
      if (process.env.LAMP_SCREENSHOTS) await download.saveAs(`${process.env.LAMP_SCREENSHOTS}/${width}-availability-quarter.pdf`);
      await card.getByRole('button', { name: 'Download PDF', exact: true }).waitFor({ state: 'visible' });
      await inspect('availability-downloaded');
      async function inspect(name) {
        await card.scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${name} has no overflow`);
        const axe = await new AxeBuilder({ page }).include('.availability-report').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(axe.violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => row.id), []);
        if (process.env.LAMP_SCREENSHOTS) await card.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-${name}.png` });
      }
    }
    await context.close();
  } finally { await browser.close(); }
}
async function readDownload(download) {
  const stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
