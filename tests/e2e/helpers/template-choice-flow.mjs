import assert from 'node:assert/strict';
import { operatorHydrated } from './operator-hydrated.mjs';

const NEEDS_TWO_REGIONS = /at least two regions/i;

async function templateCard(page, origin) {
  await page.goto(`${origin}/app/settings`);
  await operatorHydrated(page);
  return { card: page.locator('section', { has: page.locator('#template-title') }), select: page.getByRole('combobox', { name: /^Template/ }) };
}

async function choose(page, origin, api, template) {
  const { select } = await templateCard(page, origin);
  await select.selectOption(template);
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings' && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  assert.equal((await saved).status(), 200);
  assert.equal((await api('/api/app/page-settings')).settings.template, template);
}

// The public page as a visitor loads it right after the save: its layout, one heading, a subscribe form that posts
// a labelled email address, and no sideways scrolling at desktop or phone width.
async function visit(page, publicOrigin, expected) {
  const visitor = await page.context().newPage();
  await visitor.goto(`${publicOrigin}/`);
  assert.equal(await visitor.locator('body').getAttribute('data-template'), expected === 'default' ? null : expected, 'save has already published the chosen layout');
  await visitor.getByRole('heading', { level: 1 }).waitFor();
  const forms = visitor.locator('form[action="/subscribe"][method="post"]');
  assert.ok(await forms.count() >= 1, 'the page keeps its subscribe form');
  for (const form of await forms.all()) await form.getByLabel('Email address', { exact: true }).waitFor({ state: 'attached' });
  for (const width of [1440, 390]) {
    await visitor.setViewportSize({ width, height: 900 });
    assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  return visitor;
}

/** Settings offers Regions map only once public components are in two regions, says why, and the API agrees. */
export async function regionsUnavailable({ page, origin, api }) {
  const { card, select } = await templateCard(page, origin);
  assert.equal(await select.locator('option[value="regions"]').evaluate(option => option.disabled), true);
  assert.match(await card.locator('#template-regions-reason').innerText(), NEEDS_TWO_REGIONS);
  const { id, logoKey, logoContentType, feedId, createdAt, updatedAt, mailIdentityEditable, regionsAvailable, ...settings } = (await api('/api/app/page-settings')).settings;
  const refused = await page.evaluate(async settings => {
    const response = await fetch('/api/app/page-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...settings, template: 'regions' }) });
    return { status: response.status, body: await response.json() };
  }, settings);
  assert.equal(refused.status, 400, 'a Regions choice without two regions is refused by the API too');
  assert.match(refused.body.error, NEEDS_TWO_REGIONS);
}

/** Calm headline, Uptime-history-led and House style publish on save and survive a reload of Settings; Default
 *  returns. This install has no Workers AI binding, so House style shows Calm headline, and the page's foot and the
 *  Template card both name that reason. */
export async function templateChoiceFlow({ page, origin, publicOrigin, api }) {
  await regionsUnavailable({ page, origin, api });
  for (const [template, shows] of [['calm', 'calm'], ['uptime', 'uptime'], ['house', 'calm'], ['default', 'default']]) {
    await choose(page, origin, api, template);
    const visitor = await visit(page, publicOrigin, shows);
    if (template === 'house') assert.equal(await visitor.locator('[data-house-style]').getAttribute('data-reason'), 'not-connected', 'the page says why it shows Calm headline');
    await visitor.close();
    const { card, select } = await templateCard(page, origin);
    assert.equal(await select.inputValue(), template, 'the selected template survives reload');
    if (template === 'house') await card.locator('[role="status"][data-reason="not-connected"]').waitFor();
  }
}

/** With two regions the map labels each region with its state and filters the components in place. When a region
 *  goes, the public page quietly shows Calm headline and only Settings explains why. */
export async function regionsMapFlow({ page, origin, publicOrigin, api, dropRegion }) {
  await choose(page, origin, api, 'regions');
  const visitor = await visit(page, publicOrigin, 'regions');
  await visitor.setViewportSize({ width: 1440, height: 900 });
  await visitor.locator('.rg-map').getByRole('link', { name: /^Europe Operational/ }).waitFor();
  const filters = visitor.getByRole('navigation', { name: 'Filter components by region' });
  await filters.getByRole('link', { name: 'Europe' }).click();
  assert.deepEqual(await visitor.locator('.rg-row:visible .rg-name-text').allInnerTexts(), ['API']);
  await filters.getByRole('link', { name: 'All regions' }).click();
  assert.equal(await visitor.locator('.rg-row[hidden]').count(), 0);
  await visitor.close();
  await dropRegion();
  const quiet = await visit(page, publicOrigin, 'calm');
  assert.doesNotMatch(await quiet.locator('main').innerText(), /region/i, 'the public page never explains a missing map');
  await quiet.close();
  const { card } = await templateCard(page, origin);
  assert.match(await card.getByRole('status').innerText(), /Showing Calm headline/);
  assert.match(await card.getByRole('status').innerText(), NEEDS_TWO_REGIONS);
  await choose(page, origin, api, 'default');
}
