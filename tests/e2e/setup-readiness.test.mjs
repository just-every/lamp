import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { insertRealOperatorSession } from './real-session-helper.mjs';
import { reservePort, waitForWorker } from './worker-startup.mjs';
import { appOrigin, pageOrigin } from './helpers/hosts.mjs';
import { accessibilityFailure, observeAuditPage } from './subscriber-audit-helper.mjs';
import { sessionCookieName } from '../helpers/session-cookie.mjs';
import { devKey } from '../helpers/dev-key.mjs';
import { operatorHydrated } from "./helpers/operator-hydrated.mjs";
const executeFile = promisify(execFile);

test('SETUP-001 Lamp publishes and checks the page on its own: Overview shows one live line at 1440 and 390, its links open finished pages, and the local sender stays honest', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(join(process.cwd(), '.lamp-readiness-browser-'));
  const state = join(directory, 'state');
  let cache, worker, browser, page, origin, publicOrigin, output = '';
  const diagnostics = { phase: 'fixture' };
  try {
    // Vite exposes in-root optimized modules through root-relative URLs.
    // Keep the private cache inside Lamp's native development-asset boundary.
    cache = await mkdtemp(resolve('node_modules/.lamp-readiness-vite-'));
    const port = await reservePort({ label: 'Setup checklist Worker' });
    origin = appOrigin(port);
    publicOrigin = pageOrigin(port);
    execFileSync('pnpm', ['exec','wrangler','d1','migrations','apply','DB','--local','--config','wrangler.jsonc','--persist-to',state], { stdio: 'pipe' });
    // This journey supplies neutral settings below; the session helper's
    // default branded settings would occupy the same page_settings row.
    const sessionId = await insertRealOperatorSession({ persistTo: state, pageSettings: false });
    // A retained neutral setup row is a real fresh-install fixture, not a
    // checklist override. All subsequent evidence comes from native actions.
    execFileSync('pnpm', ['exec','wrangler','d1','execute','DB','--local','--config','wrangler.jsonc','--persist-to',state,'--command', "INSERT INTO page_settings (id,page_name,tagline,accent_color,timezone,hostname,feed_id,footer_credit_enabled,widget_allowed_origins,mail_from_address,created_at,updated_at) VALUES ('default','Your status page','Service availability','#16794C','UTC','127.0.0.1','readiness-fixture',1,'[]','lamp@localhost.invalid','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');"], { stdio: 'pipe' });
    worker = spawn('pnpm', ['exec','vite','--host','127.0.0.1','--port',String(port),'--strictPort'], { detached: true, stdio: 'pipe', env: { ...process.env, RER_DEV_KEY: devKey, RER_DEV_ORIGIN: origin, LAMP_WORKERS_STATE_PATH: state, LAMP_VITE_CACHE_DIR: cache, LAMP_DISABLE_INSPECTOR: 'true' } });
    worker.stdout.on('data', chunk => { output += chunk; }); worker.stderr.on('data', chunk => { output += chunk; });
    await waitForWorker({ origin, child: worker, output: () => 'Setup checklist Worker output withheld because it may contain private links.', label: 'Setup checklist Worker' });
    const api = async (path, method = 'GET', body, headers = {}) => {
      const response = await fetch(`${origin}${path}`, { method, headers: { Origin:process.env.AUTH_ORIGIN, Cookie: `${sessionCookieName(origin)}=${sessionId}`, 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual' });
      assert.equal(response.ok, true, `${method} ${path} succeeds`);
      return response.json();
    };
    // The owner has finished first-run setup at /setup; Overview reports the live page.
    await api('/api/app/overview/first-run', 'POST', {});
    browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
    const context = await browser.newContext(); await context.addCookies([{ name: sessionCookieName(origin), value: sessionId, url: origin }]);
    page = await context.newPage();
    observeAuditPage(page, diagnostics);
    page.on('response', async response => {
      const pathname = new URL(response.url()).pathname;
      const category = new Map([
        ['/api/app/page-settings', 'settings'], ['/api/app/session', 'session'],
        ['/api/app/ai/status', 'ai-status'], ['/api/app/overview', 'overview'], ['/api/app/overview/live', 'live'],
      ]).get(pathname);
      if (category) diagnostics.apiResponses = { ...diagnostics.apiResponses, [category]: response.status() };
      if (response.request().resourceType() === 'script' && response.status() >= 400) {
        const moduleCategory = new Map([
          ['/modules/mail/src/development/index.mjs', 'server-development-mail'],
          ['/modules/mail/src/sendgrid-email/index.mjs', 'server-sendgrid-mail'],
        ]).get(pathname) ?? 'other-module';
        diagnostics.failedModuleCategories = [...new Set([...(diagnostics.failedModuleCategories ?? []), moduleCategory])];
      }
    });
    page.on('pageerror', cause => {
      diagnostics.runtimeKinds = [...new Set([...(diagnostics.runtimeKinds ?? []),
        ...['window is not defined', 'Cannot read properties of undefined', 'Cannot read properties of null', 'not a function', 'Failed to fetch dynamically imported module', 'Hydration failed'].filter(kind => cause.message.includes(kind)),
      ])];
    });
    const evidencePath = process.env.LAMP_READINESS_EVIDENCE_DIR;
    if (evidencePath) await mkdir(resolve(evidencePath), { recursive: true });
    const host = new URL(publicOrigin).host;
    async function inspect(name) {
      diagnostics.phase = name;
      const live = (await api('/api/app/overview/live')).live;
      diagnostics.expectedPublicOrigin = live.publicOrigin === publicOrigin;
      diagnostics.publicOriginHostMatches = new URL(live.publicOrigin).hostname === new URL(publicOrigin).hostname;
      diagnostics.publicOriginPortMatches = new URL(live.publicOrigin).port === new URL(origin).port;
      // Nobody pressed a check: Lamp read its own public page and form.
      assert.equal(live.publicOrigin, publicOrigin);
      assert.equal(Boolean(live.publishedAt), true);
      assert.deepEqual([live.page?.ok, live.subscribe?.ok], [true, true]);
      assert.ok(Date.parse(live.subscribe.checkedAt) >= Date.parse(live.publishedAt), 'the check read the page as last published');
      assert.equal(live.sender.state, 'local');
      for (const width of [1440,390]) {
        await page.setViewportSize({ width, height: 900 }); await page.goto(`${origin}/app`);
        const strip = page.getByRole('region', { name: 'Your public page' });
        try { await strip.waitFor(); }
        catch (error) { throw accessibilityFailure(error, `${name} live strip at ${width}px`, diagnostics); }
        assert.match(await strip.innerText(), new RegExp(`Live at ${host.replace('.', '\\.')}`));
        assert.match(await strip.innerText(), /page and subscribe form checked/);
        assert.equal(await page.getByText('Set up your status page').count(), 0, 'setup asks nothing of the owner');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const result = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
        assert.deepEqual(result.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => v.id), []);
        if (evidencePath) await page.screenshot({ path: join(resolve(evidencePath), `${name}-${width}.png`), fullPage: true });
        assert.equal(await strip.getByRole('link', { name: host }).getAttribute('href'), `${publicOrigin}/`);
        await strip.getByRole('link', { name: 'Review page', exact: true }).click();
        await page.getByRole('heading', { name: 'Your page', exact: true }).waitFor();
        await page.getByText('Subscribe form working', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.goto(`${origin}/app`);
        await strip.getByRole('link', { name: 'Change address', exact: true }).click();
        await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
        await page.locator('.page-hero').getByRole('link', { name: host }).waitFor();
      }
    }
    await inspect('fresh');
    diagnostics.phase = 'settings-save';
    await page.goto(`${origin}/app/settings`);
    await operatorHydrated(page);
    await page.getByLabel('Page name', { exact: true }).fill('Customer status');
    // The native label wraps a populated textarea; its text includes the
    // initial textarea contents. Select that label's actual editable control.
    await page.locator('label').filter({ hasText: /^Tagline/ }).locator('textarea').fill('Current service availability');
    await page.locator('label').filter({ hasText: /^Time zone/ }).locator('select').selectOption('Australia/Brisbane');
    const savedSettings = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings' && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    diagnostics.phase = 'settings-save-response';
    assert.equal((await savedSettings).status(), 200);
    const saved = (await api('/api/app/page-settings')).settings;
    assert.equal(saved.pageName, 'Customer status');
    assert.equal(saved.tagline, 'Current service availability');
    assert.equal(saved.timezone, 'Australia/Brisbane');
    diagnostics.phase = 'settings-sender';
    await page.goto(`${origin}/app/settings#notifications`);
    await page.getByText('Email is off on a local Lamp.', { exact: false }).waitFor();
    assert.equal((await api('/api/app/deliveries')).mail.local, true);
    diagnostics.phase = 'component-create';
    await page.goto(`${origin}/app/components`);
    await page.getByRole('heading', { name: 'Add component', exact: true }).waitFor();
    await page.getByLabel('Component name', { exact: true }).fill('API');
    const createdComponent = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/components' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create component', exact: true }).click();
    const componentResponse = await createdComponent;
    assert.equal(componentResponse.ok(), true);
    const { component } = await componentResponse.json();
    assert.equal((await api('/api/app/components')).components.find(item => item.id === component.id)?.name, 'API');
    diagnostics.phase = 'publish';
    const { incident } = await api('/api/app/incidents','POST',{ title: 'Brief service interruption', components: [{ componentId: component.id, state: 'Degraded performance', relationship: 'Primary' }] });
    const current = (await api(`/api/app/incidents/${incident.id}`)).incident;
    const { draft } = await api(`/api/app/incidents/${incident.id}/draft`, 'PUT', { lifecycle: 'Resolved', affectedAudience: 'API customers', customerImpact: 'Requests were briefly delayed', whatStillWorks: '', details: 'Service has recovered', nextUpdateAt: null }, { 'If-Match': `${current.draft?.id ?? '-'}:${current.updates.length}` });
    const { update } = await api(`/api/app/incidents/${incident.id}/publish`, 'POST', { channels: [] }, { 'If-Match': `${draft.id}:${current.updates.length}` });
    assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.updates.some(item => item.id === update.id), true);
    // Every change republished the page; Lamp checks the new one by itself.
    await inspect('local-ready');
    // Exercise the actual executable and Wrangler adapter, capturing its sole
    // stdout line in memory and consuming it without tracing or screenshots.
    diagnostics.phase = 'terminal-signin';
    const command = await executeFile(process.execPath, [resolve('scripts/signin-link.mjs'),'--email','operator@example.test','--origin',origin,'--config',process.env.LAMP_WRANGLER_CONFIG,'--persist-to',state], { encoding: 'utf8', cwd: directory });
    assert.equal(command.stderr.length, 0); assert.equal(command.stdout.trim().split('\n').length, 1);
    const link = command.stdout.trim(), confirmation = new URL(link);
    assert.equal(confirmation.origin === origin && confirmation.pathname === '/auth/confirm', true);
    assert.equal(Boolean(confirmation.searchParams.get('token')), true);
    assert.equal((await fetch(`${origin}/api/app/session`)).status, 401);
    // Base previews email links without consuming them, including a second
    // visit by a mail scanner. Only the explicit confirmation creates a session.
    for (let visit = 0; visit < 2; visit++) {
      const preview = await fetch(link, { redirect: 'manual' });
      assert.equal(preview.status, 200); assert.equal(preview.headers.has('set-cookie'), false);
      await preview.body?.cancel();
    }
    assert.equal((await fetch(`${origin}/api/app/session`)).status, 401);
    const confirm = () => fetch(`${origin}/auth/confirm`, {
      method: 'POST', headers: { Origin: origin },
      body: new URLSearchParams({ token: confirmation.searchParams.get('token') }), redirect: 'manual',
    });
    const signIn = await confirm();
    assert.equal(signIn.status, 303); assert.equal(signIn.headers.has('set-cookie'), true);
    assert.equal(new URL(signIn.headers.get('location'), origin).href === `${origin}/app`, true);
    const headers = { Cookie: signIn.headers.get('set-cookie').split(';')[0] };
    const session = await fetch(`${origin}/api/app/session`, { headers, redirect: 'manual' });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).operator.id, (await api('/api/app/session')).operator.id);
    const destination = await fetch(`${origin}/app`, { headers, redirect: 'manual' });
    assert.equal(destination.status, 200); await destination.body?.cancel();
    assert.equal((await fetch(link, { redirect: 'manual' })).status, 400);
    const replay = await confirm();
    assert.equal(replay.status, 400); assert.equal(replay.headers.has('set-cookie'), false);
    assert.equal(output.includes(link), false, 'Worker output must not retain the command-line link');
  } catch (cause) {
    if (page && !page.isClosed()) {
      diagnostics.expectedSettingsRoute = new URL(page.url()).pathname === '/app/settings';
      diagnostics.pageNameFields = await page.getByLabel('Page name', { exact: true }).count();
      diagnostics.liveStrips = await page.getByRole('region', { name: 'Your public page' }).count();
      diagnostics.errorAlerts = await page.getByRole('alert').count();
      const statusText = await page.getByRole('status').allTextContents();
      diagnostics.statusErrorKinds = ['not answering', 'no subscribe form', 'fetch failed', 'Network connection lost', 'localhost', 'private IP', 'loopback'].filter(kind => statusText.some(value => value.includes(kind)));
      diagnostics.invalidSettingsFields = [];
      for (const label of ['Page name', 'Tagline', 'Accent colour', 'Time zone', 'From email']) {
        const field = page.getByLabel(label, { exact: true });
        if (await field.count() === 1 && !await field.evaluate(node => node.validity.valid)) diagnostics.invalidSettingsFields.push(label);
      }
      if (diagnostics.expectedSettingsRoute && process.env.LAMP_READINESS_EVIDENCE_DIR) {
        await page.screenshot({ path: join(resolve(process.env.LAMP_READINESS_EVIDENCE_DIR), 'settings-failure.png'), fullPage: true });
      }
    }
    if (diagnostics.phase === 'fresh' || diagnostics.phase === 'local-ready') {
      const publicResponse = await fetch(`${publicOrigin}/`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
      diagnostics.publicDocumentStatus = publicResponse.status;
      diagnostics.publicDocumentHtml = publicResponse.headers.get('Content-Type')?.includes('text/html') ?? false;
      const html = await publicResponse.text();
      diagnostics.publicSubscribeForm = /<form\b[^>]*\baction=["']\/subscribe["'][^>]*>[\s\S]*?<\/form>/i.test(html);
    }
    diagnostics.workerErrorKinds = ['ReferenceError', 'TypeError', 'SyntaxError', 'window is not defined', 'Cannot read properties of undefined', 'Cannot read properties of null', 'Failed to resolve import', 'Failed to load url'].filter(kind => output.includes(kind));
    throw accessibilityFailure(cause, 'Setup readiness journey', diagnostics);
  } finally {
    await browser?.close();
    if (worker && worker.exitCode === null) {
      const closed = new Promise(resolve => worker.once('close', resolve));
      try { process.kill(-worker.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await closed;
    }
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      cache ? rm(cache, { recursive: true, force: true }) : undefined,
    ]);
  }
});
