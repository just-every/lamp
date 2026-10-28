import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { sessionCookieName } from '../../helpers/session-cookie.mjs';
import { operatorHydrated } from './operator-hydrated.mjs';

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const rgb = hex => `rgb(${hex.slice(1).match(/../g).map(value => parseInt(value, 16)).join(', ')})`;

/** One-width assertions; the phone pass records the same changed screens for independent review. */
export async function themeBrowserFlow({ appFetch, appUrl, pageUrl, sessionId, fontBytes, imageBytes, diagnostic }) {
  const proof = process.env.LAMP_THEME_SCREENSHOTS;
  if (proof) await mkdir(proof, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === 'linux' ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: sessionCookieName(appUrl), value: sessionId, url: appUrl }]);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.name));
    await page.goto(appUrl + '/app/settings');
    await operatorHydrated(page);
    const controls = page.getByRole('region', { name: 'Theme', exact: true });
    const saved = predicate => page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings' && response.request().method() === 'PUT' && predicate(response.request().postDataJSON().theme));
    const disable = saved(theme => theme === null);
    await controls.getByLabel('Use a custom theme', { exact: true }).uncheck();
    assert.equal((await disable).status(), 200);
    const enable = saved(theme => theme !== null);
    await controls.getByLabel('Use a custom theme', { exact: true }).check();
    assert.equal((await enable).status(), 200);

    diagnostic('THEME-001 — the native Settings controls change every theme field and survive reload');
    const palette = { background: '#edf2f5', surface: '#ffffff', text: '#162736', link: '#194d6b', states: { Operational: '#1b4d31', 'Degraded performance': '#644100', 'Partially unavailable': '#6a3500', 'Major outage': '#7d2430', 'Under maintenance': '#25426f' } };
    for (const key of ['background', 'surface', 'text', 'link']) await controls.getByLabel(`${key[0].toUpperCase()}${key.slice(1)} colour`, { exact: true }).fill(palette[key]);
    for (const [state, color] of Object.entries(palette.states)) await controls.getByLabel(`${state} colour`, { exact: true }).fill(color);
    const fontUpload = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings/theme-assets' && response.request().method() === 'POST');
    await controls.getByLabel('Upload WOFF2 font', { exact: true }).setInputFiles({ name: 'owner-font.woff2', mimeType: 'font/woff2', buffer: fontBytes });
    const fontUploadResponse = await fontUpload;
    assert.equal(fontUploadResponse.status(), 200);
    const fontAsset = (await fontUploadResponse.json()).asset.path;
    await controls.getByLabel('Page font', { exact: true }).selectOption('inter');
    const fontSaved = saved(theme => theme?.font === 'uploaded' && theme.fontAsset === fontAsset);
    await controls.getByLabel('Page font', { exact: true }).selectOption('uploaded');
    assert.equal((await fontSaved).status(), 200);
    const imageUpload = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings/theme-assets' && response.request().method() === 'POST');
    await controls.getByLabel('Upload header image', { exact: true }).setInputFiles({ name: 'owner-header.png', mimeType: 'image/png', buffer: imageBytes });
    const imageUploadResponse = await imageUpload;
    assert.equal(imageUploadResponse.status(), 200);
    const headerImage = (await imageUploadResponse.json()).asset.path;
    await controls.getByRole('button', { name: 'Add header link', exact: true }).click();
    await controls.getByLabel('Header link 1 label', { exact: true }).fill('Atlas customer home');
    await controls.getByLabel('Header link 1 address', { exact: true }).fill('https://www.atlascloud.example/customer');
    await controls.getByRole('button', { name: 'Add footer link', exact: true }).click();
    await controls.getByLabel('Footer link 1 label', { exact: true }).fill('Read our service history');
    await controls.getByLabel('Footer link 1 address', { exact: true }).fill('/history');
    const headerHtml = `<p class="owner-header"><strong>Atlas customer status</strong><br><span>Updates from the operations team.</span><img src="${headerImage}" alt="Atlas header"></p>`;
    const footerHtml = '<nav class="owner-footer"><a href="https://help.atlascloud.example/">Contact the Atlas team</a></nav>';
    await controls.getByLabel('Header HTML', { exact: true }).fill(headerHtml);
    await controls.getByLabel('Footer HTML', { exact: true }).fill(footerHtml);
    await controls.getByLabel('Expand component groups initially', { exact: true }).uncheck();
    await controls.getByLabel('History days', { exact: true }).fill('21');
    await controls.getByLabel('Show uptime for Web application', { exact: true }).uncheck();
    const css = '.owner-header { padding-block: 11px; } h1 { letter-spacing: .045em; }';
    const finalSaved = saved(theme => theme?.css === css && theme.headerImage === headerImage && theme.fontAsset === fontAsset && theme.historyDays === 21 && theme.headerHtml === headerHtml);
    await controls.getByLabel('Page CSS', { exact: true }).fill(css);
    assert.equal((await finalSaved).status(), 200);
    await page.getByRole('status').filter({ hasText: /^Saved · live$/ }).waitFor();
    const result = await appFetch('/api/app/page-settings');
    assert.equal(result.status, 200);
    const actualTheme = (await result.json()).settings.theme;
    assert.deepEqual(actualTheme, { palette, font: 'uploaded', fontAsset, headerImage, headerLinks: [{ label: 'Atlas customer home', href: 'https://www.atlascloud.example/customer' }], footerLinks: [{ label: 'Read our service history', href: '/history' }], headerHtml, footerHtml, groupsExpanded: false, hiddenUptimeComponents: ['01J00000000000000000000010'], historyDays: 21, css });
    await page.reload(); await operatorHydrated(page);
    assert.equal(await controls.getByLabel('Page CSS', { exact: true }).inputValue(), css);
    assert.equal(await controls.getByLabel('Background colour', { exact: true }).inputValue(), palette.background);
    assert.equal(await controls.getByLabel('Page font', { exact: true }).inputValue(), 'uploaded');
    assert.equal(await controls.getByLabel('History days', { exact: true }).inputValue(), '21');
    assert.equal(await controls.getByLabel('Expand component groups initially', { exact: true }).isChecked(), false);
    assert.equal(await controls.getByLabel('Show uptime for Web application', { exact: true }).isChecked(), false);
    assert.equal(await controls.getByLabel('Header HTML', { exact: true }).inputValue(), headerHtml);
    const settingsAudit = await new AxeBuilder({ page }).include('.theme-settings').withTags(tags).analyze();
    assert.deepEqual(settingsAudit.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => item.id), [], 'theme Settings accessibility');
    assert.ok(await controls.evaluate(element => [...element.querySelectorAll('label,input,textarea,select,button,p,h2,h3,legend')].every(node => parseFloat(getComputedStyle(node).fontSize) >= 13)), 'theme controls use text at least 13px');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'theme Settings has no horizontal overflow');
    assert.deepEqual(pageErrors, [], 'theme Settings has no hydration/runtime errors');
    if (proof) await controls.screenshot({ path: `${proof}/theme-settings-1440.png` });

    const publicContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, javaScriptEnabled: false });
    const publicPage = await publicContext.newPage();
    const externalRequests = [];
    publicPage.on('request', request => { if (new URL(request.url()).origin !== new URL(pageUrl).origin) externalRequests.push(request.url()); });
    await publicPage.goto(pageUrl + '/');
    assert.equal(await publicPage.getByRole('link', { name: 'Atlas customer home', exact: true }).getAttribute('href'), 'https://www.atlascloud.example/customer');
    assert.equal(await publicPage.getByRole('link', { name: 'Read our service history', exact: true }).getAttribute('href'), '/history');
    assert.equal(await publicPage.locator('.theme-header-html').innerText(), 'Atlas customer status\nUpdates from the operations team.');
    assert.equal(await publicPage.locator('.theme-footer-html').innerText(), 'Contact the Atlas team');
    assert.equal(await publicPage.locator('.theme-header-image img').getAttribute('src'), headerImage);
    assert.equal(await publicPage.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), rgb(palette.background));
    assert.equal(await publicPage.locator('body').evaluate(element => getComputedStyle(element).color), rgb(palette.text));
    assert.equal(await publicPage.locator('.theme-header-links a').evaluate(element => getComputedStyle(element).color), rgb(palette.link));
    assert.equal(await publicPage.locator('.theme-component-group').first().evaluate(element => getComputedStyle(element).backgroundColor), rgb(palette.surface));
    assert.equal(await publicPage.locator('.theme-component-group[open]').count(), 0, 'native groups are collapsed before script');
    assert.equal(await publicPage.locator('[data-component-id="01J00000000000000000000010"] .uptime-mark').count(), 0, 'the selected component omits uptime in the static DOM');
    assert.match(await publicPage.locator('body').innerText(), /last 21 days/);
    const firstGroup = publicPage.locator('.theme-component-group').first();
    await firstGroup.locator('summary').click();
    assert.equal(await firstGroup.getAttribute('open'), '', 'native groups still expand with JavaScript disabled');
    assert.equal(await publicPage.locator('[data-component-id="01J00000000000000000000020"] .uptime-mark').count(), 21, 'the visible bar contains the configured 21 daily marks');
    const appliedFont = await publicPage.locator('body').evaluate(async element => { await document.fonts.ready; return { family: getComputedStyle(element).fontFamily, loaded: [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family) }; });
    assert.match(appliedFont.family, /Lamp Owner/);
    assert.ok(appliedFont.loaded.some(name => /Lamp Owner/.test(name)), 'uploaded WOFF2 is used by the public page');
    assert.deepEqual(externalRequests, [], 'the themed page requests no external resources');
    assert.equal(await publicPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'custom theme has no horizontal overflow');
    if (proof) await publicPage.screenshot({ path: `${proof}/theme-snapshot-1440.png`, fullPage: true });
    await publicContext.close();

    if (proof) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(appUrl + '/app/settings'); await operatorHydrated(page);
      await controls.screenshot({ path: `${proof}/theme-settings-390.png` });
      const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
      const phone = await phoneContext.newPage();
      await phone.goto(pageUrl + '/');
      await phone.screenshot({ path: `${proof}/theme-snapshot-390.png`, fullPage: true });
      await phoneContext.close();
    }
    await context.close();
  } finally { await browser.close(); }
}
