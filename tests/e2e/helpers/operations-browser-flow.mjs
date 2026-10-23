import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { operatorHydrated } from './operator-hydrated.mjs';
const execute = promisify(execFile);
const addCookie = (context, cookie, origin) => context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })));

export async function operationsBrowserFlow({ api, component, origin, cookie, runtime, signIn }) {
  const target = await component('Production API responders');
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  const sources = [], hydration = [];
  const archive = join(runtime.directory, 'operations-browser-archive');
  try {
    const context = await browser.newContext();
    await addCookie(context, cookie, origin);
    const page = await context.newPage();
    page.on('console', message => { if (/hydration|did not match|server rendered/i.test(message.text())) hydration.push(message.text()); });
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    const editor = page.locator('section[aria-labelledby="operations-title"]');
    async function capture(width, name, card) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: no horizontal overflow`);
      const axe = await new AxeBuilder({ page }).include('[aria-labelledby="operations-title"]').analyze();
      assert.deepEqual(axe.violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => row.id), [], `${name}: no serious axe finding`);
      assert.deepEqual(hydration, []);
      if (process.env.LAMP_SCREENSHOTS) {
        await editor.locator('form').screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-operations-${name}-form.png` });
        if (card) await card.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-operations-${name}-source.png` });
      }
    }
    async function connect(preset, source, width) {
      const tool = preset === 'jsm' ? 'JSM' : 'Opsgenie';
      const card = page.getByRole('article', { name: `${tool} source ${source.name}`, exact: true });
      await card.getByRole('button', { name: source.responderConnection === 'not-connected' ? `Connect ${tool} outbound notes` : `Reconnect ${tool}`, exact: true }).click();
      if (preset === 'jsm') {
        await editor.getByLabel('Atlassian site', { exact: true }).fill('https://synthetic-lamp.atlassian.net');
        await editor.getByLabel('Atlassian account email', { exact: true }).fill('operator@example.test');
        await editor.getByLabel('Atlassian API token', { exact: true }).fill('synthetic-lamp-12');
      } else await editor.getByLabel('Opsgenie API key', { exact: true }).fill('synthetic-lamp-14');
      const saving = page.waitForResponse(response => response.url().endsWith(`/api/app/intake/sources/${source.id}`) && response.request().method() === 'PUT');
      await editor.getByRole('button', { name: `Save and connect ${tool}`, exact: true }).click();
      const response = await saving;
      const saved = await response.json();
      assert.equal(response.status(), 200, JSON.stringify(saved));
      assert.equal(saved.source.responderConnection, 'connected', 'the saved responder credential is connected');
      await card.getByText('Connected', { exact: true }).waitFor();
      await capture(width, `${preset}-connected`, card);
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const preset of ['jsm', 'opsgenie']) {
        await page.goto(`${origin}/app/alerts`); await operatorHydrated(page);
        const tool = preset === 'jsm' ? 'JSM' : 'Opsgenie', name = `Production API ${tool} ${width}`;
        await editor.getByLabel('Operations tool', { exact: true }).selectOption(preset);
        await editor.getByLabel('Responder source name', { exact: true }).fill(name);
        await editor.getByLabel('Component 1', { exact: true }).selectOption(target.id);
        await editor.getByLabel('Alert tag 1', { exact: true }).fill('component:api');
        await editor.getByLabel('Close alert on resolve', { exact: true }).check();
        await editor.getByRole('button', { name: `Create ${tool} endpoint`, exact: true }).click();
        const card = page.getByRole('article', { name: `${tool} source ${name}`, exact: true });
        await card.getByText('Not connected', { exact: true }).waitFor();
        const source = (await api('/api/app/intake/sources')).body.sources.find(row => row.name === name);
        assert.ok(source && source.webhookConnected);
        const header = await editor.getByLabel(`${tool} authorization header`, { exact: true }).inputValue();
        assert.ok(header.startsWith('Authorization: Bearer ') && header.length > 'Authorization: Bearer '.length, 'the owner can copy the generated inbound credential once');
        await capture(width, `${preset}-disconnected`, card);
        await connect(preset, source, width);
        sources.push({ preset, source, width });
      }
    }
    await runtime.stop();
    const runArchive = (script, args) => execute(process.execPath, [resolve('scripts', script), '--config', runtime.env.LAMP_WRANGLER_CONFIG, ...args], { env: runtime.env, maxBuffer: 4 * 1024 * 1024 });
    await runArchive('export.mjs', ['--persist-to', runtime.state, '--out', archive]);
    await rm(runtime.state, { recursive: true, force: true });
    await runArchive('import.mjs', ['--persist-to', runtime.state, '--from', archive]);
    await runtime.start();
    await context.clearCookies();
    await addCookie(context, await signIn(), origin);
    for (const { preset, source, width } of sources) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${origin}/app/alerts`); await operatorHydrated(page);
      const tool = preset === 'jsm' ? 'JSM' : 'Opsgenie';
      const card = page.getByRole('article', { name: `${tool} source ${source.name}`, exact: true });
      await card.getByText('Reconnect required', { exact: true }).waitFor();
      await capture(width, `${preset}-restore-reconnect`, card);
      await connect(preset, { ...source, responderConnection: 'reconnect' }, width);
      await card.getByRole('button', { name: 'Erase source', exact: true }).click();
      await card.getByRole('button', { name: 'Permanently erase source', exact: true }).click();
      await card.waitFor({ state: 'detached' });
      assert.ok(!(await api('/api/app/intake/sources')).body.sources.some(row => row.id === source.id));
    }
  } finally { await browser.close(); await rm(archive, { recursive: true, force: true }); }
}
