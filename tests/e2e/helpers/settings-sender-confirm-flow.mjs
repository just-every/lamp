import assert from 'node:assert/strict';
import { operatorHydrated } from './operator-hydrated.mjs';

/** A sender edit stays local through ordinary autosaves until its own confirmation. */
export async function settingsSenderConfirmFlow({ page, api }) {
  await operatorHydrated(page);
  const original = (await api('/api/app/page-settings')).settings;
  const sender = page.getByLabel('From email', { exact: true });
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
  const requests = [];
  const observe = request => {
    if (new URL(request.url()).pathname === '/api/app/page-settings' && request.method() === 'PUT') requests.push(request.postDataJSON());
  };
  page.on('request', observe);
  try {
    assert.equal(await confirm.count(), 0, 'an unchanged sender needs no confirmation');
    const nextSender = 'confirmed-status@example.test';
    await sender.fill(nextSender);
    await confirm.waitFor();
    // Give ordinary debounced fields time to save; this sensitive field must stay local.
    await page.waitForTimeout(1500);
    assert.equal(requests.length, 0, 'editing From email sends no settings request');
    assert.equal((await api('/api/app/page-settings')).settings.mailFromAddress, original.mailFromAddress);

    const prefix = '[Confirmed sender]';
    const unrelated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings' && response.request().method() === 'PUT');
    await page.getByLabel('Subject prefix', { exact: true }).fill(prefix);
    assert.equal((await unrelated).status(), 200);
    await page.getByRole('status').filter({ hasText: /^Saved · live$/ }).waitFor();
    const saved = (await api('/api/app/page-settings')).settings;
    assert.equal(saved.emailBranding.subjectPrefix, prefix, 'ordinary notification branding autosaves');
    assert.equal(saved.mailFromAddress, original.mailFromAddress, 'an unrelated autosave leaves the sender unchanged');
    assert.equal(await sender.inputValue(), nextSender, 'autosave preserves the unconfirmed sender draft');
    assert.ok(requests.length > 0);
    assert.ok(requests.every(request => request.mailFromAddress === original.mailFromAddress), 'no unrelated request carries the sender draft');

    const confirmed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings' && response.request().method() === 'PUT' && response.request().postDataJSON().mailFromAddress === nextSender);
    await confirm.click();
    assert.equal((await confirmed).status(), 200);
    await page.getByRole('status').filter({ hasText: /^Saved · live$/ }).waitFor();
    assert.equal((await api('/api/app/page-settings')).settings.mailFromAddress, nextSender);
    assert.equal(await confirm.count(), 0, 'confirmation clears the sender draft');
    await page.reload();
    await operatorHydrated(page);
    assert.equal(await sender.inputValue(), nextSender, 'the confirmed sender survives reload');
    assert.equal(await page.getByLabel('Subject prefix', { exact: true }).inputValue(), prefix);
    assert.equal(await confirm.count(), 0);
  } finally {
    page.off('request', observe);
  }
}
