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
const executeFile = promisify(execFile);

test('SETUP-001 fresh, half complete and complete setup render correctly at 1440 and 390 through real operator and public routes', { timeout: 180_000 }, async () => {
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
    // The owner has finished first-run setup at /setup; the checklist follows on Overview.
    await api('/api/app/overview/first-run', 'POST', {});
    browser = await chromium.launch();
    const context = await browser.newContext(); await context.addCookies([{ name: sessionCookieName(origin), value: sessionId, url: origin }]);
    page = await context.newPage();
    observeAuditPage(page, diagnostics);
    page.on('response', async response => {
      const pathname = new URL(response.url()).pathname;
      const category = new Map([
        ['/api/app/page-settings', 'settings'], ['/api/app/session', 'session'],
        ['/api/app/ai/status', 'ai-status'], ['/api/app/overview', 'overview'],
        ['/api/app/overview/check-subscribe', 'subscribe-action'],
      ]).get(pathname);
      if (category) diagnostics.apiResponses = { ...diagnostics.apiResponses, [category]: response.status() };
      if (category === 'subscribe-action' && response.status() >= 400) {
        const body = await response.json().catch(() => null);
        diagnostics.subscribeErrorString = typeof body?.error === 'string';
        diagnostics.subscribeErrorKinds = ['Invalid redirect value', 'redirect', 'Illegal invocation', 'incorrect `this` reference', 'public page is not reachable', 'public response does not contain', 'Invalid setup action', 'Cross-site setup actions', 'AbortSignal', 'RequestInit', 'signal', 'timeout', 'not implemented', 'not supported', 'fetch', 'private', 'loopback', 'disallowed', 'header', 'Network', 'Internal', 'SQLITE', 'D1', 'Recursion'].filter(kind => typeof body?.error === 'string' && body.error.includes(kind));
      }
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
    async function inspect(name, facts, complete = false) {
      diagnostics.phase = name;
      const checklist = (await api('/api/app/overview')).overview.checklist;
      diagnostics.expectedPublicOrigin = checklist.publicOrigin === publicOrigin;
      diagnostics.publicOriginHostMatches = new URL(checklist.publicOrigin).hostname === new URL(publicOrigin).hostname;
      diagnostics.publicOriginPortMatches = new URL(checklist.publicOrigin).port === new URL(origin).port;
      assert.equal(checklist.complete, complete);
      for (const [id, done] of Object.entries(facts)) {
        assert.equal(checklist.steps.find(step => step.id === id)?.done, done, `${name}: ${id}`);
      }
      for (const width of [1440,390]) {
        await page.setViewportSize({ width, height: 900 }); await page.goto(`${origin}/app`);
        const card = page.getByRole('region', { name: 'Setup checklist' }).or(page.locator('details[aria-label="Setup checklist"]'));
        try { await card.waitFor(); }
        catch (error) { throw accessibilityFailure(error, `${name} setup checklist at ${width}px`, diagnostics); }
        for (const [id, done] of Object.entries(facts)) {
          assert.equal(await page.locator(`[data-setup-step="${id}"]`).getAttribute('data-complete'), String(done));
        }
        assert.equal(await page.locator('details[aria-label="Setup checklist"]').count(), checklist.complete ? 1 : 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const result = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
        assert.deepEqual(result.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => v.id), []);
        if (evidencePath) await page.screenshot({ path: join(resolve(evidencePath), `${name}-${width}.png`), fullPage: true });
        if (checklist.complete) {
          const disclosure = page.locator('details[aria-label="Setup checklist"]');
          assert.equal(await disclosure.evaluate(node => node.open), false);
          await disclosure.locator('summary').focus();
          await page.keyboard.press('Enter');
          assert.equal(await disclosure.evaluate(node => node.open), true);
          assert.equal(await disclosure.locator('[data-setup-step="component"] a').isVisible(), true);
          for (const step of checklist.steps) {
            assert.equal(await disclosure.locator(`[data-setup-step="${step.id}"]`).locator('a, button').isVisible(), true, `${name}: ${step.id} action is visible at ${width}px`);
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          await page.keyboard.press('Enter');
          assert.equal(await disclosure.evaluate(node => node.open), false);
        } else {
          for (const step of checklist.steps) {
            assert.equal(await card.locator(`[data-setup-step="${step.id}"]`).locator('a, button').isVisible(), true, `${name}: ${step.id} action is visible at ${width}px`);
          }
          for (const [step, control] of [['sender', 'Check mail sender'], ['domain', 'Use this public address']]) {
            await page.locator(`[data-setup-step="${step}"] a`).click();
            await page.getByRole('button', { name: control, exact: true }).waitFor();
            await page.getByRole('link', { name: 'Return to setup checklist', exact: true }).click();
            await page.locator('[data-setup-step="sender"]').waitFor();
          }
        }
      }
    }
    await inspect('fresh', { timezone: true, branding: false, component: false, sender: false });
    diagnostics.phase = 'settings-save';
    await page.locator('[data-setup-step="branding"] a').click();
    await page.getByLabel('Page name', { exact: true }).fill('Customer status');
    // The native label wraps a populated textarea; its text includes the
    // initial textarea contents. Select that label's actual editable control.
    await page.locator('label').filter({ hasText: /^Tagline/ }).locator('textarea').fill('Current service availability');
    await page.getByLabel('Timezone', { exact: true }).fill('Australia/Brisbane');
    const savedSettings = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/page-settings' && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    diagnostics.phase = 'settings-save-response';
    assert.equal((await savedSettings).status(), 200);
    const saved = (await api('/api/app/page-settings')).settings;
    assert.equal(saved.pageName, 'Customer status');
    assert.equal(saved.tagline, 'Current service availability');
    assert.equal(saved.timezone, 'Australia/Brisbane');
    await page.goto(`${origin}/app`);
    diagnostics.phase = 'component-create';
    await page.locator('[data-setup-step="component"] a').click();
    await page.getByRole('button', { name: 'Add component', exact: true }).click();
    await page.getByLabel('Component name', { exact: true }).fill('API');
    const createdComponent = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/components' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create component', exact: true }).click();
    const componentResponse = await createdComponent;
    assert.equal(componentResponse.ok(), true);
    const { component } = await componentResponse.json();
    assert.equal((await api('/api/app/components')).components.find(item => item.id === component.id)?.name, 'API');
    await page.goto(`${origin}/app`);
    diagnostics.phase = 'settings-address';
    await page.locator('[data-setup-step="domain"] a').click();
    const acceptedAddress = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/overview/accept-address' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Use this public address', exact: true }).click();
    assert.equal((await acceptedAddress).status(), 200);
    await inspect('half', { branding: true, timezone: true, component: true, domain: true, sender: false, incident: false });
    diagnostics.phase = 'settings-sender';
    await page.locator('[data-setup-step="sender"] a').click();
    const checkedSender = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/overview/check-sender' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Check mail sender', exact: true }).click();
    assert.equal((await checkedSender).status(), 200);
    assert.equal((await api('/api/app/overview')).overview.checklist.steps.find(step => step.id === 'sender').done, true);
    diagnostics.phase = 'subscribe';
    await page.goto(`${origin}/app`);
    await page.getByRole('button', { name: 'Check subscribe form', exact: true }).click();
    await page.locator('[data-setup-step="subscribe"][data-complete="true"]').waitFor();
    assert.equal((await api('/api/app/overview')).overview.checklist.steps.find(step => step.id === 'subscribe').done, true);
    diagnostics.phase = 'publish';
    await page.locator('[data-setup-step="incident"] a').click();
    await page.getByRole('heading', { name: 'Incidents', exact: true }).waitFor();
    const { incident } = await api('/api/app/incidents','POST',{ title: 'Brief service interruption', components: [{ componentId: component.id, state: 'Degraded performance', relationship: 'Primary' }] });
    const current = (await api(`/api/app/incidents/${incident.id}`)).incident;
    const { draft } = await api(`/api/app/incidents/${incident.id}/draft`, 'PUT', { lifecycle: 'Resolved', affectedAudience: 'API customers', customerImpact: 'Requests were briefly delayed', whatStillWorks: '', details: 'Service has recovered', nextUpdateAt: null }, { 'If-Match': `${current.draft?.id ?? '-'}:${current.updates.length}` });
    const { update } = await api(`/api/app/incidents/${incident.id}/publish`, 'POST', { channels: [] }, { 'If-Match': `${draft.id}:${current.updates.length}` });
    await page.goto(`${origin}/app`);
    await page.locator('[data-setup-step="public"][data-complete="false"]').waitFor();
    assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.updates.some(item => item.id === update.id), true);
    assert.equal((await api('/api/app/overview')).overview.checklist.steps.find(step => step.id === 'incident').done, true);
    const popupPromise = context.waitForEvent('page');
    diagnostics.phase = 'public-open';
    await page.getByRole('button', { name: 'Open public page', exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForURL(`${publicOrigin}/`); await popup.waitForLoadState(); await popup.close();
    await page.bringToFront();
    // Public-open is the last action: no reload, later setup check or navigation
    // may hide a stale Overview. Saved evidence must finish this live checklist.
    await page.locator('details[aria-label="Setup checklist"]').waitFor();
    await page.locator('[data-setup-step="public"][data-complete="true"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('details[aria-label="Setup checklist"]').evaluate(node => node.open), false);
    assert.equal((await api('/api/app/overview')).overview.checklist.complete, true);
    await inspect('complete', { incident: true, public: true, subscribe: true }, true);
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
      diagnostics.senderControls = await page.getByRole('button', { name: 'Check mail sender', exact: true }).count();
      diagnostics.errorAlerts = await page.getByRole('alert').count();
      const statusText = await page.getByRole('status').allTextContents();
      diagnostics.statusErrorKinds = ['public page is not reachable', 'public response does not contain', 'Invalid setup action', 'Cross-site setup actions', 'fetch failed', 'Network connection lost', 'localhost', 'private IP', 'loopback'].filter(kind => statusText.some(value => value.includes(kind)));
      diagnostics.invalidSettingsFields = [];
      for (const label of ['Page name', 'Host name', 'Tagline', 'Accent colour', 'Timezone', 'From email']) {
        const field = page.getByLabel(label, { exact: true });
        if (await field.count() === 1 && !await field.evaluate(node => node.validity.valid)) diagnostics.invalidSettingsFields.push(label);
      }
      if (diagnostics.expectedSettingsRoute && process.env.LAMP_READINESS_EVIDENCE_DIR) {
        await page.screenshot({ path: join(resolve(process.env.LAMP_READINESS_EVIDENCE_DIR), 'settings-failure.png'), fullPage: true });
      }
    }
    if (diagnostics.phase === 'subscribe') {
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
