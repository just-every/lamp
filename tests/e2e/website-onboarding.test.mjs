import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { contract } from '../contract.mjs';
import { nativeRequest, openNativeRuntime, origin, publicOrigin } from '../dev-ingress/runtime.mjs';
import { devKey, devKeyHeaders } from '../helpers/dev-key.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';

// The internet, played by one loopback server: Lamp's site reader sends every
// request here with the real host name in X-Lamp-Site-Host.
const mark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0F7B6C"/><path fill="#fff" d="M18 46 32 14l14 32h-8l-6-15-6 15z"/></svg>';
const home = `<!doctype html><html><head><title>Time tracking for teams | Acme Tracking</title>
<meta name="description" content="Acme Tracking keeps your team's hours in one place. Start free today.">
<link rel="icon" type="image/svg+xml" href="/mark.svg"><script>fetch('/ran-a-script')</script></head>
<body><header><nav><a href="/">Home</a><a href="/features/timesheets">Timesheets</a><a href="/features/invoices">Invoices</a><a href="/features/reports">Reports</a><a href="/features/developers">API, CLI, Skills</a>
<a href="/pricing">Pricing</a><a href="https://app.acme-tracking.com/login">Log in</a></nav></header>
<footer><a href="https://status.acme-tracking.com/">Status</a></footer></body></html>`;

