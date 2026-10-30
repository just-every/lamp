import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';

// Historical observations are fixture prerequisites. Catalogue edits, metric
// ingestion, history corrections and every observed result use public doors.
export async function publicCapacityJourney(j, limits) {
  const original = await j.json('/api/app/components/bulk');
  const saved = (await j.json('/api/app/page-settings')).settings;
  const settings = Object.fromEntries(['pageName', 'tagline', 'accentColor', 'timezone', 'hostname', 'mailFromAddress', 'template', 'footerCreditEnabled', 'widgetAllowedOrigins'].map(key => [key, saved[key]]));
  const replace = async catalogue => {
    const { revision } = await j.json('/api/app/components/bulk');
    const review = await j.json('/api/app/components/bulk/preview', 'POST', { catalogue, revision });
    await j.json('/api/app/components/bulk/apply', 'POST', { catalogue: review.catalogue, revision: review.revision, reviewToken: review.reviewToken });
  };
  // Read the actual refresh bytes at both catalogue sizes, with no incident,
  // maintenance or state change that could change the reader's public story.
  const refresh = async () => {
    const response = await j.publicResponse('/api/public/status');
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    return { bytes, status: JSON.parse(bytes.toString('utf8')) };
  };
  const limitRefresh = await refresh();
  try {
    await replace({ ...original.catalogue, components: original.catalogue.components.slice(0, 1) });
    assert.equal((await j.json('/api/app/components/bulk')).catalogue.components.length, 1);
    const smallRefresh = await refresh();
    assert.notEqual(smallRefresh.status.generatedAt, limitRefresh.status.generatedAt, 'the small catalogue has its own published generation');
    const story = ({ generatedAt, ...status }) => status;
    assert.deepEqual(story(smallRefresh.status), { version: 1, overall: 'Operational', maintenance: null, incident: null });
    assert.deepEqual(story(limitRefresh.status), story(smallRefresh.status), 'catalogue size is the only changing public input');
    assert.equal(limitRefresh.bytes.byteLength, smallRefresh.bytes.byteLength, 'refresh response bytes do not grow from one component to the declared component limit');
  } finally {
    await replace(original.catalogue);
  }
  assert.equal((await j.json('/api/app/components/bulk')).catalogue.components.length, limits.components.value);
  const components = original.catalogue.components.map((row, index) => ({
    ...row, name: `Customer service ${index}`, internal: false, onlyShowIfDegraded: false, region: index % 2 ? 'North America' : 'Europe',
    description: (`Service ${index} availability information. ` + 'Customer-facing service. '.repeat(20)).slice(0, 280),
    note: (`Service ${index} current customer impact. ` + 'Requests remain available. '.repeat(20)).slice(0, 250),
  }));
  assert.equal(components.length, limits.components.value);
  const baseline = new Date(Date.now() - 91 * 86400_000).toISOString();
  for (let offset = 0; offset < components.length; offset += 50) {
    await j.db.batch(components.slice(offset, offset + 50).map(row => j.db.prepare(
      "INSERT INTO component_state_history(id,component_id,previous_state,new_state,cause_type,changed_at,created_at,updated_at) VALUES(?,?,'Operational','Operational','standing-claim',?,?,?)",
    ).bind(`capacity-history-${row.id}`, row.id, baseline, baseline, baseline)));
  }
  await replace({ ...original.catalogue, components });
  const metrics = [];
  let browser;
  try {
    const now = Date.now();
    const firstHour = components.at(-1), oneMinute = components.at(-2);
    const correction = async (component, startsAt, duration) => j.json(`/api/app/components/${component.id}/history-corrections`, 'POST', {
      state: 'Major outage', startsAt: new Date(startsAt).toISOString(), endsAt: new Date(startsAt + duration).toISOString(), reason: 'Verified historical customer request logs',
    }, 204);
    await correction(firstHour, now - 90 * 86400_000, 3600_000);
    await correction(oneMinute, now - 3600_000, 60_000);
    for (let index = 0; index < 10; index++) {
      const metric = (await j.json('/api/app/metrics', 'POST', { componentId: components[0].id, provider: 'push', name: `Customer API latency ${index + 1}`, unit: 'ms' }, 201)).metric;
      metrics.push(metric);
      const minute = Math.floor(Date.now() / 60_000) * 60_000;
      const points = Array.from({ length: 1440 }, (_, sample) => ({ at: minute - (1439 - sample) * 60_000, value: Math.round((100 + index + 25 * Math.sin(sample / 17)) * 100) / 100 }));
      await j.json(`/api/app/metrics/${metric.id}/points`, 'POST', { points });
    }
    await j.json('/api/app/metrics', 'POST', { componentId: components[0].id, provider: 'push', name: 'Excess metric', unit: 'ms' }, 400);
    assert.equal((await j.json('/api/app/metrics')).metrics.length, 10, 'an eleventh-metric refusal inserts nothing');
    const published = [];
    let cursor, generatedAt;
    do {
      const response = await j.publicResponse(`/api/public/v1/components${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(response.status, 200);
      generatedAt = response.headers.get('x-lamp-snapshot-generated-at');
      const body = await response.json(); published.push(...body.data); cursor = body.nextCursor;
    } while (cursor);
    assert.equal(published.length, limits.components.value, 'the full declared catalogue is visible');
    assert.equal(published.find(row => row.id === oneMinute.id).uptime.percentage, '99.99%', 'one minute of downtime never rounds up to a false all-clear');
    const boundary = published.find(row => row.id === firstHour.id).uptime;
    assert.equal(boundary.percentage, '99.95%', 'the first partial day of the trailing ninety days contributes downtime');
    assert.equal(boundary.coverageMinutes, 90 * 24 * 60);
    const expectedMinutes = Math.max(0, (now + 3600_000 - Date.parse(generatedAt)) / 60_000);
    assert.ok(Math.abs(boundary.marks.reduce((sum, mark) => sum + (mark.downtimeMinutes ?? 0), 0) - expectedMinutes) < 0.001, 'the daily record includes all downtime inside the exact partial boundary');

    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true, args: ['--no-sandbox'] });
    for (const template of ['default', 'calm', 'uptime', 'regions']) {
      await j.json('/api/app/page-settings', 'PUT', { ...settings, template });
      const html = await j.publicText('/');
      assert.equal((html.match(/data-metric-chart=/g) ?? []).length, 10, `${template} displays all ten full-day series`);
      assert.ok(html.includes(components[0].note), `${template} retains the populated maximum-length note`);
      assert.ok(gzipSync(Buffer.from(html)).byteLength <= limits.snapshotMaxBytesGzipped.value, `${template}: ten charts and the full component catalogue fit the gzip budget`);
      const context = await browser.newContext();
      const page = await context.newPage(), resources = new Map(), foreign = new Set();
      page.on('request', request => {
        const url = new URL(request.url());
        if (request.resourceType() === 'document' || !['http:', 'https:'].includes(url.protocol)) return;
        if (url.origin === j.publicOrigin) resources.set(url.pathname, request.resourceType());
        else foreign.add(url.href);
      });
      await page.goto(j.publicOrigin, { waitUntil: 'networkidle' });
      assert.ok(resources.size <= 4, `${template}: at most four initial asset requests: ${[...resources.keys()]}`);
      for (const path of resources.keys()) {
        const asset = await j.publicResponse(path);
        assert.equal(asset.status, 200, path);
        assert.match(asset.headers.get('content-type'), /^(?:text\/(?:css|javascript)|application\/(?:javascript|font-woff)|font\/|image\/)/, `initial dependency ${path} is a stylesheet, font, logo or script`);
        await asset.arrayBuffer();
      }
      assert.deepEqual([...foreign], [], `${template}: every initial request stays on the status origin`);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        assert.equal(await page.locator('[data-metric-chart]').count(), 10);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const resources = page.locator('footer details.footer-resources');
        if (await resources.getAttribute('open') === null) await resources.locator('summary').click();
        assert.equal(await page.getByRole('link', { name: 'Maintenance calendar', exact: true }).getAttribute('href'), '/maintenance.ics');
        if (process.env.LAMP_SCREENSHOTS) {
          await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
          await page.locator('footer').screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-calendar-footer-${template}.png` });
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-capacity-${template}.png` });
        }
      }
      await context.close();
    }
  } finally {
    await browser?.close();
    for (const metric of metrics) await j.json(`/api/app/metrics/${metric.id}`, 'DELETE');
    for (let offset = 0; offset < components.length; offset += 50) await j.db.batch(components.slice(offset, offset + 50).map(row => j.db.prepare('DELETE FROM component_state_history WHERE id=?').bind(`capacity-history-${row.id}`)));
    await replace(original.catalogue);
    await j.json('/api/app/page-settings', 'PUT', settings);
  }
}
