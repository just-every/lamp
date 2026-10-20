import assert from 'node:assert/strict';
import { operatorHydrated } from './operator-hydrated.mjs';

export async function templateChoiceFlow({ page, origin, publicOrigin, api, withRegions = false }) {
  await page.goto(`${origin}/app/settings`);
  await operatorHydrated(page);
  const select = page.getByRole('combobox', { name: /^Template/ });
  assert.equal(await select.locator('option[value="regions"]').isDisabled(), !withRegions);
  if (!withRegions) {
    const settings = (await api('/api/app/page-settings')).settings;
    const refused = await page.evaluate(async settings => {
      const response = await fetch('/api/app/page-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...settings, template: 'regions' }) });
      return { status: response.status, body: await response.json() };
    }, settings);
    assert.equal(refused.status, 400, 'a region-less Regions choice is refused by the API too');
    assert.match(refused.body.error, /no visible component has a region/i);
  }
  const publicPage = await page.context().newPage();
  try {
    for (const template of withRegions ? ['regions', 'default'] : ['calm', 'uptime', 'default']) {
      await select.selectOption(template);
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings' && response.request().method() === 'PUT');
      await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      assert.equal((await saved).status(), 200);
      assert.equal((await api('/api/app/page-settings')).settings.template, template);
      await publicPage.goto(`${publicOrigin}/`);
      assert.equal(await publicPage.locator('body').getAttribute('data-template'), template === 'default' ? null : template, 'save has already published the chosen layout');
      await publicPage.getByRole('heading', { level: 1 }).waitFor();
      assert.equal(await publicPage.locator('form[action="/subscribe"] input[type="email"]').count(), 1);
      if (template === 'regions') {
        await publicPage.getByRole('navigation', { name: 'Filter components by region' }).getByRole('link', { name: /^Europe/ }).click();
        assert.equal(await publicPage.locator('[data-region-section]:visible').count(), 1);
        await publicPage.getByRole('navigation', { name: 'Filter components by region' }).getByRole('link', { name: 'All regions' }).click();
        assert.equal(await publicPage.locator('[data-region-section][hidden]').count(), 0);
      }
      for (const width of [1440, 390]) {
        await publicPage.setViewportSize({ width, height: 900 });
        assert.equal(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      await page.reload();
      await operatorHydrated(page);
      assert.equal(await select.inputValue(), template, 'the selected template survives reload');
    }
  } finally { await publicPage.close(); }
}
