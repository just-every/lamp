import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { openStatusJourney } from './status-journey.mjs';

// A frozen business calendar crosses midnight and the spring clock change.
// Corrections go through the same native door an owner uses to repair history.
export async function publicDailyRecordJourney(t) {
  const j = await openStatusJourney({ pageHost: 'localhost', workerEntry: 'tests/e2e/helpers/automation-clock-worker.ts' });
  const now = Date.parse('2030-03-20T19:00:00.000Z'), day = 86_400_000, minute = 60_000;
  const windowStart = now - 90 * day, timezone = ['America', 'Los_Angeles'].join('/');
  const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateOf = at => calendar.format(new Date(at));
  const dates = [];
  for (let at = Date.parse(`${dateOf(windowStart)}T12:00:00Z`); at <= Date.parse(`${dateOf(now)}T12:00:00Z`); at += day) dates.push(new Date(at).toISOString().slice(0, 10));
  let browser;
  try {
    assert.equal((await j.raw(j.appOrigin + '/test/clock', { method: 'PUT', body: JSON.stringify({ now }) })).status, 204);
    await j.signIn(undefined, { fresh: true });
    const settings = (await j.json('/api/app/page-settings')).settings;
    const saved = Object.fromEntries(['pageName', 'tagline', 'accentColor', 'hostname', 'mailFromAddress', 'footerCreditEnabled', 'widgetAllowedOrigins'].map(key => [key, settings[key]]));
    const full = await j.component('Synthetic Lamp full daily history', { region: 'Europe' });
    const recent = await j.component('Synthetic Lamp recent daily history', { region: 'North America' });
    const healthy = await j.component('Synthetic Lamp healthy daily history', { region: 'Europe' });
    const untracked = await j.component('Synthetic Lamp not yet tracked', { region: 'North America' });
    const cases = [
      { component: full, since: windowStart - day, intervals: [
        { from: windowStart - day, to: windowStart - day + minute, state: 'Operational', weight: 0 },
        { from: windowStart - 15 * minute, to: windowStart + 90 * minute, state: 'Major outage', weight: 1 },
      ] },
      { component: recent, since: Date.parse('2030-03-09T07:45:00Z'), intervals: [
        { from: Date.parse('2030-03-09T07:45:00Z'), to: Date.parse('2030-03-09T08:15:00Z'), state: 'Degraded performance', weight: 0.5 },
        { from: Date.parse('2030-03-09T18:00:00Z'), to: Date.parse('2030-03-09T18:20:00Z'), state: 'Partially unavailable', weight: 1 },
        { from: Date.parse('2030-03-10T09:30:00Z'), to: Date.parse('2030-03-10T10:30:00Z'), state: 'Major outage', weight: 1 },
      ] },
      { component: healthy, since: Date.parse('2030-03-15T19:00:00Z'), intervals: [
        { from: Date.parse('2030-03-15T19:00:00Z'), to: Date.parse('2030-03-15T19:01:00Z'), state: 'Operational', weight: 0 },
      ] },
      { component: untracked, since: now, intervals: [] },
    ];
    for (const { component, intervals } of cases) for (const interval of intervals) {
      await j.json(`/api/app/components/${component.id}/history-corrections`, 'POST', {
        state: interval.state, startsAt: new Date(interval.from).toISOString(), endsAt: new Date(interval.to).toISOString(), reason: 'Synthetic Lamp independently verified daily history',
      }, 204);
    }
    // Enumerate real elapsed minutes independently of the product's segment
    // calculation. A repeated or skipped local hour never invents minutes.
    const expected = new Map(cases.map(({ component, since, intervals }) => {
      const marks = dates.map(date => ({ day: date, downtimeMinutes: since >= now || date < dateOf(since) ? null : 0 }));
      for (const interval of intervals) for (let at = Math.max(windowStart, interval.from); at < Math.min(now, interval.to); at += minute) {
        const mark = marks.find(mark => mark.day === dateOf(at));
        mark.downtimeMinutes += interval.weight;
      }
      return [component.id, marks];
    }));
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    for (const template of ['default', 'calm', 'uptime', 'regions']) {
      await j.json('/api/app/page-settings', 'PUT', { ...saved, timezone, template });
      const response = await j.publicResponse('/api/public/v1/components');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-lamp-snapshot-generated-at'), new Date(now).toISOString());
      const { data, nextCursor } = await response.json();
      assert.equal(nextCursor, null);
      assert.deepEqual(data.map(row => row.id).sort(), cases.map(row => row.component.id).sort(), `${template}: reconcile the complete public component inventory`);
      for (const row of data) {
        assert.deepEqual(row.uptime.marks.map(({ day, downtimeMinutes }) => ({ day, downtimeMinutes })), expected.get(row.id), `${template}: ${row.name} has every independently expected date and minute`);
      }
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
      try {
        const page = await context.newPage();
        await page.goto(j.publicOrigin, { waitUntil: 'networkidle' });
        if (template === 'regions') for (const detail of await page.locator('details.rg-row').all()) await detail.locator('summary').click();
        const records = page.locator('[role="list"][aria-label*="-day uptime record for "]');
        assert.equal(await records.count(), cases.length, `${template}: every component has its own rendered daily record`);
        for (const row of data) {
          const record = page.getByRole('list', { name: `90-day uptime record for ${row.name}`, exact: true });
          assert.equal(await record.count(), 1, `${template}: associate the rendered record with public component ${row.id}`);
          const rendered = await record.getByRole('listitem').evaluateAll(marks => marks.map(mark => ({ label: mark.getAttribute('aria-label'), title: mark.getAttribute('title') })));
          const marks = expected.get(row.id);
          assert.deepEqual(rendered.map(mark => mark.label.slice(0, 10)), dates, `${template}: ${row.name} retains the complete date inventory`);
          for (let index = 0; index < marks.length; index++) {
            const { day, downtimeMinutes } = marks[index], { label, title } = rendered[index];
            const expectedLabel = downtimeMinutes === null ? `${day}: no data` : downtimeMinutes === 0 ? `${day}: no downtime` : `${day}: Downtime ${downtimeMinutes} minutes (weighted)`;
            assert.equal(label.split(';')[0], expectedLabel, `${template}: exact daily label for ${row.name}`);
            assert.equal(title, label, `${template}: the visible hover label agrees with the accessible label`);
          }
        }
        const noData = page.getByRole('list', { name: `90-day uptime record for ${recent.name}`, exact: true }).getByRole('listitem', { name: `${dates[0]}: no data`, exact: true });
        const zero = page.getByRole('list', { name: `90-day uptime record for ${recent.name}`, exact: true }).getByRole('listitem', { name: '2030-03-19: no downtime', exact: true });
        const appearance = mark => mark.evaluate(element => {
          const style = getComputedStyle(element), rect = element.getBoundingClientRect();
          return { background: style.backgroundColor, opacity: style.opacity, width: rect.width, height: rect.height };
        });
        const [none, good] = await Promise.all([appearance(noData), appearance(zero)]);
        assert.ok(none.width > 0 && none.height > 0 && good.width > 0 && good.height > 0, `${template}: both day states are displayed`);
        assert.notDeepEqual([none.background, none.opacity], [good.background, good.opacity], `${template}: no data is visibly different from healthy zero downtime`);
        const fullRecord = page.getByRole('list', { name: `90-day uptime record for ${full.name}`, exact: true });
        const tops = await fullRecord.getByRole('listitem').evaluateAll(marks => marks.map(mark => mark.getBoundingClientRect().y));
        assert.ok(tops.every(y => Math.abs(y - tops[0]) < 1), `${template}: all daily marks remain on their component's row`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${template}: the record fits the page`);
        // Assertions run at one width; capture both viewport proofs and their
        // existing computed styles without duplicating the browser journey.
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
          const [none, good] = await Promise.all([appearance(noData), appearance(zero)]);
          if (process.env.LAMP_SCREENSHOTS) {
            await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
            await page.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-daily-record-${template}.png`, fullPage: true });
          }
          t.diagnostic(`UPTIME-006 ${template} at ${width}: four associated daily records; ${dates.length} dates each; exact 90, 7.5, 27.5 and 60 weighted-minute labels; no-data and healthy computed backgrounds ${none.background} and ${good.background}.`);
        }
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); await j.close(); }
}

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
    // Isolate each supplied weight from incidents and the boundary controls.
    // A completed UTC afternoon fits one Los Angeles day in either offset;
    // its own date selects the report, even when the journey crosses a month.
    const weightStart = Math.floor(now / 86400_000) * 86400_000 - 2 * 86400_000 + 16 * 3600_000;
    const weightStartsAt = new Date(weightStart).toISOString();
    const weightEndsAt = new Date(weightStart + 30 * 60_000).toISOString();
    const weights = [
      { component: components.at(-3), state: 'Major outage', expectedMinutes: 30 },
      { component: components.at(-4), state: 'Partially unavailable', expectedMinutes: 30 },
      { component: components.at(-5), state: 'Degraded performance', expectedMinutes: 15 },
      { component: components.at(-6), state: 'Under maintenance', expectedMinutes: 0 },
    ];
    for (const { component, state } of weights) {
      await j.json(`/api/app/components/${component.id}/history-corrections`, 'POST', {
        state, startsAt: weightStartsAt, endsAt: weightEndsAt, reason: 'Verified isolated service interval',
      }, 204);
      const history = await j.json(`/api/app/components/${component.id}/history`);
      assert.ok(history.corrections.some(row => row.state === state && row.startsAt === weightStartsAt && row.endsAt === weightEndsAt), `${state}: the closed interval is recorded`);
    }
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
    for (const { component, state, expectedMinutes } of weights) {
      const uptime = published.find(row => row.id === component.id).uptime;
      assert.equal(uptime.marks.find(mark => mark.day === weightStartsAt.slice(0, 10)).downtimeMinutes, expectedMinutes, `${state}: public daily weighted minutes`);
      assert.equal(uptime.marks.reduce((sum, mark) => sum + (mark.downtimeMinutes ?? 0), 0), expectedMinutes, `${state}: no downtime leaks outside the closed interval`);
      const report = await j.json(`/api/app/availability-report?component=${component.id}&month=${weightStartsAt.slice(0, 7)}&format=json`);
      assert.equal(report.component.id, component.id);
      assert.equal(report.downtimeMinutes, expectedMinutes.toFixed(2), `${state}: availability report weighted minutes`);
    }

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
