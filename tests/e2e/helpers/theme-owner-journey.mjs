import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { themeFlow } from './theme-flow.mjs';
import { themeSettings } from './theme-fixture.mjs';

export async function themeOwnerJourney({ appFetch, appUrl, pageUrl, sessionId, cookieName, diagnostic }) {
  const json = async (path, method = 'GET', value) => {
    const response = await appFetch(path, { method, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    assert.ok(response.ok, `${method} ${path}: ${await response.clone().text()}`);
    return response.status === 204 ? null : response.json();
  };
  const currentSettings = async () => (await json('/api/app/page-settings')).settings;
  const updateSettings = async patch => {
    const current = await currentSettings();
    return (await json('/api/app/page-settings', 'PUT', {
      pageName: current.pageName, tagline: current.tagline, accentColor: current.accentColor,
      timezone: current.timezone, hostname: current.hostname, footerCreditEnabled: current.footerCreditEnabled,
      widgetAllowedOrigins: current.widgetAllowedOrigins, mailFromAddress: current.mailFromAddress, ...patch,
    })).settings;
  };
  const group = (await json('/api/app/component-groups', 'POST', { name: 'Core services', displayOrder: 20 })).group;
  for (const [index, name] of ['Web application', 'API gateway', 'Customer portal'].entries()) {
    const component = (await json('/api/app/components', 'POST', { name, groupId: group.id, description: `Customer-facing ${name}.`, note: '', internal: false, displayOrder: index })).component;
    await json(`/api/app/components/${component.id}/standing-claim`, 'PUT', { state: 'Operational' });
  }
  await themeFlow({ appFetch, fetch, appUrl, pageUrl, currentSettings, updateSettings, sessionId, cookieName, diagnostic });

  const limits = JSON.parse(await readFile('seed.json', 'utf8')).limits;
  const before = await json('/api/app/components/bulk');
  const catalogue = { ...before.catalogue, components: before.catalogue.components.map(row => ({ ...row, internal: false, onlyShowIfDegraded: false })) };
  for (let index = catalogue.components.length; index < limits.components.value; index++) {
    catalogue.components.push({
      id: String(index).padStart(26, '0'), groupId: group.id, name: `Capacity service ${index}`,
      description: `Customer-facing service ${index}. ${'Service information. '.repeat(10)}`,
      note: `Current customer impact for service ${index}. ${'Requests remain available. '.repeat(7)}`,
      internal: false, displayOrder: 100 + index, region: index % 2 ? 'North America' : 'Europe',
      onlyShowIfDegraded: false, uptimeStartDate: null,
    });
  }
  const review = await json('/api/app/components/bulk/preview', 'POST', { catalogue, revision: before.revision });
  await json('/api/app/components/bulk/apply', 'POST', { catalogue: review.catalogue, revision: review.revision, reviewToken: review.reviewToken });
  const current = await currentSettings();
  await updateSettings({ theme: { ...themeSettings(current.theme), font: 'uploaded', headerImage: true, historyDays: 90, groupsCollapsed: false, hiddenUptimeComponentIds: [] } });
  const published = [], cursors = new Set();
  let cursor;
  do {
    const url = new URL('/api/public/v1/components', pageUrl);
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const page = await response.json();
    published.push(...page.data);
    cursor = page.nextCursor;
    assert.ok(!cursor || !cursors.has(cursor), 'component pagination advances');
    cursors.add(cursor);
  } while (cursor);
  assert.equal(published.length, limits.components.value, 'every component is public in the transfer-budget fixture');
  assert.equal(new Set(published.map(row => row.id)).size, published.length);
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--use-mock-keychain', '--password-store=basic', '--no-sandbox'] });
  try {
    for (const template of ['default', 'calm', 'uptime', 'regions']) {
      await updateSettings({ template });
      const response = await fetch(`${pageUrl}/`);
      assert.equal(response.status, 200);
      const html = await response.text();
      const bytes = gzipSync(Buffer.from(html)).byteLength;
      assert.ok(bytes <= limits.snapshotMaxBytesGzipped.value, `${template} themed page exceeds the transfer budget: ${bytes}`);
      assert.ok(html.includes('Service updates from the Atlas team.'));
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      const resources = new Set(), foreign = new Set();
      page.on('request', request => {
        const url = new URL(request.url());
        if (request.resourceType() === 'document' || !['http:', 'https:'].includes(url.protocol)) return;
        if (url.origin === pageUrl) resources.add(url.pathname);
        else foreign.add(url.origin);
      });
      await page.goto(pageUrl, { waitUntil: 'networkidle' });
      assert.ok(resources.size <= 4, `${template} exceeds the four-request budget: ${[...resources]}`);
      assert.equal(foreign.size, 0, 'the full-capacity theme makes no third-party request');
      await context.close();
      diagnostic(`${template}: ${limits.components.value} public components with the saved palette, uploaded font, banner and links: ${bytes} bytes gzipped, ${resources.size} own-origin requests`);
    }
  } finally { await browser.close(); }
}
