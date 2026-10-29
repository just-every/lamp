import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { operatorHydrated } from './operator-hydrated.mjs';
import { cardReadability } from './card-readability.mjs';

const DARK = { background: '#101418', surface: '#1b2128', text: '#eef2f5', link: '#9ecbff', operational: '#5fd38d', degraded: '#f2c14e', partial: '#f59e5b', major: '#ff8a8a', maintenance: '#9db8ff' };
const LABELS = { background: 'Background', surface: 'Surface', text: 'Text', link: 'Links', operational: 'Operational', degraded: 'Degraded performance', partial: 'Partially unavailable', major: 'Major outage', maintenance: 'Maintenance' };

export async function paletteOwnerJourney({ appFetch, appUrl, pageUrl, currentSettings, updateSettings, sessionId, cookieName, diagnostic }) {
  const directory = './test-results/theme-004-005';
  await mkdir(directory, { recursive: true });
  const api = async (path, method, value) => {
    const response = await appFetch(path, { method, body: JSON.stringify(value) });
    const body = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(body)}`);
    return body;
  };
  const original = await currentSettings();
  const fixture = [];
  for (const [index, state] of ['Operational', 'Degraded performance', 'Partially unavailable', 'Major outage', 'Under maintenance'].entries()) {
    const { component } = await api('/api/app/components', 'POST', { name: `Palette ${state} service`, groupId: null, description: 'Customer-facing service for palette readability.', note: 'See https://example.test/support for assistance.', internal: false, displayOrder: 30 + index, region: index % 2 ? 'Europe' : 'North America' });
    await api(`/api/app/components/${component.id}/standing-claim`, 'PUT', { state });
    fixture.push(component);
  }
  const { incident } = await api('/api/app/incidents', 'POST', { title: 'Palette checkout availability', components: [{ componentId: fixture[3].id, state: 'Major outage' }], update: { lifecycle: 'Investigating', affectedAudience: 'Customers placing new orders.', customerImpact: 'Checkout requests are failing.', whatStillWorks: 'Existing orders are safe.', details: 'See https://example.test/support for assistance.', nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() } });
  await api(`/api/app/incidents/${incident.id}/publish`, 'POST', { channels: [] });
  const { incident: resolved } = await api('/api/app/incidents', 'POST', { title: 'Palette reporting recovered', components: [{ componentId: fixture[0].id, state: 'Degraded performance' }], update: { lifecycle: 'Resolved', affectedAudience: 'Customers using reports.', customerImpact: 'Reports are available again.', whatStillWorks: 'All services are available.', details: 'See https://example.test/support for assistance.', nextUpdateAt: null } });
  await api(`/api/app/incidents/${resolved.id}/publish`, 'POST', { channels: [], overrideReason: 'The operator confirmed report requests succeed.' });
  await api('/api/app/maintenance', 'POST', { title: 'Palette database maintenance', affectedAudience: 'Customers using reporting.', customerImpact: 'Reporting may be briefly unavailable.', startsAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: new Date(Date.now() + 7_200_000).toISOString(), componentIds: [fixture[4].id], autoStart: false, autoComplete: false });
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: cookieName, value: sessionId, url: appUrl }]);
    const settings = await context.newPage();
    const publicPage = await context.newPage();
    const themeCard = settings.locator('section[aria-labelledby="theme-title"]');
    const openSettings = async () => {
      await settings.goto(`${appUrl}/app/settings`, { waitUntil: 'domcontentloaded' });
      await operatorHydrated(settings);
      await settings.waitForFunction(() => !document.querySelector('.settings-page')?.inert);
      await settings.locator('section[aria-labelledby="theme-title"] details').filter({ has: settings.locator(':scope > summary', { hasText: 'Colours' }) }).locator('summary').click();
    };
    const toggle = settings.getByLabel('Use a custom colour palette', { exact: true });
    const savedEdit = async edit => {
      const response = settings.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings' && response.request().method() === 'PUT');
      await edit();
      const saved = await response;
      assert.equal(saved.status(), 200, await saved.text());
      await expect(settings.getByRole('status').filter({ hasText: /^Saved · live$/ })).toBeVisible();
    };
    const css = async () => {
      const current = await currentSettings();
      return (await fetch(`${pageUrl}/assets/${current.template === 'default' ? 'status-page' : 'template'}.css`)).text();
    };
    // The legacy null representation still reads with a disabled palette. A
    // pre-upgrade payload with colours and no enabled field enables them.
    const legacy = { ...original.theme, palette: null };
    delete legacy.paletteEnabled;
    assert.ok(original.theme.palette, 'the preceding branded journey saved a real owner palette');
    await updateSettings({ theme: { ...legacy, palette: original.theme.palette } });
    assert.equal((await currentSettings()).theme.paletteEnabled, true, 'legacy stored colours infer an enabled palette');
    assert.deepEqual((await currentSettings()).theme.palette, original.theme.palette);
    await updateSettings({ theme: legacy, template: 'default' });
    assert.equal((await currentSettings()).theme.paletteEnabled, false);
    const defaultCss = await css();
    await openSettings();
    await savedEdit(() => toggle.check());
    // Every field is typed in Settings. Intermediate invalid combinations are
    // coalesced by the real autosave queue; only the complete palette may land.
    for (const [key, label] of Object.entries(LABELS)) await settings.getByRole('textbox', { name: `${label} hex colour`, exact: true }).fill(DARK[key]);
    await expect.poll(async () => (await currentSettings()).theme.palette).toEqual(DARK);
    await expect(settings.getByRole('status').filter({ hasText: /^Saved · live$/ })).toBeVisible();
    assert.equal((await currentSettings()).theme.paletteEnabled, true);
    for (const width of [1440, 390]) {
      await settings.setViewportSize({ width, height: 1000 });
      await settings.locator('#theme-title').scrollIntoViewIfNeeded();
      await themeCard.screenshot({ path: `${directory}/palette-on-${width}.png` });
    }
    let dialogs = 0;
    settings.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
    await savedEdit(() => toggle.uncheck());
    assert.deepEqual((await currentSettings()).theme.palette, DARK, 'unticking retains all nine owner colours');
    assert.equal((await currentSettings()).theme.paletteEnabled, false);
    assert.equal(await css(), defaultCss, 'disabled palette publishes exactly the default stylesheet');
    await openSettings();
    await expect(toggle).not.toBeChecked();
    assert.deepEqual((await currentSettings()).theme.palette, DARK, 'reloading retains all nine owner colours');
    for (const width of [1440, 390]) {
      await settings.setViewportSize({ width, height: 1000 });
      await settings.locator('#theme-title').scrollIntoViewIfNeeded();
      await themeCard.screenshot({ path: `${directory}/palette-off-${width}.png` });
    }
    const layout = settings.locator('section[aria-labelledby="theme-title"] details').filter({ has: settings.locator(':scope > summary', { hasText: 'Layout and history' }) });
    await layout.locator('summary').click();
    await savedEdit(() => settings.getByLabel(/^History days/).fill('21'));
    assert.deepEqual((await currentSettings()).theme.palette, DARK, 'other theme saves while disabled retain all nine colours');
    assert.equal((await currentSettings()).theme.paletteEnabled, false);
    await updateSettings({ theme: { historyDays: 22 } });
    assert.deepEqual((await currentSettings()).theme.palette, DARK, 'a partial operator theme save preserves disabled colours');
    await updateSettings({ theme: { palette: null } });
    assert.deepEqual((await currentSettings()).theme.palette, DARK, 'a legacy null operator save cannot erase disabled colours');
    await updateSettings({ theme: { paletteEnabled: false, palette: original.theme.palette } });
    assert.deepEqual((await currentSettings()).theme.palette, DARK, 'a stale disabled operator save cannot replace owner colours');
    await openSettings();
    await savedEdit(() => toggle.check());
    assert.deepEqual((await currentSettings()).theme.palette, DARK, 're-ticking restores exactly the owner palette');
    for (const [key, label] of Object.entries(LABELS)) await expect(settings.getByRole('textbox', { name: `${label} hex colour`, exact: true })).toHaveValue(DARK[key]);
    assert.equal(dialogs, 0, 'non-destructive toggles ask no confirmation');
    await publicPage.goto(pageUrl, { waitUntil: 'networkidle' });
    assert.equal(await publicPage.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(16, 20, 24)', 're-ticking publishes the owner background');
    const tokens = { background: '--paper', surface: '--card', text: '--ink', link: '--theme-link', operational: '--ok', degraded: '--degraded', partial: '--cell-partial', major: '--down', maintenance: '--maint' };
    for (const [key, token] of Object.entries(tokens)) assert.equal(await publicPage.locator('body').evaluate((element, token) => getComputedStyle(element).getPropertyValue(token).trim(), token), DARK[key], `re-ticking publishes the exact ${key} colour`);
    const stored = await currentSettings();
    const before = await fetch(pageUrl);
    const beforeHtml = await before.text();
    const beforeVersion = before.headers.get('etag');
    assert.ok(beforeVersion, 'the retained snapshot has a generation validator');
    const beforeCss = await css();
    const refusal = settings.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings' && response.request().method() === 'PUT');
    await settings.getByRole('textbox', { name: 'Major outage hex colour', exact: true }).fill(DARK.surface);
    const refused = await refusal;
    assert.equal(refused.status(), 400);
    const message = (await refused.json()).error;
    assert.match(message, /card.*major.*contrast.*4\.5:1/i);
    await expect(settings.getByRole('alert').filter({ hasText: message })).toBeVisible();
    await expect(settings.getByRole('textbox', { name: 'Major outage hex colour', exact: true })).toHaveValue(DARK.surface);
    assert.deepEqual(await currentSettings(), stored, 'refused card contrast changes no stored settings');
    const after = await fetch(pageUrl);
    assert.equal(after.headers.get('etag'), beforeVersion, 'refusal creates no snapshot');
    assert.equal(await after.text(), beforeHtml, 'refusal leaves the published document unchanged');
    assert.equal(await css(), beforeCss, 'refusal leaves published colours unchanged');
    await savedEdit(() => settings.getByRole('textbox', { name: 'Major outage hex colour', exact: true }).fill(DARK.major));
    for (const template of ['default', 'calm', 'uptime', 'regions']) {
      await updateSettings({ template });
      for (const width of [1440, 390]) {
        await publicPage.setViewportSize({ width, height: 1000 });
        await publicPage.goto(pageUrl, { waitUntil: 'networkidle' });
        await expect(publicPage.getByText('Palette checkout availability', { exact: true }).first()).toBeVisible();
        await expect(publicPage.getByText('Palette database maintenance', { exact: true }).first()).toBeVisible();
        await expect(publicPage.getByText('Palette reporting recovered', { exact: true }).first()).toBeVisible();
        await cardReadability(publicPage, { directory, name: `dark-${template}-${width}`, dark: true });
      }
    }
    for (const width of [1440, 390]) {
      await settings.setViewportSize({ width, height: 1000 });
      await settings.goto(`${appUrl}/app`);
      await operatorHydrated(settings);
      await settings.locator('.operator-shell[data-palette-readable]').waitFor();
      await expect(settings.getByRole('region', { name: 'Active incidents', exact: true })).toContainText('Palette checkout availability');
      await expect(settings.getByText('Palette database maintenance', { exact: true })).toBeVisible();
      await cardReadability(settings, { directory, name: `dashboard-${width}` });
    }
    diagnostic('THEME-004 THEME-005: Settings keeps nine colours through disable, reload, other save and enable; named-card refusal preserves the snapshot; four dark layouts and the dashboard have zero Axe contrast violations at 1440 and 390.');
    await context.close();
  } finally {
    await browser.close();
    await updateSettings({ theme: { ...original.theme, paletteEnabled: false }, template: original.template });
  }
}
