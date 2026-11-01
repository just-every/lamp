import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { openStatusJourney, eventually } from './helpers/status-journey.mjs';
import { assertVisibleTime } from '../helpers/public-meaning.mjs';
import { publicCapacityJourney } from './helpers/public-capacity-journey.mjs';

// One catalogue-to-customer journey: no renderer or uptime helper is imported.
test('SUB-019 PAGE-001 PAGE-002 PAGE-003 PAGE-004 PAGE-007 PAGE-008 PAGE-009 PAGE-010 PAGE-011 PAGE-012 PAGE-013 PAGE-014 PAGE-016 PAGE-017 PAGE-018 PAGE-019 PAGE-020 COMP-001 COMP-002 COMP-003 COMP-004 COMP-005 COMP-007 COMP-009 COMP-010 UPTIME-001 UPTIME-002 UPTIME-003 UPTIME-004 UPTIME-005 UPTIME-006 MOVE-009 — owner maintains a complete catalogue and customers read, refresh, embed and retain its public story', async () => {
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
    const other = (await j.json('/api/app/components', 'POST', {
      name: 'Dashboard', groupId: firstGroup.id, description: '', internal: false, displayOrder: 1, onlyShowIfDegraded: true,
    }, 201)).component;
    assert.equal(other.note, '', 'omitting the note at creation returns an empty note');
    assert.equal((await j.json('/api/app/components')).components.find(row => row.id === other.id).note, '', 'the empty default persists through an independent native read');
    const noteInput = { name: main.name, groupId: firstGroup.id, description: '', internal: false, displayOrder: 0 };
    const beforeInvalidNotes = await j.json('/api/app/components');
    await j.json('/api/app/components', 'POST', { ...noteInput, name: 'synthetic-lamp-overlength', note: 'n'.repeat(251) }, 400);
    await j.json(`/api/app/components/${main.id}`, 'PUT', { ...noteInput, note: 'n'.repeat(251) }, 400);
    await j.json(`/api/app/components/${main.id}`, 'PUT', noteInput, 400);
    assert.deepEqual(await j.json('/api/app/components'), beforeInvalidNotes, 'invalid notes and omitted edit notes leave the catalogue unchanged');
    const boundaryNote = '<state>&' + 'n'.repeat(242);
    const updated = (await j.json(`/api/app/components/${main.id}`, 'PUT', { ...noteInput, note: boundaryNote })).component;
    assert.equal(updated.note, boundaryNote);
    assert.equal((await j.json('/api/app/components')).components.find(row => row.id === main.id).note, boundaryNote);
    const boundaryHtml = await j.visible('/', boundaryNote);
    assert.ok(boundaryHtml.includes(`<p class="component-note">&lt;state&gt;&amp;${'n'.repeat(242)}</p>`), 'the full 250-character note is displayed as plain text beside the state');
    const cleared = (await j.json(`/api/app/components/${main.id}`, 'PUT', { ...noteInput, note: '' })).component;
    assert.equal(cleared.note, '', 'an explicit empty note still clears an existing note');
    assert.equal((await j.json('/api/app/components')).components.find(row => row.id === main.id).note, '');
    await j.json(`/api/app/components/${main.id}`, 'PUT', { ...noteInput, note: main.note });
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
    const monthParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit',
    }).formatToParts(new Date(startsAt));
    const month = `${monthParts.find(part => part.type === 'year').value}-${monthParts.find(part => part.type === 'month').value}`;
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
