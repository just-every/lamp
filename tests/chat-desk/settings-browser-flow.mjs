import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { runtime } from './runtime.mjs';
import { chatSigningKey, chatTransports } from './flow.mjs';
import { operatorHydrated } from '../e2e/helpers/operator-hydrated.mjs';

/** Actual built Settings and native storage; only Bot Framework's key service
 * is synthetic. Verify asserts at 1440; the candidate also records 390 proof. */
export async function chatLinksSettingsFlow({ browser, t, width = 1440 }) {
  const r = await runtime(t, [chatSigningKey], { browser: true });
  let context;
  try {
    const senders = chatTransports(() => r);
    context = await browser.newContext({ viewport: { width, height: 1000 } });
    const equals = r.cookie.indexOf('=');
    await context.addCookies([{ name: r.cookie.slice(0, equals), value: r.cookie.slice(equals + 1), url: r.origin }]);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/hydration|did not match|server rendered/i.test(message.text())) errors.push(message.text()); });
    const apiLinks = async () => {
      const response = await r.call('/api/app/chat-links');
      assert.equal(response.status, 200);
      return response.body.links;
    };
    const storedLinks = async () => (await r.db.prepare('SELECT id,operator_id,transport,tenant,subject FROM chat_links ORDER BY transport').all()).results;
    const session = await r.call('/api/app/session');
    assert.equal(session.status, 200);
    assert.equal(session.body.operator.id, r.operator, 'the browser session belongs to the seeded operator');
    await page.goto(`${r.origin}/app/settings`);
    await operatorHydrated(page);
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Connected tools', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Chat links', exact: true });
    await expect(panel.getByText('No chat identities linked.', { exact: true })).toBeVisible();
    assert.deepEqual(await apiLinks(), []);
    const linked = [];
    for (const [index, transport] of ['slack', 'teams'].entries()) {
      const name = transport === 'slack' ? 'Slack' : 'Teams';
      const identity = { tenant: `synthetic-lamp-${width}-${index}-tenant`, subject: `synthetic-lamp-${width}-${index}-subject` };
      const minted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/chat-links' && response.request().method() === 'POST');
      await panel.getByRole('button', { name: 'Create link code', exact: true }).click();
      const mint = await minted;
      assert.equal(mint.status(), 201);
      const { code } = await mint.json();
      await expect(panel.getByRole('status').locator('code')).toHaveText([`/lamp link ${code}`, `link ${code}`]);
      const redeemed = await senders[transport](null, { code, identity });
      assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/chat-links' && response.request().method() === 'GET');
      await panel.getByRole('button', { name: 'Refresh chat links', exact: true }).click();
      assert.equal((await refreshed).status(), 200);
      const label = `${name}: ${identity.subject} (${identity.tenant})`;
      await expect(panel.getByText(label, { exact: true })).toBeVisible();
      await panel.getByRole('button', { name: 'Hide link code', exact: true }).click();
      const links = await apiLinks();
      const current = links.find(link => link.transport === transport);
      assert.ok(current, `${name} appears in the native operator list`);
      assert.deepEqual({ transport: current.transport, tenant: current.tenant, subject: current.subject }, { transport, ...identity });
      linked.push({ id: current.id, operator_id: session.body.operator.id, transport, ...identity });
      assert.deepEqual(await storedLinks(), linked, 'each exact transport, tenant and subject is bound to the signed-in operator');
      const beforeReplay = await storedLinks();
      for (const replayIdentity of [identity, { ...identity, subject: `${identity.subject}-replay` }]) {
        assert.equal((await senders[transport](null, { code, identity: replayIdentity })).status, 409, 'a consumed Settings code cannot link the same or a second identity');
        assert.deepEqual(await storedLinks(), beforeReplay, 'replay creates no second durable identity or changed binding');
      }
      await page.reload(); await operatorHydrated(page);
      for (const link of linked) await expect(panel.getByText(`${link.transport === 'slack' ? 'Slack' : 'Teams'}: ${link.subject} (${link.tenant})`, { exact: true })).toBeVisible();
      await expect(panel.getByRole('listitem')).toHaveCount(linked.length);
      assert.deepEqual((await apiLinks()).map(({ id, transport, tenant, subject }) => ({ id, transport, tenant, subject })).sort((a, b) => a.transport.localeCompare(b.transport)), linked.map(({ operator_id, ...link }) => link));
      t?.diagnostic(`PROBE INCIDENT-014 ${name} Settings ${width}: Create link code -> signed /api/chat/${transport} 200; Refresh and reload retain the exact operator binding; same/new-actor replay 409 with unchanged native identities`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px Settings fits the viewport`);
    const axe = await new AxeBuilder({ page }).include('.chat-links-card').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(axe.violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => row.id), []);
    if (process.env.LAMP_BROWSER_EVIDENCE) {
      await mkdir(process.env.LAMP_BROWSER_EVIDENCE, { recursive: true });
      await panel.screenshot({ path: join(process.env.LAMP_BROWSER_EVIDENCE, `chat-links-settings-${width}.png`) });
    }
    for (const link of [...linked]) {
      const row = panel.getByRole('listitem').filter({ hasText: link.subject });
      const removed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/app/chat-links/${link.id}` && response.request().method() === 'DELETE');
      await row.getByRole('button', { name: 'Remove chat link', exact: true }).click();
      assert.equal((await removed).status(), 204);
      await expect(row).toHaveCount(0);
      linked.splice(linked.findIndex(item => item.id === link.id), 1);
      assert.deepEqual(await storedLinks(), linked, 'Settings removes only the selected durable identity');
      assert.equal((await apiLinks()).some(item => item.id === link.id), false, 'native readback confirms removal');
    }
    await page.reload(); await operatorHydrated(page);
    await expect(panel.getByText('No chat identities linked.', { exact: true })).toBeVisible();
    assert.deepEqual(await apiLinks(), []);
    assert.deepEqual(errors, [], 'Settings has no browser or hydration errors');
    t?.diagnostic(`PROBE INCIDENT-014 removal ${width}: both Settings Remove chat link controls -> 204, native list and storage empty after reload; axe, overflow and hydration pass`);
  } finally {
    await context?.close();
    await r.close();
  }
}
