import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { parse } from 'parse5';
import { openStatusJourney, eventually } from './helpers/status-journey.mjs';
import { assertVisibleTime } from '../helpers/public-meaning.mjs';
import { publicCapacityJourney } from './helpers/public-capacity-journey.mjs';

function descendants(node) {
  return (node.childNodes ?? []).flatMap(child => [child, ...descendants(child)]);
}
function nodeText(node) {
  return node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(nodeText).join('');
}
function hasClass(node, name) {
  return node.attrs?.some(attr => attr.name === 'class' && attr.value.split(' ').includes(name));
}

// A single isolated component keeps a published incident's contribution separate
// from standing claims, corrections and the other journey's capacity fixtures.
async function statedUptimeMethodJourney() {
  const j = await openStatusJourney({ pageHost: 'localhost', workerEntry: 'tests/e2e/helpers/automation-clock-worker.ts' });
  let browser;
  const start = Date.UTC(2030, 0, 15, 12);
  const minute = 60_000;
  const iso = at => new Date(at).toISOString();
  const advance = async at => assert.equal((await j.raw('/test/clock', { method: 'PUT', body: JSON.stringify({ now: at }) })).status, 204);
  const snapshotAt = (path, at) => eventually(async () => {
    const response = await j.publicResponse(path);
    assert.equal(response.status, 200, path);
    return { generatedAt: response.headers.get('x-lamp-snapshot-generated-at'), text: await response.text() };
  }, result => result.generatedAt === iso(at), `${path} reflects the controlled publication instant`);
  try {
    await advance(start);
    await j.signIn(undefined, { fresh: true });
    const component = await j.component('Synthetic Lamp publication uptime');
    assert.equal(component.createdAt, iso(start));
    await advance(start + 60 * minute);
    const savedSettings = (await j.json('/api/app/page-settings')).settings;
    const settings = Object.fromEntries(['pageName', 'tagline', 'accentColor', 'timezone', 'hostname', 'mailFromAddress', 'template', 'footerCreditEnabled', 'widgetAllowedOrigins'].map(key => [key, savedSettings[key]]));
    await j.json('/api/app/page-settings', 'PUT', { ...settings, pageName: 'Synthetic Lamp uptime method' });
    const before = JSON.parse((await snapshotAt('/api/public/v1/components', start + 60 * minute)).text).data;
    assert.deepEqual(before.map(row => [row.id, row.state, row.uptime.percentage, row.uptime.coverageMinutes]), [[component.id, 'Operational', '100.00%', 60]]);

    const incident = await j.incident('Synthetic Lamp timed publication', [component]);
    await j.save(incident.id, { nextUpdateAt: iso(start + 120 * minute) });
    const published = (await j.publish(incident.id)).update;
    assert.equal(published.publishedAt, iso(start + 60 * minute));
    const active = await j.read(incident.id);
    assert.deepEqual(active.components.map(row => [row.componentId, row.state]), [[component.id, 'Major outage']]);
    await j.visible('/', incident.title);
    const during = JSON.parse(await j.publicText('/api/public/v1/components')).data;
    assert.equal(during.find(row => row.id === component.id).state, 'Major outage');

    await advance(start + 90 * minute);
    await j.save(incident.id, { lifecycle: 'Resolved', customerImpact: 'Synthetic Lamp requests have recovered.', nextUpdateAt: null });
    const resolved = (await j.publish(incident.id)).update;
    assert.equal(resolved.publishedAt, iso(start + 90 * minute));
    assert.equal((await j.read(incident.id)).resolvedAt, iso(start + 90 * minute));
    const after = JSON.parse((await snapshotAt('/api/public/v1/components', start + 90 * minute)).text).data;
    assert.equal(after.length, 1);
    assert.equal(after[0].id, component.id);
    assert.equal(after[0].state, 'Operational');
    // Sixty healthy minutes, then thirty published outage minutes: 60 of 90
    // available minutes, rounded down. No production arithmetic is imported.
    assert.equal(after[0].uptime.coverageMinutes, 90);
    assert.equal(after[0].uptime.percentage, '66.66%');
    assert.ok(parseFloat(after[0].uptime.percentage) < parseFloat(before[0].uptime.percentage));
    assert.equal(after[0].uptime.marks.reduce((sum, mark) => sum + (mark.downtimeMinutes ?? 0), 0), 30);
    const history = (await j.json(`/api/app/components/${component.id}/history`)).history;
    for (const [at, state] of [[start + 60 * minute, 'Major outage'], [start + 90 * minute, 'Operational']]) {
      assert.ok(history.some(row => row.causeId === incident.id && row.changedAt === iso(at) && row.newState === state));
    }

    const html = (await snapshotAt('/', start + 90 * minute)).text;
    const nodes = descendants(parse(html));
    const section = nodes.find(node => hasClass(node, 'component-health'));
    assert.ok(section, 'initial HTML places the method beside the component figures');
    const componentRows = descendants(section).filter(node => node.tagName === 'article' && hasClass(node, 'component')
      && descendants(node).some(child => child.tagName === 'h4' && nodeText(child) === component.name));
    assert.equal(componentRows.length, 1);
    const figure = descendants(componentRows[0]).find(node => hasClass(node, 'uptime-number'));
    assert.equal(nodeText(figure), '66.66% over 1 hour 30 minutes', 'the associated initial-HTML figure agrees with the public collection');
    const method = descendants(section).find(node => hasClass(node, 'availability-method'));
    assert.ok(method, 'the method is present before scripting runs');
    const methodText = nodeText(method);
    for (const expected of [
      'Operational counts as 0 downtime minutes',
      'Under maintenance counts as 0 downtime minutes',
      'Degraded performance counts as 0.5 downtime minutes',
      'Partially unavailable counts as 1 downtime minute',
      'Major outage counts as 1 downtime minute',
      'Uptime uses a 90-day window',
    ]) assert.ok(methodText.includes(expected), `initial HTML explains ${expected}`);

    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(j.publicOrigin);
    const visibleComponent = page.locator('article.component').filter({ has: page.getByRole('heading', { name: component.name, exact: true }) });
    assert.equal(await visibleComponent.locator('.uptime-number').innerText(), '66.66% over 1 hour 30 minutes');
    await page.getByText('How availability is calculated', { exact: true }).click();
    assert.equal(await page.locator('.availability-method p').innerText(), nodeText(descendants(method).find(node => node.tagName === 'p')));
    if (process.env.LAMP_SCREENSHOTS) {
      await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-stated-uptime-method.png`, fullPage: true });
      }
    }
  } finally { await browser?.close(); await j.close(); }
}

// One catalogue-to-customer journey: no renderer or uptime helper is imported.
test('SUB-019 PAGE-001 PAGE-002 PAGE-003 PAGE-004 PAGE-007 PAGE-008 PAGE-009 PAGE-010 PAGE-011 PAGE-012 PAGE-013 PAGE-014 PAGE-016 PAGE-017 PAGE-018 PAGE-019 PAGE-020 COMP-001 COMP-002 COMP-003 COMP-004 COMP-005 COMP-007 COMP-009 COMP-010 UPTIME-001 UPTIME-002 UPTIME-003 UPTIME-004 UPTIME-005 UPTIME-006 MOVE-009 — owner maintains a complete catalogue and customers read, refresh, embed and retain its public story', async () => {
  await statedUptimeMethodJourney();
  const j = await openStatusJourney({ pageHost: 'localhost' });
  let browser;
  try {
    const settings = (await j.json('/api/app/page-settings')).settings;
    await j.json('/api/app/page-settings', 'PUT', {
      mailFromAddress: settings.mailFromAddress, pageName: 'Customer service status', tagline: 'Current service facts', accentColor: '#16794C',
      timezone: 'America/Los_Angeles', hostname: 'localhost', footerCreditEnabled: false,
      widgetAllowedOrigins: [j.publicOrigin],
    });
    const firstGroup = (await j.json('/api/app/component-groups', 'POST', { name: 'Customer services', displayOrder: 0 }, 201)).group;
    const secondGroup = (await j.json('/api/app/component-groups', 'POST', { name: 'Platform services', displayOrder: 1 }, 201)).group;
    const main = await j.component('Public API', { groupId: firstGroup.id, note: 'Requests remain safe to retry.', displayOrder: 0 });
    const other = await j.component('Dashboard', { groupId: firstGroup.id, displayOrder: 1, onlyShowIfDegraded: true });
    const hidden = await j.component('PRIVATE database replica', { groupId: secondGroup.id, internal: true, note: 'PRIVATE topology' });
    const limits = JSON.parse(await readFile('seed.json', 'utf8')).limits;
    const beforeCatalogue = await j.json('/api/app/components/bulk');
    const catalogue = { ...beforeCatalogue.catalogue, components: [...beforeCatalogue.catalogue.components] };
    for (let index = catalogue.components.length; index < limits.components.value; index++) {
      catalogue.components.push({ id: String(index).padStart(26, '0'), name: `Service ${index}`, groupId: secondGroup.id, description: '', internal: false, displayOrder: index, note: '', onlyShowIfDegraded: false, uptimeStartDate: null });
    }
    const review = await j.json('/api/app/components/bulk/preview', 'POST', { catalogue, revision: beforeCatalogue.revision });
    await j.json('/api/app/components/bulk/apply', 'POST', { catalogue: review.catalogue, revision: review.revision, reviewToken: review.reviewToken });
    await j.json('/api/app/components/bulk/apply', 'POST', { catalogue: review.catalogue, revision: review.revision, reviewToken: review.reviewToken }, 409);
    let html = await j.visible('/', 'Customer service status');
    assert.ok(html.indexOf(firstGroup.name) < html.indexOf(secondGroup.name));
    assert.ok(!html.includes(other.name), 'a healthy conditional component stays out of the public catalogue');
    assert.ok(html.includes(main.note));
    assert.ok(!html.includes(hidden.name) && !html.includes('PRIVATE topology'));
    assert.ok(html.includes('<form method="post" action="/subscribe">'));
    assert.ok(html.includes('data-local-time'));
    assert.ok(gzipSync(Buffer.from(html)).byteLength <= limits.snapshotMaxBytesGzipped.value, 'the declared catalogue remains usable at its public HTML budget');
    const ownAssets = [...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"/g)].map(match => match[1]);
    assert.ok(ownAssets.every(path => path.startsWith('/')));
    const initial = await j.publicResponse('/');
    const validator = initial.headers.get('etag');
    assert.ok(validator);
    assert.equal((await j.raw(new URL('/', j.publicOrigin).href, { headers: { 'If-None-Match': validator } })).status, 304);
    await initial.arrayBuffer();
    const requests = await Promise.all(Array.from({ length: limits.publicPageRequestsPerSecond.value }, () => fetch(j.publicOrigin + '/')));
    for (const response of requests) { assert.equal(response.status, 200); await response.arrayBuffer(); }
    for (const path of ['/', '/history', '/feed.atom', '/feed.rss', '/widget.js', '/api/public/status', '/badge.svg']) {
      const response = await j.publicResponse(path);
      assert.equal(response.status, 200, path);
      const csp = response.headers.get('content-security-policy');
      for (const directive of ['default-src', 'script-src', 'style-src', 'img-src', 'connect-src', 'form-action', 'base-uri']) assert.ok(csp.includes(`${directive} ${j.publicOrigin}`), path);
      assert.ok(csp.includes("frame-ancestors 'none'"));
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      await response.arrayBuffer();
    }
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAF/gL+3N9nPwAAAABJRU5ErkJggg==', 'base64');
    const logo = new FormData(); logo.set('logo', new Blob([png], { type: 'image/png' }), 'company.png');
    // Serialize multipart at the HTTP boundary: Node's FormData and workerd's
    // FormData are different realms when dispatching directly into Miniflare.
    const multipart = new Request(j.appOrigin + '/api/app/page-settings/logo', { method: 'POST', body: logo });
    const upload = await j.request('/api/app/page-settings/logo', { method: 'POST', headers: { 'Content-Type': multipart.headers.get('Content-Type') }, body: await multipart.arrayBuffer() });
    assert.equal(upload.status, 200, await upload.clone().text());
    const originalLogo = await j.publicResponse('/assets/logo');
    assert.equal(originalLogo.status, 200);
    assert.deepEqual(Buffer.from(await originalLogo.arrayBuffer()), png);
    for (const path of ['/assets/favicon.svg', '/assets/og.svg']) { const response = await j.publicResponse(path); assert.equal(response.status, 200); assert.ok((await response.text()).includes('data:image/png')); }

    await publicCapacityJourney(j, limits);
    // The maximum catalogue was read and load-checked above. Keep the public
    // customer journey representative instead of rebuilding that capacity load
    // after every unrelated operator edit.
    const populatedCatalogue = await j.json('/api/app/components/bulk');
    const customerCatalogue = { ...populatedCatalogue.catalogue, components: populatedCatalogue.catalogue.components.filter(row => [main.id, other.id, hidden.id].includes(row.id)) };
    const customerReview = await j.json('/api/app/components/bulk/preview', 'POST', { catalogue: customerCatalogue, revision: populatedCatalogue.revision });
    await j.json('/api/app/components/bulk/apply', 'POST', { catalogue: customerReview.catalogue, revision: customerReview.revision, reviewToken: customerReview.reviewToken });

    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const scripted = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/New_York' });
    const page = await scripted.newPage();
    await page.clock.install();
    await page.goto(j.publicOrigin);
    assert.equal(await page.locator('#status-live').getAttribute('aria-live'), 'polite');
    const generation = page.locator('[data-generated-at] time');
    assertVisibleTime(await generation.getAttribute('title'), await generation.getAttribute('datetime'), 'America/Los_Angeles');
    await j.json(`/api/app/components/${other.id}/standing-claim`, 'PUT', { state: 'Degraded performance' });
    const incident = await j.incident('API outage under investigation', [main, hidden]);
    await j.save(incident.id); await j.publish(incident.id);
    await j.visible('/', incident.title);
    const firstStatus = await (await j.publicResponse('/api/public/status')).json();
    assert.ok((await j.publicText('/')).includes(other.name), 'a degraded conditional component becomes public');
    const badge = await (await j.publicResponse('/badge.json')).json();
    assert.ok(JSON.stringify(badge).includes('Major outage'));
    assert.ok((await j.publicText('/badge.svg')).includes('Major outage'));
    const polled = page.waitForResponse(response => response.url().endsWith('/api/public/status') && response.status() === 200);
    await page.clock.fastForward(30000);
    const refreshed = await (await polled).json();
    assert.equal(refreshed.incident.reference, incident.reference);
    await page.waitForFunction(summary => document.querySelector('#status-live').textContent.includes(summary), refreshed.incident.summary);
    assert.equal(await page.locator('[data-newest-update]').innerText(), refreshed.incident.summary);
    assertVisibleTime(await generation.getAttribute('title'), await generation.getAttribute('datetime'), 'America/Los_Angeles');
    assert.ok((await page.locator('#status-live').innerText()).includes('Major outage'));
    assert.equal((await j.json('/api/app/components')).components.find(row => row.id === main.id).publicState, 'Major outage');
    assert.ok(firstStatus.generatedAt);
    const permalink = await j.publicText(`/incidents/${incident.reference}`);
    assert.ok(permalink.includes(incident.title) && permalink.includes(main.name));
    assert.match(permalink, /Get updates on this incident/);
    assert.match(permalink, /action="\/subscribe\/incident"/);
    assert.ok(permalink.includes(`name="incidentId" value="${incident.id}"`));
    assert.ok(gzipSync(Buffer.from(permalink)).byteLength <= limits.snapshotMaxBytesGzipped.value, 'SUB-019 retains the initial incident document gzip budget');
    const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
    try {
      const staticPage = await staticContext.newPage();
      assert.equal((await staticPage.goto(j.publicOrigin + '/incidents/' + incident.reference)).status(), 200);
      const form = staticPage.locator('form[action="/subscribe/incident"]').first();
      assert.equal(await form.getAttribute('method'), 'post');
      assert.equal(await form.getByLabel('Email address', { exact: true }).count(), 1, 'SUB-019 is usable in the initial document without script');
      assert.ok(await staticPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the script-free incident form fits its public document');
    } finally { await staticContext.close(); }
    assert.ok(!permalink.includes(hidden.name));
    const feedBefore = await j.publicText('/feed.atom');
    assert.ok(feedBefore.includes(incident.reference));
    const firstIds = [...feedBefore.matchAll(/<id>([^<]+)<\/id>/g)].map(match => match[1]);
    await j.save(incident.id, { lifecycle: 'Resolved', customerImpact: 'API requests are working again.', nextUpdateAt: null }); await j.publish(incident.id);
    await j.visible('/history', incident.title);
    const feedAfter = await j.publicText('/feed.atom');
    for (const id of firstIds) assert.ok(feedAfter.includes(id), 'earlier public feed identifiers survive a later update');
    assert.equal((await j.json('/api/app/components')).components.find(row => row.id === main.id).publicState, 'Operational');
    assert.equal((await (await j.publicResponse('/api/public/status')).json()).overall, 'Degraded performance', 'resolving an incident retains another component\'s standing claim');
    await j.json(`/api/app/components/${other.id}/standing-claim`, 'PUT', { state: 'Operational' });
    await eventually(() => j.publicText('/'), body => !body.includes(other.name), 'recovery hides the conditional component again');

    // A closed correction is an operator business operation. Its reported
    // downtime, original facts and audit attribution agree through public APIs.
    const originalHistory = (await j.json(`/api/app/components/${main.id}/history`)).history;
    const endsAt = new Date(Date.now() - 3600000).toISOString();
    const startsAt = new Date(Date.parse(endsAt) - 7200000).toISOString();
    const correction = { state: 'Degraded performance', startsAt, endsAt, reason: 'Verified customer request logs' };
    await j.json(`/api/app/components/${main.id}/history-corrections`, 'POST', { ...correction, reason: '' }, 400);
    await j.json(`/api/app/components/${main.id}/history-corrections`, 'POST', correction, 204);
    const history = await j.json(`/api/app/components/${main.id}/history`);
    for (const row of originalHistory) assert.ok(history.history.some(entry => entry.id === row.id));
    assert.ok(history.corrections.some(row => row.reason === correction.reason));
    const month = startsAt.slice(0, 7);
    const report = await j.json(`/api/app/availability-report?component=${main.id}&month=${month}&format=json`);
    assert.ok(Number(report.downtimeMinutes) >= 60, 'partial degradation is charged rather than rounded away');
    assert.ok(parseFloat(report.uptime) < 100);
    assert.ok(report.method.includes('Degraded performance') && report.method.includes('Under maintenance'));
    const publicComponents = (await (await j.publicResponse('/api/public/v1/components')).json()).data;
    const publishedMain = publicComponents.find(row => row.id === main.id);
    assert.ok(parseFloat(publishedMain.uptime.percentage) < 100);
    assert.ok(publishedMain.uptime.marks.some(mark => mark.downtimeMinutes === null));
    assert.ok(publishedMain.uptime.marks.some(mark => mark.downtimeMinutes > 0));
    assert.ok(publishedMain.uptime.coverageMinutes < 86400, 'a new component does not invent a full historical reporting window');
    for (const path of ['/api/v2/summary.json', '/api/v2/components.json', '/api/v2/incidents.json', '/api/v2/scheduled-maintenances.json', '/api/public/v1/incidents', '/history.rss', '/history.atom', `/components/${publishedMain.slug}/feed.atom`, `/components/${publishedMain.slug}/feed.rss`]) assert.equal((await j.publicResponse(path)).status, 200, path);

    await page.reload();
    const loadWidget = async target => target.evaluate(url => new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = url; script.onload = resolve; script.onerror = reject; document.body.append(script);
    }), j.publicOrigin + '/widget.js');
    await loadWidget(page); await page.locator('section[role=status]').waitFor();
    const denied = await scripted.newPage(); await denied.setContent('<main>Unlisted embedding site</main>'); await loadWidget(denied);
    assert.equal(await denied.locator('section[role=status]').count(), 0); await denied.close();
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(audit.violations.filter(item => ['serious', 'critical'].includes(item.impact)), []);
    const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
    const plain = await noScript.newPage(); await plain.goto(j.publicOrigin);
    assert.ok((await plain.locator('body').innerText()).includes(main.name));
    await plain.locator('input[name=email]').fill('public-reader@example.test');
    await Promise.all([plain.waitForNavigation(), plain.locator('form[action="/subscribe"] button[type=submit]').click()]);
    await eventually(() => j.messages.find(message => message.to.includes('public-reader@example.test')), Boolean, 'plain form sends subscriber confirmation');
    const beforeDelete = await j.publicText('/history'); assert.ok(beforeDelete.includes(main.name));
    await j.json(`/api/app/components/${main.id}`, 'DELETE', undefined, 204);
    const afterDelete = await j.visible('/history', incident.title);
    assert.ok(afterDelete.includes(main.name), 'published history retains the name of a deleted component');
    const remaining = (await (await j.publicResponse('/api/public/v1/components')).json()).data;
    assert.ok(!remaining.some(row => row.id === main.id));
  } finally { await browser?.close(); await j.close(); }
});
