import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { devKey } from '../../helpers/dev-key.mjs';
import { operatorHydrated } from './operator-hydrated.mjs';

export async function channelDeletionFlow({ api, post, origin, nativeRequest, runtime }) {
  const since = new Date().toISOString();
  const creator = (await api('/api/app/session')).body.operator;
  const email = 'channel-deleter@example.test';
  const invited = await post('/api/app/operators/invite', { email, displayName: 'Channel removing operator' });
  assert.equal(invited.status, 202, invited.text);
  const entered = await signInAs({ origin, key: devKey, as: email });
  const asDeleter = async (path, init = {}) => {
    const response = await nativeRequest(path, { ...init, cookie: entered.header });
    return { status: response.status, text: await response.text() };
  };
  const deleter = JSON.parse((await asDeleter('/api/app/session')).text).operator;
  assert.notEqual(deleter.id, creator.id);
  const channels = [];
  for (const [kind, url] of [['slack', 'https://hooks.slack.com/services/T0AUDIT/B0DELETE/syntheticAuditSecret'], ['teams', 'https://example.webhook.office.com/webhookb2/syntheticAuditSecret']]) {
    const created = await post('/api/app/channels', { kind, name: `Audit ${kind} deletion`, url, componentIds: [] });
    assert.equal(created.status, 201, created.text);
    channels.push(created.body.channel);
  }
  assert.equal((await nativeRequest(`/api/app/channels/${channels[0].id}`, { method: 'DELETE' })).status, 401);
  const remove = (channel, request = asDeleter) => request(`/api/app/channels/${channel.id}`, { method: 'DELETE' });
  const slack = await remove(channels[0]);
  assert.equal(slack.status, 200, slack.text);
  const selection = new URLSearchParams({ actorId: deleter.id, action: 'deleted', from: since, limit: '100' });
  const entries = async () => JSON.parse((await asDeleter(`/api/app/audit-log?${selection}`)).text).entries;
  const deleted = (await entries()).filter(row => row.entityId === channels[0].id);
  assert.equal(deleted.length, 1, 'TEAM-007 channel deletion must appear in audit JSON');
  assert.equal(deleted[0].actorId, deleter.id, 'record actual deleter, not channel creator');
  assert.equal(deleted[0].entityType, 'channel');
  assert.ok(Date.parse(deleted[0].createdAt) >= Date.parse(since) && Date.parse(deleted[0].createdAt) <= Date.now());
  assert.equal((await remove(channels[0])).status, 404);
  assert.equal((await asDeleter('/api/app/channels/01J00000000000000000000000', { method: 'DELETE' })).status, 404);
  const race = await Promise.all([remove(channels[1]), remove(channels[1], api)]);
  assert.deepEqual(race.map(row => row.status).sort(), [200, 404], 'two competing authenticated deletes have one winner');
  const winner = race[0].status === 200 ? deleter : creator;
  const all = (await api(`/api/app/audit-log?action=deleted&from=${encodeURIComponent(since)}&limit=100`)).body.entries;
  for (const channel of channels) {
    const rows = all.filter(row => row.entityId === channel.id);
    assert.equal(rows.length, 1, 'repeated/nonexistent/competing deletes never fabricate audit success');
    assert.equal(rows[0].actorId, channel.kind === 'slack' ? deleter.id : winner.id);
  }
  assert.ok(!(await api('/api/app/channels')).body.channels.some(row => channels.some(channel => row.id === channel.id)));
  const filtered = await entries();
  const csv = await asDeleter(`/api/app/audit-log?${selection}&format=csv`);
  assert.equal(csv.status, 200);
  assert.equal(csv.text.trimEnd().split('\r\n').length - 1, filtered.length);
  for (const row of filtered) assert.ok(csv.text.includes(`"${row.id}"`) && csv.text.includes(`"${deleter.id}"`) && csv.text.includes(`"${row.entityId}"`) && csv.text.includes(`"${row.createdAt}"`));
  for (const text of [JSON.stringify(all), csv.text, runtime.output]) assert.doesNotMatch(text, /syntheticAuditSecret|sealed_url|sealedUrl|webhookb2|services\/T0AUDIT/);

  // Restart the owned native Worker, retaining its test database, to prove durability.
  await runtime.stop(); await runtime.start();
  assert.deepEqual(await entries(), filtered);
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext();
    await context.addCookies(entered.cookies.map(cookie => ({ ...cookie, url: origin })));
    const page = await context.newPage();
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${origin}/app/settings`); await operatorHydrated(page);
      await page.getByRole('link', { name: 'Your data', exact: true }).click();
      await page.getByRole('button', { name: 'Open audit log', exact: true }).click();
      const panel = page.locator('#audit-log');
      await panel.getByLabel('Operator').selectOption(deleter.id);
      await panel.getByLabel('Audit action').selectOption('deleted');
      await panel.getByRole('button', { name: 'Apply filters', exact: true }).click();
      await panel.locator('tbody').getByText(channels[0].id, { exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.LAMP_SCREENSHOTS) await panel.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-channel-deletion-audit.png` });
    }
    await context.close();
  } finally { await browser.close(); }
  await operatorAlertSettingsBrowserFlow({ origin, cookie: entered.header });
}


