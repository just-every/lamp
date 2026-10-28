import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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
// The business's own status page answers with a real Statuspage capture (status.convex.dev, tests/fixtures/status-feeds).
const feeds = Object.fromEntries(readdirSync('tests/fixtures/status-feeds/statuspage-convex').map(name => [name, readFileSync(`tests/fixtures/status-feeds/statuspage-convex/${name}`, 'utf8')]));
// One resolved incident's first update is stamped after its resolution; the page still shows it resolved, so Lamp does too.
{
  const list = JSON.parse(feeds['public-incidents.json']);
  const late = list.incidents.find(incident => incident.id === '66l0hf26745b').incident_updates.find(update => update.id === 'sy2qcwx43kwp');
  late.display_at = '2026-10-20T15:27:29.041Z';
  feeds['public-incidents.json'] = JSON.stringify(list);
}
const noComponents = JSON.stringify({ page: { id: 'acmetracking01' }, status: { indicator: 'none' }, components: [], incidents: [], scheduled_maintenances: [] });

contract('SETUP-002', 'a fresh owner gives their website first; Lamp fills in the page from it, or from the status page it already runs, a site it cannot read leaves calm defaults, and the edited result is what customers see', async () => {
  const requests = [];
  let statusPageListsComponents = false;
  const site = createServer((request, response) => {
    const host = request.headers['x-lamp-site-host'];
    requests.push(`${host}${request.url}`);
    const json = body => response.writeHead(200, { 'Content-Type': 'application/json' }).end(body);
    if (host === 'redirect.example.com') { response.writeHead(302, { Location: 'http://127.0.0.1/private' }).end(); return; }
    if (host === 'blocked.example.com') { response.writeHead(403).end('Forbidden'); return; }
    if (host === 'acme-tracking.com' && request.url === '/') { response.writeHead(301, { Location: 'https://www.acme-tracking.com/' }).end(); return; }
    if (host === 'www.acme-tracking.com' && request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(home); return; }
    if (host === 'www.acme-tracking.com' && request.url === '/mark.svg') { response.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(mark); return; }
    if (host === 'status.acme-tracking.com' && request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }).end('<footer><a href="https://www.atlassian.com/software/statuspage"><svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg></a></footer>'); return; }
    if (host === 'status.acme-tracking.com' && request.url === '/api/v2/summary.json') { json(statusPageListsComponents ? feeds['public-summary.json'] : noComponents); return; }
    if (host === 'status.acme-tracking.com' && request.url === '/api/v2/incidents.json' && statusPageListsComponents) { json(feeds['public-incidents.json']); return; }
    response.writeHead(404).end();
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const runtime = await openNativeRuntime(); let browser;
  try {
    runtime.env.LAMP_DEV_SITE_ORIGIN = `http://127.0.0.1:${site.address().port}`;
    await runtime.start(); await runtime.seedOperator();
    // A fresh owner: claimed, but first run not yet confirmed.
    execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', runtime.state, '--config', 'wrangler.jsonc', '--command', "DELETE FROM setup_readiness WHERE step='first-run'"], { env: runtime.env, stdio: 'pipe' });
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] });
    const context = await browser.newContext({ timezoneId: 'America/New_York', viewport: { width: 1440, height: 1000 } });
    await context.route(url => url.pathname.startsWith('/@fs/'), route => route.continue({ headers: { ...route.request().headers(), 'x-rer-dev-key': devKey } }));
    const entered = await signInAs({ origin, key: devKey });
    await context.addCookies(entered.cookies.map(cookie => ({ ...cookie, url: origin })));
    const cookie = entered.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
    // The owner-facing read door refuses private destinations, including a
    // public website that redirects there, before fetching any private bytes.
    for (const website of ['http://127.0.0.1/private', 'http://169.254.169.254/private', 'https://redirect.example.com/']) {
      const refused = await nativeRequest('/api/app/website/read', { cookie, method: 'POST', json: { website } });
      assert.equal(refused.status, 200);
      assert.equal((await refused.json()).found, null);
    }
    assert.equal(requests.some(path => path.includes('/private')), false);
    const page = await context.newPage();
    await page.goto(`${origin}/app`); await page.waitForURL('**/setup');
    const website = page.getByLabel('Website', { exact: true });
    const row = name => page.locator(`[data-found="${name}"] .found-value`);
    const label = name => page.locator(`[data-found="${name}"] .found-label`);
    const history = page.getByRole('checkbox', { name: /Bring its incident history too/ });

    // Skipping is an honest manual start, without a claim to have read anything.
    await page.getByRole('button', { name: "Skip, I'll fill it in", exact: true }).click();
    await page.getByRole('button', { name: 'Open Lamp', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Read again', exact: true }).count(), 0);
    // A linked status page that lists no components changes nothing: the navigation's components stand, as before.
    await website.fill('acme-tracking.com');
    await page.getByRole('button', { name: 'Read website', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'We read acme-tracking.com' }).waitFor();
    assert.deepEqual(await row('components').getByRole('listitem').allTextContents(), ['Timesheets', 'Invoices', 'Reports']);
    assert.equal(await label('components').textContent(), 'Components (3 found)');
    assert.match(await row('status page').innerText(), /status\.acme-tracking\.com\s*Move its history in later from Settings\./);
    assert.equal(await history.count(), 0, 'no history to offer');
    assert.equal((await (await nativeRequest('/api/app/website', { cookie })).json()).website.url, 'https://www.acme-tracking.com/');
    // A site that refuses after one that answered: setup keeps the refusing domain as the name, offers a retry,
    // and forgets the site read before, so the page never links back to a site other than the one it is named for.
    await website.fill('blocked.example.com');
    await page.getByRole('button', { name: 'Read again', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: "couldn't read that website" }).waitFor();
    assert.doesNotMatch(await page.getByRole('alert').innerText(), /403/);
    assert.equal(await row('page name').innerText(), 'blocked.example.com Status');
    assert.equal((await (await nativeRequest('/api/app/website', { cookie })).json()).website, null, 'no link back to acme-tracking.com under a page named for blocked.example.com');

    // The business's status page now lists its real components, in two groups, and holds 50 incidents.
    statusPageListsComponents = true;
    await website.fill('acme-tracking.com');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'We read acme-tracking.com' }).waitFor();
    assert.equal(await row('page name').innerText(), 'Acme Tracking Status');
    assert.equal(await row('tagline').innerText(), "Acme Tracking keeps your team's hours in one place.");
    assert.equal(await row('accent colour').innerText(), '#0F7B6C');
    assert.match(await row('time zone').innerText(), /^America\/New_York/);
    // Its real components replace the navigation's guesses, labelled with where they came from, in its own groups.
    assert.equal(await label('components').textContent(), 'Components (8 from status.acme-tracking.com)');
    const groups = async () => page.locator('[data-found="components"] .found-groups > div').evaluateAll(blocks => blocks.map(block => [block.querySelector('.found-group').textContent, [...block.querySelectorAll('li')].map(item => item.textContent)]));
    assert.deepEqual(await groups(), [['Live Traffic', ['Free & Starter', 'Professional', 'Business']], ['Development Services', ['Free & Starter', 'Professional', 'Business']], ['Other services', ['convex.dev website', 'AI Gateway']]]);
    assert.match(await row('status page').innerText(), /status\.acme-tracking\.com\s*Bring its incident history too\s*50 past incidents, added as resolved history\. No one is notified\./);
    assert.equal(await history.isChecked(), false, 'history comes only when chosen');
    assert.equal(await page.locator('[data-found="logo"] img').evaluate(image => image.complete && image.naturalWidth > 0), true, 'the site\'s own mark is shown');
    for (const width of [1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `first run fits ${width}px`);
    }
    // Every fact stays editable before opening Lamp: one list per group, one per line.
    await page.getByRole('button', { name: 'Edit components', exact: true }).click();
    const liveTraffic = page.getByLabel('Live Traffic', { exact: true });
    const help = await liveTraffic.getAttribute('aria-describedby');
    assert.ok(help, 'the components help is linked as a description');
    assert.equal(await page.locator(`#${help}`).innerText(), 'One per line.');
    await liveTraffic.fill('Free & Starter\nProfessional\n');
    await page.getByLabel('Other services', { exact: true }).fill('Website\nAI Gateway\nStatus API\n\n');
    await page.getByRole('button', { name: 'Done editing components', exact: true }).click();
    const edited = [['Live Traffic', ['Free & Starter', 'Professional']], ['Development Services', ['Free & Starter', 'Professional', 'Business']], ['Other services', ['Website', 'AI Gateway', 'Status API']]];
    assert.deepEqual(await groups(), edited);
    assert.equal(await label('components').textContent(), 'Components (8 from status.acme-tracking.com)');
    await history.check();
    // Reloading restores both the read and the owner's edits and choice without another network read.
    const readsBeforeReload = requests.length;
    await page.reload();
    await row('page name').waitFor();
    assert.equal(await row('page name').innerText(), 'Acme Tracking Status');
    assert.deepEqual(await groups(), edited);
    assert.equal(await history.isChecked(), true);
    assert.equal(requests.length, readsBeforeReload);
    await page.getByRole('button', { name: 'Looks right, open Lamp', exact: true }).click();
    await page.waitForURL('**/app', { timeout: 120_000 });
    await page.getByRole('region', { name: 'Your public page' }).waitFor();

    const api = async path => (await nativeRequest(path, { cookie })).json();
    const { settings } = await api('/api/app/page-settings');
    assert.deepEqual([settings.pageName, settings.tagline, settings.accentColor, settings.timezone], ['Acme Tracking Status', "Acme Tracking keeps your team's hours in one place.", '#0F7B6C', 'America/New_York']);
    assert.ok(settings.logoKey, 'the mark became the page logo');
    const { components } = await api('/api/app/components');
    const byGroup = edited.map(([group, names]) => [group === 'Other services' ? null : group, names]);
    assert.deepEqual(byGroup.map(([group]) => [group, components.filter(component => component.groupName === group).map(component => component.name)]), byGroup, 'the kept components, in the page\'s groups and the owner\'s names');
    // The history came through Move in as resolved, silent history: every past incident but those about a component left out.
    const source = JSON.parse(feeds['public-incidents.json']).incidents;
    const leftOut = new Set(['80vwt3vp1hg5']);
    const expected = source.filter(incident => !incident.components.length || incident.components.some(component => !leftOut.has(component.id)));
    const { incidents } = await api('/api/app/incidents');
    assert.equal(incidents.length, expected.length);
    assert.ok(expected.length > 40 && incidents.every(incident => incident.lifecycle === 'Resolved' && incident.resolvedAt), 'all of it resolved, none of it active');
    assert.equal((await api('/api/app/overview')).overview.activeIncidents.length, 0);
    assert.ok(components.every(component => component.publicState === 'Operational'), 'no component is left degraded by history');
    assert.deepEqual((await api('/api/app/deliveries')).deliveries, [], 'no one was notified');
    const newest = incidents.find(incident => incident.title === 'Elevated Error Rate for Deploying Node Actions');
    assert.deepEqual(newest.updates.map(update => update.publishedAt).sort(), source.find(incident => incident.name === newest.title).incident_updates.map(update => new Date(update.display_at).toISOString()).sort(), 'each update at its own time');
    assert.equal((await api('/api/app/website')).website.url, 'https://www.acme-tracking.com/');
    await page.goto(`${origin}/app/move-in`);
    await page.getByRole('link', { name: 'status.acme-tracking.com', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Source').inputValue(), 'statuspage');
    assert.equal(await page.getByLabel('Statuspage page ID', { exact: true }).inputValue(), 'jx5n2jz8hhnj');
    assert.deepEqual((await api('/api/app/statuspage-import/jobs')).jobs.map(job => [job.namespace, job.state]), [['statuspage', 'completed']], 'Move in lists the import, to review or undo');
    // Customers see the page as confirmed, with its history; the SVG mark is stored and served as a PNG.
    const published = await (await fetch(`${publicOrigin}/`, { headers: devKeyHeaders })).text();
    for (const text of ['Acme Tracking Status', 'Live Traffic', 'Development Services', 'Website', 'Status API']) assert.ok(published.includes(text), text);
    assert.equal(published.includes('Reports'), false, 'a guessed component is not published');
    assert.equal(published.includes('convex.dev website'), false, 'a renamed component is published under its new name');
    const past = await (await fetch(`${publicOrigin}/history`, { headers: devKeyHeaders })).text();
    assert.ok(past.includes('Elevated Error Rate for Deploying Node Actions'), 'past incidents are on the page\'s history');
    const logo = await fetch(`${publicOrigin}/assets/logo`, { headers: devKeyHeaders });
    assert.equal(logo.headers.get('content-type'), 'image/png');
    assert.ok((await logo.arrayBuffer()).byteLength, 'the stored logo remains readable');
    assert.equal(requests.some(path => path.includes('ran-a-script')), false, 'nothing on the site ran');
    assert.ok(requests.every(path => /^(redirect\.example\.com|blocked\.example\.com|acme-tracking\.com|www\.acme-tracking\.com|status\.acme-tracking\.com)\//.test(path)), 'every read went to the named site or its linked status page');
  } finally {
    await browser?.close(); await runtime.close();
    await new Promise(resolve => site.close(resolve));
  }
});
