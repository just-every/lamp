import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { AxeBuilder } from '@axe-core/playwright';
import { operatorHydrated } from './operator-hydrated.mjs';
import { incidentComposer } from './incident-composer.mjs';

export async function emailBrandingBrowserFlow({ page, appUrl, pageUrl, appFetch }) {
  page.setDefaultTimeout(15_000);
  const proof = process.env.LAMP_SCREENSHOTS;
  if (proof) await mkdir(proof, { recursive: true });
  const componentResponse = await appFetch('/api/app/components', { method: 'POST', body: JSON.stringify({ groupId: null, name: 'Acme checkout API', description: 'Card payments and order confirmation.', internal: false, displayOrder: 10, note: '' }) });
  assert.equal(componentResponse.status, 201);
  const componentId = (await componentResponse.json()).component.id;
  const created = await appFetch('/api/app/incidents', { method: 'POST', body: JSON.stringify({ title: 'Card authorization delays', components: [{ componentId, state: 'Degraded performance', relationship: 'Primary' }] }) });
  assert.equal(created.status, 201);
  const incident = (await created.json()).incident;
  const previewStatus = await appFetch('/api/app/page-settings/embed-preview');
  const publishedStatus = await page.request.get(`${pageUrl}/api/public/status`);
  assert.equal(previewStatus.status, 200);
  assert.equal(publishedStatus.status(), 200);
  assert.deepEqual(await previewStatus.json(), await publishedStatus.json(), 'Settings previews the actual published status');
  async function inspect(name, selector) {
    const width = page.viewportSize().width;
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} fits ${width}px`);
    const result = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
    assert.deepEqual(result.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => v.id), [], `${name} accessibility`);
    await page.locator(selector).scrollIntoViewIfNeeded();
    if (proof) await page.screenshot({ path: `${proof}/${width}-email-${name}.png`, fullPage: false });
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`${appUrl}/app/settings`);
    await operatorHydrated(page);
    const uploaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings/logo' && response.request().method() === 'POST');
    await page.getByText('Upload a different logo', { exact: true }).click();
    await page.getByLabel('Logo file').setInputFiles('src/site/lamp/art/lamp-badge-touch.png');
    await page.getByRole('button', { name: 'Upload logo', exact: true }).click();
    assert.equal((await uploaded).status(), 200);
    await page.getByText('Logo saved and live.', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Notifications', exact: true }).click();
    await page.getByLabel('Sender display name', { exact: true }).fill('Acme status');
    await page.getByLabel('Reply-to address', { exact: true }).fill('support@acme.example');
    await page.getByLabel('Subject prefix', { exact: true }).fill('[Acme status]');
    await page.getByRole('textbox', { name: /^Email header/ }).fill('Service updates from Acme.');
    await page.getByRole('textbox', { name: /^Email footer/ }).fill('Acme, 100 Market Street, San Francisco, CA 94105');
    await page.getByRole('checkbox', { name: 'Use the uploaded page logo in email' }).check();
    await inspect('settings', '.email-branding-settings');
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings' && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    assert.equal((await saved).status(), 200);
    await page.getByText('Saved and live.', { exact: true }).waitFor();
    await page.reload(); await operatorHydrated(page);
    assert.equal(await page.getByLabel('Subject prefix', { exact: true }).inputValue(), '[Acme status]', 'the reload keeps the Notifications tab');
    await page.goto(`${appUrl}/app/incidents/${incident.id}`); await operatorHydrated(page);
    await incidentComposer(page).audience.fill('Customers paying by card in the US.');
    await incidentComposer(page).impact.fill('Authorizations may take longer than usual.');
    await page.getByLabel('Next update date and time').fill('2027-09-08T14:00');
    await page.getByText('Draft saved', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Email', exact: true }).click();
    const preview = page.locator('.preview-panel');
    await preview.getByText('support@acme.example', { exact: true }).waitFor();
    await preview.getByText('Service updates from Acme.', { exact: true }).waitFor();
    await preview.getByText('Acme, 100 Market Street, San Francisco, CA 94105', { exact: true }).waitFor();
    assert.ok((await preview.locator('h3').textContent()).startsWith('[Acme status]'));
    const image = preview.locator('img');
    assert.equal(await image.getAttribute('src'), `${pageUrl}/assets/logo`);
    assert.equal(await image.getAttribute('alt'), 'Atlas Cloud Status');
    await image.evaluate(element => element.decode());
    await inspect('preview', '.preview-panel .preview-card');
  }
}
