import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openTrafficAlertsRuntime } from './traffic-alerts-runtime.mjs';
import { operatorHydrated } from './operator-hydrated.mjs';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
async function eventually(read, predicate, message) {
  let result;
  for (let attempt = 0; attempt < 100; attempt++) {
    result = await read();
    if (predicate(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`${message}: ${JSON.stringify(result)}`);
}
const keyAt = (surface, at) => `traffic/counts/${surface}/${Math.floor(at / HOUR)}/`;

/** HIST-006 is exercised through the built Worker's public request, owner
 * configuration and scheduled-alert doors. Controlled requests are local only. */
export async function trafficAlertsFlow(t) {
  const fixture = await openTrafficAlertsRuntime({ diagnostic: message => t?.diagnostic(message) });
  t?.diagnostic('HIST-006 production fixture started');
  const { runtime, env, api, post, publicOrigin, origin } = fixture;
  const bucket = env.SNAPSHOTS;
  const trafficMail = () => fixture.messages.filter(message => message.subject === 'Public-page traffic spike');
  const alerts = () => trafficMail().filter(message => /page: \d+ requests/.test(message.text));
  const rows = async (surface, at) => {
    const objects = await bucket.list({ prefix: keyAt(surface, at) });
    return (await Promise.all(objects.objects.map(async object => (await bucket.get(object.key)).json()))).flat();
  };
  const minuteCount = async (surface, at) => (await rows(surface, at)).filter(row => row.minute === Math.floor(at / MINUTE)).reduce((sum, row) => sum + row.count, 0);
  let browser;
  try {
    assert.equal((await runtime.dispatchFetch(`${origin}/api/app/traffic-alerts`)).status, 401, 'traffic settings require an operator');
    assert.equal((await runtime.dispatchFetch(`${origin}/api/app/traffic-alerts`, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ multiple: 2 }) })).status, 401);
    assert.deepEqual((await api('/api/app/traffic-alerts')).body, { settings: { multiple: 3 } }, 'the default is exactly 3×');
    for (const multiple of [1, 101, '3', null]) {
      const invalid = await api('/api/app/traffic-alerts', { method: 'PUT', body: JSON.stringify({ multiple }) });
      assert.equal(invalid.status, 400, invalid.text);
      assert.equal((await api('/api/app/traffic-alerts')).body.settings.multiple, 3, 'refused configuration leaves the acknowledged value intact');
    }
    const configure = async multiple => {
      const result = await api('/api/app/traffic-alerts', { method: 'PUT', body: JSON.stringify({ multiple }) });
      assert.equal(result.status, 200, result.text); assert.deepEqual(result.body, { settings: { multiple } });
    };
    const componentResult = await post('/api/app/components', { groupId: null, name: 'Synthetic Lamp traffic API', description: '', internal: false, displayOrder: 0, note: '' });
    assert.equal(componentResult.status, 201, componentResult.text);
    const component = componentResult.body.component;
    const target = Math.floor(Date.now() / HOUR) * HOUR + 30 * MINUTE;
    const readAt = async (at, count, path = '/', surface = 'page') => {
      await fixture.clock(at);
      const before = await minuteCount(surface, at);
      await Promise.all(Array.from({ length: count }, async (_, request) => {
        const response = await runtime.dispatchFetch(`${publicOrigin}${path}?visitor=synthetic-private-query-${request}`, { headers: {
          'User-Agent': `synthetic-private-agent-${request}`, Cookie: `private_visitor=synthetic-private-cookie-${request}`,
          'CF-Connecting-IP': `192.0.2.${request + 1}`, 'X-Forwarded-For': `198.51.100.${request + 1}`,
        } });
        assert.equal(response.status, 200, await response.text());
      }));
      await eventually(() => minuteCount(surface, at), value => value === before + count, 'each controlled public request increments its minute once');
    };
    // Two controlled observed minutes produce 120 reads/hour; the other minutes
    // have zero requests. Uneven minute counts distinguish the same-hour mean
    // from a same-minute lookup. No fabricated counter row establishes baseline.
    for (let day = 7; day >= 1; day--) {
      const start = Math.floor((target - day * DAY) / HOUR) * HOUR;
      await readAt(start, 1);
      await readAt(start + 30 * MINUTE, 119);
      if (day !== 4) await readAt(start, 70, '/feed.atom', 'feed');
      const history = await rows('page', start);
      assert.equal(new Set(history.map(row => row.minute)).size, 2);
      assert.equal(history.reduce((sum, row) => sum + row.count, 0), 120);
      t?.diagnostic(`HIST-006 observed baseline day ${day}: 2 observed minutes / 120 public page requests`);
    }
    await configure(6);
    await readAt(target, 10);
    await fixture.tick(target + 2 * MINUTE);
    assert.equal(alerts().length, 0, 'the owner’s 6× multiple suppresses a 5× burst');
    await configure(3);
    const burst = target + MINUTE;
    await readAt(burst, 10);
    const publicBefore = await (await runtime.dispatchFetch(`${publicOrigin}/api/public/status`)).text();
    await fixture.tick(burst + 2 * MINUTE);
    await eventually(alerts, value => value.length === 1, 'a 5× burst sends exactly one real operator-provider request');
    assert.equal(trafficMail().length, 1, 'this page burst creates exactly one operator alert across all surfaces');
    assert.match(alerts()[0].text, /page: 10 requests in one minute/);
    assert.match(alerts()[0].text, /baseline of 2\.00 per minute/);
    assert.ok(alerts()[0].text.includes(`${origin}/app`), 'the operator alert links to the actual app');
    assert.deepEqual(alerts()[0].to, ['synthetic-lamp-owner@example.test']);
    await fixture.tick(burst + 2 * MINUTE);
    await fixture.tick(burst + 2 * MINUTE);
    assert.equal(alerts().length, 1, 'repeated Cron delivery does not resend the alert');
    await readAt(burst + MINUTE, 10);
    await fixture.tick(burst + 3 * MINUTE);
    assert.equal(alerts().length, 1, 'the same consecutive burst remains one episode');
    assert.equal(await (await runtime.dispatchFetch(`${publicOrigin}/api/public/status`)).text(), publicBefore, 'traffic alerts publish no customer-facing incident or content');

    // A quiet minute ends the first episode; an unresolved incident suppresses
    // an otherwise identical fresh 5× episode through the native incident door.
    const quiet = burst + 2 * MINUTE;
    await readAt(quiet, 2);
    await fixture.tick(quiet + 2 * MINUTE);
    const feedBurst = quiet + MINUTE;
    await readAt(feedBurst, 5, '/feed.atom', 'feed');
    await readAt(feedBurst, 20, '/widget.js', 'widget');
    await fixture.tick(feedBurst + 2 * MINUTE);
    await eventually(() => trafficMail().filter(message => /feed: 5 requests/.test(message.text)), value => value.length === 1, 'a missing historical feed hour is zero after seven-day collection coverage');
    const feedMail = trafficMail().find(message => /feed: 5 requests/.test(message.text));
    assert.match(feedMail.text, /baseline of 1\.00 per minute/);
    assert.equal(trafficMail().filter(message => /widget:/.test(message.text)).length, 0, 'a cold-start surface without a seven-day baseline sends no spike alert');
    const incidentResult = await post('/api/app/incidents', { title: 'Synthetic Lamp unresolved traffic', components: [{ componentId: component.id, state: 'Partially unavailable', relationship: 'Primary' }] });
    assert.equal(incidentResult.status, 201, incidentResult.text);
    const incident = incidentResult.body.incident;
    const saveDraft = async lifecycle => {
      const result = await api(`/api/app/incidents/${incident.id}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle, affectedAudience: 'Synthetic readers', customerImpact: 'Requests are delayed.', whatStillWorks: 'The status page remains readable.', details: '', nextUpdateAt: lifecycle === 'Resolved' ? null : new Date(Date.now() + DAY).toISOString() }) });
      assert.equal(result.status, 200, result.text);
    };
    await saveDraft('Investigating');
    assert.equal((await post(`/api/app/incidents/${incident.id}/publish`, { channels: [] })).status, 200);
    const suppressed = feedBurst + MINUTE;
    await readAt(suppressed, 10);
    await fixture.tick(suppressed + 2 * MINUTE);
    await fixture.tick(suppressed + 2 * MINUTE);
    assert.equal(alerts().length, 1, 'the same 5× burst during an unresolved incident sends no operator alert');
    await fixture.clock(suppressed + 2 * MINUTE);
    const recoveryResult = await api(`/api/app/incidents/${incident.id}/recovery-check`);
    assert.equal(recoveryResult.status, 200, recoveryResult.text);
    const traffic = recoveryResult.body.recovery.items.find(item => item.source === 'Public-page traffic' && item.key === 'page');
    assert.equal(traffic?.state, 'firing', 'the inherited recovery door reads elevated traffic as failing evidence');
    assert.equal(traffic.evidenceAt, new Date(suppressed).toISOString());
    assert.ok(!recoveryResult.body.recovery.notTracked.includes('Public-page traffic baseline'));
    await saveDraft('Resolved');
    const refused = await post(`/api/app/incidents/${incident.id}/publish`, { channels: [] });
    assert.equal(refused.status, 409, refused.text);
    assert.equal((await api(`/api/app/incidents/${incident.id}`)).body.incident.lifecycle, 'Investigating');

    const listed = await bucket.list({ prefix: 'traffic/counts/' });
    assert.ok(listed.objects.length >= 8);
    for (const object of listed.objects) {
      const stored = await (await bucket.get(object.key)).json();
      assert.ok(Array.isArray(stored));
      for (const row of stored) {
        assert.deepEqual(Object.keys(row).sort(), ['count', 'minute', 'surface']);
        assert.equal(typeof row.surface, 'string');
        assert.ok(Number.isInteger(row.minute) && Number.isInteger(row.count) && row.count > 0);
      }
      assert.doesNotMatch(JSON.stringify(stored), /synthetic-private|192\.0\.2|198\.51\.100|visitor|cookie|agent/i, 'counter storage contains no visitor identifier or raw path');
    }
    // Copy actual rendered object bytes to a Worker with no D1 binding at all.
    // Successful public reads and counters cannot issue a database query there.
    const noDatabase = await openTrafficAlertsRuntime({ database: false });
    try {
      assert.equal(noDatabase.env.DB, undefined);
      let cursor;
      do {
        const page = await bucket.list({ cursor });
        for (const object of page.objects) {
          const source = await bucket.get(object.key);
          await noDatabase.env.SNAPSHOTS.put(object.key, await source.arrayBuffer(), { httpMetadata: source.httpMetadata, customMetadata: source.customMetadata });
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      await noDatabase.clock(target + 10 * MINUTE);
      for (const path of ['/', '/feed.atom', '/widget.js']) {
        const response = await noDatabase.runtime.dispatchFetch(`${noDatabase.publicOrigin}${path}`);
        assert.equal(response.status, 200, `${path} serves with no database binding`);
        await response.text();
      }
      await eventually(async () => {
        const values = await noDatabase.env.SNAPSHOTS.list({ prefix: keyAt('page', target + 10 * MINUTE) });
        const stored = (await Promise.all(values.objects.map(async value => (await noDatabase.env.SNAPSHOTS.get(value.key)).json()))).flat();
        return stored.filter(row => row.minute === Math.floor((target + 10 * MINUTE) / MINUTE)).reduce((sum, row) => sum + row.count, 0);
      }, count => count === 1, 'aggregate recording also works with no database binding');
    } finally { await noDatabase.close(); }

    await configure(3);
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] });
    const context = await browser.newContext();
    const equals = fixture.cookie.indexOf('=');
    await context.addCookies([{ name: fixture.cookie.slice(0, equals), value: fixture.cookie.slice(equals + 1), url: origin }]);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (process.env.LAMP_BROWSER_EVIDENCE) await mkdir(process.env.LAMP_BROWSER_EVIDENCE, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${origin}/app/incidents/${incident.id}`); await operatorHydrated(page);
      await expect(page.getByRole('heading', { name: 'Recovery check', exact: true })).toBeVisible();
      await expect(page.getByText('Checking linked monitors…', { exact: true })).toBeHidden();
      const trafficEvidence = page.getByRole('listitem').filter({ hasText: 'Public-page traffic · page:' });
      await expect(trafficEvidence).toBeVisible(); await expect(trafficEvidence).toContainText('above baseline');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px traffic recovery evidence fits`);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.filter(row => ['serious', 'critical'].includes(row.impact)), []);
      if (process.env.LAMP_BROWSER_EVIDENCE) await page.screenshot({ path: join(process.env.LAMP_BROWSER_EVIDENCE, `${width}-traffic-recovery.png`), fullPage: true });
      await page.goto(`${origin}/app/settings#notifications`); await operatorHydrated(page);
      const field = page.getByRole('spinbutton', { name: 'Traffic spike multiple', exact: true });
      await expect(field).toBeVisible(); await expect(field).toHaveValue('3');
      await field.fill('1'); await field.blur();
      await expect(page.getByText('Changes kept · not live', { exact: true })).toBeVisible();
      assert.equal((await api('/api/app/traffic-alerts')).body.settings.multiple, 3, 'invalid UI input leaves persisted settings unchanged');
      await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Page', exact: true }).click();
      await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Notifications', exact: true }).click();
      await expect(field).toHaveValue('1');
      const acknowledged = page.waitForResponse(response => response.url() === `${origin}/api/app/traffic-alerts` && response.request().method() === 'PUT');
      await field.fill('4'); await field.blur();
      assert.equal((await acknowledged).status(), 200);
      await page.reload(); await operatorHydrated(page); await expect(field).toHaveValue('4');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px traffic Settings fits`);
      assert.ok(await field.evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize) >= 13), 'normal field text is at least 13px');
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.filter(row => ['serious', 'critical'].includes(row.impact)), []);
      assert.deepEqual(errors, [], `${width}px traffic Settings has no hydration errors`);
      if (process.env.LAMP_BROWSER_EVIDENCE) await page.screenshot({ path: join(process.env.LAMP_BROWSER_EVIDENCE, `${width}-traffic-settings.png`), fullPage: true });
      const reset = page.waitForResponse(response => response.url() === `${origin}/api/app/traffic-alerts` && response.request().method() === 'PUT');
      await field.fill('3'); await field.blur(); assert.equal((await reset).status(), 200);
      await expect.poll(async () => (await api('/api/app/traffic-alerts')).body.settings.multiple).toBe(3);
      t?.diagnostic(`HIST-006 ${width}px Settings owner multiple autosaves, survives reload, fits and passes axe/hydration`);
    }
    await context.close();
    t?.diagnostic('HIST-006: 840 public page + 420 feed baseline requests; default 3×, owner threshold, 5× exactly-once episode, incident suppression, recovery refusal, identifier-free counters and database-free reads asserted');
  } finally { await browser?.close(); await fixture.close(); }
}