contract('SETUP-002', 'a fresh owner gives their website first; Lamp fills in the page from it, a site it cannot read leaves calm defaults, and the edited result is what customers see', async () => {
  const requests = [];
  const site = createServer((request, response) => {
    const host = request.headers['x-lamp-site-host'];
    requests.push(`${host}${request.url}`);
    if (host === 'blocked.example.com') { response.writeHead(403).end('Forbidden'); return; }
    if (host === 'acme-tracking.com' && request.url === '/') { response.writeHead(301, { Location: 'https://www.acme-tracking.com/' }).end(); return; }
    if (host === 'www.acme-tracking.com' && request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(home); return; }
    if (host === 'www.acme-tracking.com' && request.url === '/mark.svg') { response.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(mark); return; }
    if (host === 'status.acme-tracking.com' && request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }).end('<footer><a href="https://www.atlassian.com/software/statuspage"><svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg></a></footer>'); return; }
    if (host === 'status.acme-tracking.com' && request.url === '/api/v2/summary.json') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ page: { id: 'acmetracking01' }, status: { indicator: 'none' }, components: [], incidents: [], scheduled_maintenances: [] })); return; }
    response.writeHead(404).end();
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const runtime = await openNativeRuntime(); let browser;
  try {
    runtime.env.LAMP_DEV_SITE_ORIGIN = `http://127.0.0.1:${site.address().port}`;
    await runtime.start(); await runtime.seedOperator();
    // A fresh owner: claimed, but first run not yet confirmed.
    execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', runtime.state, '--config', 'wrangler.jsonc', '--command', "DELETE FROM setup_readiness WHERE step='first-run'"], { env: runtime.env, stdio: 'pipe' });
    browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
    const context = await browser.newContext({ timezoneId: 'America/New_York' });
    await context.route(url => url.pathname.startsWith('/@fs/'), route => route.continue({ headers: { ...route.request().headers(), 'x-rer-dev-key': devKey } }));
    const entered = await signInAs({ origin, key: devKey });
    await context.addCookies(entered.cookies.map(cookie => ({ ...cookie, url: origin })));
    const cookie = entered.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
    const page = await context.newPage();
    await page.goto(`${origin}/app`); await page.waitForURL('**/setup');
    const website = page.getByLabel('Website', { exact: true });
    const row = name => page.locator(`[data-found="${name}"] .found-value`);

    // Skipping is an honest manual start, without a claim to have read anything.
    await page.getByRole('button', { name: "Skip, I'll fill it in", exact: true }).click();
    await page.getByRole('button', { name: 'Open Lamp', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Read again', exact: true }).count(), 0);
    // A site that refuses after one that answered: setup keeps the refusing domain as the name, offers a retry,
    // and forgets the site read before, so the page never links back to a site other than the one it is named for.
    await website.fill('acme-tracking.com');
    await page.getByRole('button', { name: 'Read website', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'We read acme-tracking.com' }).waitFor();
    assert.equal((await (await nativeRequest('/api/app/website', { cookie })).json()).website.url, 'https://www.acme-tracking.com/');
    await website.fill('blocked.example.com');
    await page.getByRole('button', { name: 'Read again', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: "couldn't read that website" }).waitFor();
    assert.doesNotMatch(await page.getByRole('alert').innerText(), /403/);
    assert.equal(await row('page name').innerText(), 'blocked.example.com Status');
    assert.equal((await (await nativeRequest('/api/app/website', { cookie })).json()).website, null, 'no link back to acme-tracking.com under a page named for blocked.example.com');

    // A site that answers: everything it says is filled in, and only that.
    await website.fill('acme-tracking.com');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'We read acme-tracking.com' }).waitFor();
    assert.equal(await row('page name').innerText(), 'Acme Tracking Status');
    assert.equal(await row('tagline').innerText(), "Acme Tracking keeps your team's hours in one place.");
    assert.equal(await row('accent colour').innerText(), '#0F7B6C');
    assert.match(await row('time zone').innerText(), /^America\/New_York/);
    const foundComponents = ['Timesheets', 'Invoices', 'Reports'];
    assert.deepEqual(await row('components').getByRole('listitem').allTextContents(), foundComponents);
    assert.equal(await page.locator('[data-found="components"] .found-label').textContent(), `Components (${foundComponents.length} found)`);
    assert.equal(await page.locator('[data-found="components"] .found-note').count(), 1, 'without Workers AI, setup says the rule-based reader chose the components');
    assert.match(await row('status page').innerText(), /status\.acme-tracking\.com/);
    assert.equal(await page.locator('[data-found="logo"] img').evaluate(image => image.complete && image.naturalWidth > 0), true, 'the site\'s own mark is shown');
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `first run fits ${width}px`);
    }
    // Every fact stays editable before opening Lamp.
    await page.getByRole('button', { name: 'Edit components', exact: true }).click();
    const components = page.getByLabel('Components', { exact: true });
    const help = await components.getAttribute('aria-describedby');
    assert.ok(help, 'the components help is linked as a description');
    assert.equal(await page.locator(`#${help}`).innerText(), 'One per line.');
    const keptComponents = ['Timesheets', 'Invoices'];
    await components.fill(`${keptComponents.join('\n')}\n\n`);
    await page.getByRole('button', { name: 'Done editing components', exact: true }).click();
    assert.deepEqual(await row('components').getByRole('listitem').allTextContents(), keptComponents);
    assert.equal(await page.locator('[data-found="components"] .found-label').textContent(), `Components (${keptComponents.length} found)`);
    // Reloading restores both the read and the owner's edits without another network read.
    const readsBeforeReload = requests.length;
    await page.reload();
    await row('page name').waitFor();
    assert.equal(await row('page name').innerText(), 'Acme Tracking Status');
    assert.deepEqual(await row('components').getByRole('listitem').allTextContents(), keptComponents);
    assert.equal(requests.length, readsBeforeReload);
    await page.getByRole('button', { name: 'Looks right, open Lamp', exact: true }).click();
    await page.waitForURL('**/app');
    await page.getByRole('region', { name: 'Your public page' }).waitFor();

    const api = async path => (await nativeRequest(path, { cookie })).json();
    const { settings } = await api('/api/app/page-settings');
    assert.deepEqual([settings.pageName, settings.tagline, settings.accentColor, settings.timezone], ['Acme Tracking Status', "Acme Tracking keeps your team's hours in one place.", '#0F7B6C', 'America/New_York']);
    assert.ok(settings.logoKey, 'the mark became the page logo');
    assert.deepEqual((await api('/api/app/components')).components.map(component => component.name), keptComponents);
    assert.equal((await api('/api/app/website')).website.url, 'https://www.acme-tracking.com/');
    await page.goto(`${origin}/app/move-in`);
    await page.getByRole('link', { name: 'status.acme-tracking.com', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Source').inputValue(), 'statuspage');
    assert.equal(await page.getByLabel('Statuspage page ID', { exact: true }).inputValue(), 'acmetracking01');
    // Customers see the page as confirmed; the SVG mark is stored and served as a PNG.
    const published = await (await fetch(`${publicOrigin}/`, { headers: devKeyHeaders })).text();
    for (const text of ['Acme Tracking Status', ...keptComponents]) assert.ok(published.includes(text), text);
    assert.equal(published.includes('Reports'), false, 'a removed component is not published');
    const logo = await fetch(`${publicOrigin}/assets/logo`, { headers: devKeyHeaders });
    assert.equal(logo.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await logo.arrayBuffer()).subarray(0, 4)], [137, 80, 78, 71]);
    assert.equal(requests.some(path => path.includes('ran-a-script')), false, 'nothing on the site ran');
    assert.ok(requests.every(path => /^(blocked\.example\.com|acme-tracking\.com|www\.acme-tracking\.com|status\.acme-tracking\.com)\//.test(path)), 'every read went to the named site or its linked status page');
  } finally {
    await browser?.close(); await runtime.close();
    await new Promise(resolve => site.close(resolve));
  }
});