/** Private operator alerts are an explicit, durable choice on an existing channel. */
export async function operatorAlertSettingsBrowserFlow({ origin, cookie, diagnostic = () => {} }) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    const openChannels = async () => {
      await operatorHydrated(page);
      await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Slack and Teams', exact: true }).click();
      await page.getByRole('region', { name: 'Slack and Teams', exact: true }).waitFor();
    };
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${origin}/app/settings`); await openChannels();
      const panel = page.getByRole('region', { name: 'Slack and Teams', exact: true });
      const form = panel.locator('form.channel-form');
      const name = `synthetic-lamp-operator-alerts-${width}`;
      await expect(form.getByLabel('Send private operator alerts', { exact: true })).not.toBeChecked();
      await form.getByLabel('Name', { exact: true }).fill(name);
      await form.getByLabel('Incoming webhook URL', { exact: true }).fill(`https://hooks.slack.com/services/synthetic-lamp-1/synthetic-lamp-2/synthetic-lamp-${width}`);
      const createdResponse = page.waitForResponse(response => response.url() === `${origin}/api/app/channels` && response.request().method() === 'POST');
      await form.getByRole('button', { name: 'Add channel', exact: true }).click();
      const created = await createdResponse; assert.equal(created.status(), 201, await created.text());
      const channel = (await created.json()).channel; assert.equal(channel.operatorAlerts, false);
      const row = panel.locator('.channel-list li').filter({ hasText: name });
      const alerts = () => row.getByRole('checkbox', { name: `Operator alerts for ${name}`, exact: true });
      await expect(alerts()).not.toBeChecked();
      const optedIn = page.waitForResponse(response => response.url() === `${origin}/api/app/channels/${channel.id}` && response.request().method() === 'PATCH');
      await alerts().check(); assert.equal((await optedIn).status(), 200); await expect(alerts()).toBeChecked();
      await page.reload(); await openChannels();
      await expect(alerts()).toBeChecked();
      if (process.env.LAMP_SCREENSHOTS) await panel.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-operator-alert-settings-enabled.png` });
      const optedOut = page.waitForResponse(response => response.url() === `${origin}/api/app/channels/${channel.id}` && response.request().method() === 'PATCH');
      await alerts().uncheck(); assert.equal((await optedOut).status(), 200); await expect(alerts()).not.toBeChecked();
      await page.reload(); await openChannels();
      await expect(alerts()).not.toBeChecked();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px operator alert settings does not overflow`);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.filter(violation => ['serious', 'critical'].includes(violation.impact)), [], `${width}px operator alert settings has no serious accessibility findings`);
      assert.deepEqual(errors, [], `${width}px operator alert settings has no hydration or page errors`);
      if (process.env.LAMP_SCREENSHOTS) await panel.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-operator-alert-settings.png` });
      await row.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(row).toHaveCount(0);
      diagnostic(`NOTIFY-016 ${width}px Settings: default off, explicit opt-in retained after reload, opt-out retained after reload`);
    }
    await context.close();
  } finally { await browser.close(); }
}
