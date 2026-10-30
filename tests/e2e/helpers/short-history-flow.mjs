import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { openStatusJourney, eventually } from './status-journey.mjs';

// HTTP, D1, Queue publication and rendering share the Worker's clock. No uptime
// implementation is imported and no history or snapshot is inserted by the test.
export async function shortHistoryFlow() {
  const j = await openStatusJourney({ pageHost: 'localhost', workerEntry: 'tests/e2e/helpers/automation-clock-worker.ts' });
  let browser;
  const first = Date.parse('2031-04-03T12:00:00.000Z');
  const olderStart = Date.parse('2031-04-01T12:00:00.000Z');
  const clock = async now => {
    const response = await j.raw(j.appOrigin + '/test/clock', { method: 'PUT', body: JSON.stringify({ now }) });
    assert.equal(response.status, 204, await response.text());
  };
  try {
    await clock(olderStart);
    await j.signIn(undefined, { fresh: true });
    const older = await j.component('Synthetic Lamp established service');
    await clock(first);
    await j.signIn(undefined, { fresh: true });
    const observed = await j.component('Synthetic Lamp newly observed service');
    const history = (await j.json(`/api/app/components/${observed.id}/history`)).history;
    assert.equal(history.length, 1);
    assert.ok(history.every(row => row.changedAt === '2031-04-03T12:00:00.000Z'));

    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const coverage = async (now, expected) => {
      const generatedAt = new Date(now).toISOString();
      const collection = await eventually(async () => {
        const response = await j.publicResponse('/api/public/v1/components');
        if (response.status === 404 || response.status === 503) return null;
        assert.equal(response.status, 200, await response.clone().text());
        return response.json();
      }, result => result?.generatedAt === generatedAt && expected.every(([component]) => result.data.some(row => row.id === component.id)), 'the native component publication reaches the controlled instant');
      assert.equal((await page.goto(j.publicOrigin)).status(), 200);
      assert.equal(await page.locator('[data-generated-at] time').getAttribute('datetime'), generatedAt);
      for (const [component, trackingSince, minutes, days, percentage, label] of expected) {
        const published = collection.data.find(row => row.id === component.id);
        assert.equal(published.uptime.trackingSince, trackingSince, component.name);
        assert.equal(published.uptime.coverageMinutes, minutes, component.name);
        assert.equal(published.uptime.coverageDays, days, component.name);
        assert.equal(published.uptime.percentage, percentage, component.name);
        const article = page.locator('article.component').filter({ has: page.getByRole('heading', { name: component.name, exact: true }) });
        assert.equal(await article.count(), 1, 'the label belongs to the expected component');
        assert.equal(await article.locator('.uptime-number').innerText(), label, component.name);
        if (minutes === 0) assert.ok(published.uptime.marks.every(mark => mark.downtimeMinutes === null), 'zero elapsed time invents neither a percentage nor daily observations');
      }
      return collection;
    };
    const started = '2031-04-03T12:00:00.000Z';
    const republish = async seconds => {
      await clock(first + seconds * 1000);
      // An ordinary saved note requests a fresh snapshot without adding history.
      await j.json(`/api/app/components/${observed.id}`, 'PUT', {
        name: observed.name, groupId: null, description: '', internal: false, displayOrder: 0,
        note: `Synthetic Lamp coverage checkpoint ${seconds}`,
      });
    };

    await coverage(first, [[observed, started, 0, 0, null, 'No data']]);
    await republish(30);
    await coverage(first + 30_000, [[observed, started, 0.5, 0, '100.00%', '100.00% over less than 1 minute']]);
    await clock(first + 60_000);
    await j.json(`/api/app/components/${observed.id}/standing-claim`, 'PUT', { state: 'Major outage' });
    await coverage(first + 60_000, [[observed, started, 1, 0, '100.00%', '100.00% over 1 minute']]);
    await clock(first + 120_000);
    await j.json(`/api/app/components/${observed.id}/standing-claim`, 'PUT', { state: 'Operational' });
    // One observed minute down and one up is 50%, even though another component
    // has two days of history. Earlier unobserved time cannot dilute the outage.
    await coverage(first + 120_000, [[observed, started, 2, 0, '50.00%', '50.00% over 2 minutes']]);

    await clock(first + 3_960_000);
    const minute = await j.component('Synthetic Lamp one minute service');
    await clock(first + 3_990_000);
    const seconds = await j.component('Synthetic Lamp thirty second service');
    await clock(first + 4_020_000);
    const empty = await j.component('Synthetic Lamp no elapsed service');
    await coverage(first + 4_020_000, [
      [older, '2031-04-01T12:00:00.000Z', 2947, 2, '100.00%', '100.00% over 2 whole days'],
      [observed, started, 67, 0, '98.50%', '98.50% over 1 hour 7 minutes'],
      [minute, '2031-04-03T13:06:00.000Z', 1, 0, '100.00%', '100.00% over 1 minute'],
      [seconds, '2031-04-03T13:06:30.000Z', 0.5, 0, '100.00%', '100.00% over less than 1 minute'],
      [empty, '2031-04-03T13:07:00.000Z', 0, 0, null, 'No data'],
    ]);
    const proof = process.env.LAMP_UPTIME_PROOF_DIRECTORY || './test-results/short-history';
    await mkdir(proof, { recursive: true });
    await page.screenshot({ path: join(proof, 'coverage-1440.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(proof, 'coverage-390.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await clock(first + 86_399_000);
    await j.signIn(undefined, { fresh: true });
    await republish(86_399);
    await coverage(first + 86_399_000, [[observed, started, 86_399 / 60, 0, '99.93%', '99.93% over 23 hours 59 minutes']]);
    await republish(86_400);
    await coverage(first + 86_400_000, [[observed, started, 1440, 1, '99.93%', '99.93% over 1 whole day']]);
    await clock(first + 173_220_000);
    await j.signIn(undefined, { fresh: true });
    await republish(173_220);
    await coverage(first + 173_220_000, [[observed, started, 2887, 2, '99.96%', '99.96% over 2 whole days']]);
  } finally { await browser?.close(); await j.close(); }
}
