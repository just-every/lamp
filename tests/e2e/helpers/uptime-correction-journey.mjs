import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { parse } from 'parse5';
import { chromium } from 'playwright';
import { openStatusJourney } from './status-journey.mjs';
import { subscriberCsvRows } from './subscriber-management-fixture.mjs';

const createdAt = '2040-01-01T00:00:00.000Z';
const startsAt = '2040-03-31T23:00:00.000Z';
const endsAt = '2040-04-01T01:00:00.000Z';
const observedAt = '2040-04-02T12:00:00.000Z';
const affectedDays = ['2040-03-31', '2040-04-01'];
const percentage = (downtime, coverage) => `${(Math.floor((1 - downtime / coverage) * 10000) / 100).toFixed(2)}%`;
const attr = (node, name) => node.attrs?.find(attribute => attribute.name === name)?.value;
const hasClass = (node, name) => (attr(node, 'class') ?? '').split(/\s+/).includes(name);
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join('');
const find = (node, predicate) => [ ...(predicate(node) ? [node] : []), ...(node.childNodes ?? []).flatMap(child => find(child, predicate)) ];
const byClass = (node, name) => find(node, child => hasClass(child, name));
const namedRow = (tree, rowClass, nameClass, name) => {
  const rows = byClass(tree, rowClass).filter(row => byClass(row, nameClass).some(label => text(label) === name));
  assert.equal(rows.length, 1, `${rowClass} identifies exactly one ${name}`);
  return rows[0];
};

function rootFigures(html, template, target, control, expected, daily, worst) {
  const tree = parse(html);
  assert.equal(attr(find(tree, node => node.tagName === 'body')[0], 'data-template') ?? 'default', template, 'the regions case must exercise its real layout, not the calm fallback');
  for (const [component, value] of [[target, expected], [control, '100.00%']]) {
    if (template === 'default') {
      const rows = byClass(tree, 'component').filter(row => find(row, node => node.tagName === 'h4').some(heading => text(heading) === component.name));
      assert.equal(rows.length, 1);
      assert.equal(text(byClass(rows[0], 'uptime-number')[0]), value);
    } else if (template === 'calm') {
      assert.equal(text(byClass(namedRow(tree, 'calm-row', 'calm-name', component.name), 'calm-value')[0]), value);
    } else if (template === 'regions') {
      const row = namedRow(tree, 'rg-row', 'rg-name-text', component.name);
      assert.equal(text(byClass(row, 'rg-uptime')[0].childNodes[0]), value);
      assert.ok(text(byClass(row, 'rg-detail')[0]).includes(`: ${value}`), 'expanded region detail agrees');
    } else {
      assert.equal(text(byClass(namedRow(tree, 'hm-label', 'hm-name', component.name), 'hm-pct')[0]), value);
      const row = namedRow(tree, 'up-row', 'up-name', component.name);
      assert.equal(text(byClass(row, 'up-pct')[0]), value);
      assert.ok(text(byClass(row, 'up-detail')[0]).includes(`: ${value}`), 'expanded phone detail agrees');
    }
    const records = find(tree, node => attr(node, 'role') === 'list' && attr(node, 'aria-label')?.endsWith(`-day uptime record for ${component.name}`));
    assert.equal(records.length, 1, 'each component has its own labeled daily record');
    for (const day of affectedDays) {
      const label = component === target ? `${day}: Downtime ${daily} minutes (weighted); worst state: ${worst}` : `${day}: no downtime`;
      assert.equal(find(records[0], node => attr(node, 'aria-label') === label).length, 1, `${template}: ${component.name} ${day}`);
    }
  }
  if (template === 'uptime') {
    const mean = Math.floor((Number.parseFloat(expected) + 100) / 2 * 100) / 100;
    assert.equal(text(byClass(tree, 'up-number')[0]), `${mean.toFixed(2)}%`, 'the existing overall uptime figure also refreshes');
  }
}

// Four independently warmed native installations prevent a later template edit
// from masking a missing correction invalidation. All figures for one correction
// share one real monotonic deadline; the Worker clock stays fixed throughout.
export async function uptimeCorrectionJourney() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    for (const template of ['default', 'calm', 'uptime', 'regions']) {
      const j = await openStatusJourney({ pageHost: 'localhost', workerEntry: 'tests/e2e/helpers/automation-clock-worker.ts' });
      try {
        const clock = now => j.json('/test/clock', 'PUT', { now: Date.parse(now) }, 204);
        await clock(createdAt);
        await j.signIn(undefined, { fresh: true });
        const saved = (await j.json('/api/app/page-settings')).settings;
        const target = await j.component('synthetic-lamp-uptime-1', { region: 'Europe' });
        const control = await j.component('synthetic-lamp-uptime-2', { region: 'North America' });
        const settings = Object.fromEntries(['pageName', 'tagline', 'accentColor', 'hostname', 'mailFromAddress', 'footerCreditEnabled'].map(key => [key, saved[key]]));
        await j.json('/api/app/page-settings', 'PUT', { ...settings, template, timezone: 'UTC' });
        await clock(startsAt);
        await j.signIn(undefined, { fresh: true });
        await j.json(`/api/app/components/${target.id}/standing-claim`, 'PUT', { state: 'Major outage' });
        await clock(endsAt);
        await j.json(`/api/app/components/${target.id}/standing-claim`, 'PUT', { state: 'Operational' });
        await clock(observedAt);
        const operator = (await j.json('/api/app/session')).operator;
        const correctionPath = `/api/app/components/${target.id}/history-corrections`;
        const historyPath = `/api/app/components/${target.id}/history`;
        const correction = { state: 'Degraded performance', startsAt, endsAt, reason: 'synthetic-lamp-verified-request-logs-1' };
        const original = await j.json(historyPath);
        const auditRows = async () => (await j.db.prepare("SELECT * FROM audit_entries WHERE action = 'corrected' ORDER BY id").all()).results;
        const originalAudit = await auditRows();
        await j.json(correctionPath, 'POST', { ...correction, reason: '' }, 400);
        assert.deepEqual(await j.json(historyPath), original, 'empty-reason refusal changes neither history nor corrections');
        assert.deepEqual(await auditRows(), originalAudit, 'empty-reason refusal creates no successful audit');
        const anonymous = await j.raw(correctionPath, { method: 'POST', headers: { Origin: j.appOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(correction) });
        assert.equal(anonymous.status, 401, 'correction requires operator authority');
        assert.deepEqual(await j.json(historyPath), original, 'an anonymous correction changes nothing');

        // Literal fixture durations, not values read from the product: two hours
        // straddle midnight, March and April, and Q1 and Q2 of a leap year.
        const reports = [
          { query: 'month=2040-03', period: '2040-03', coverage: 31 * 1440 },
          { query: 'month=2040-04', period: '2040-04', coverage: 36 * 60 },
          { query: 'quarter=2040-Q1', period: '2040-Q1', coverage: 91 * 1440 },
          { query: 'quarter=2040-Q2', period: '2040-Q2', coverage: 36 * 60 },
        ];
        const views = weight => {
          const total = 120 * weight, daily = 60 * weight;
          const expected = percentage(total, 90 * 1440);
          const worst = weight === 1 ? 'Major outage' : correction.state;
          const observations = [
            ['root', () => j.publicText('/'), html => rootFigures(html, template, target, control, expected, daily, worst)],
            ['native components', async () => (await (await j.publicResponse('/api/public/v1/components')).json()).data, rows => {
              assert.deepEqual(rows.map(row => row.id).sort(), [target.id, control.id].sort());
              for (const component of [target, control]) {
                const uptime = rows.find(row => row.id === component.id).uptime;
                assert.equal(uptime.percentage, component === target ? expected : '100.00%');
                assert.equal(uptime.coverageMinutes, 90 * 1440);
                assert.equal(uptime.trackingSince, createdAt);
                assert.equal(uptime.marks.reduce((sum, mark) => sum + (mark.downtimeMinutes ?? 0), 0), component === target ? total : 0);
                for (const day of affectedDays) {
                  const mark = uptime.marks.find(row => row.day === day);
                  assert.equal(mark.downtimeMinutes, component === target ? daily : 0);
                  assert.equal(mark.worstDowntimeState, component === target ? worst : null);
                }
              }
            }],
            ['uptime badge', () => j.publicText(`/components/${target.id.toLowerCase()}/uptime.svg`), svg => {
              const values = find(parse(svg), node => attr(node, 'id') === 'value');
              assert.equal(values.length, 1);
              assert.equal(text(values[0]), expected);
            }],
          ];
          for (const report of reports) {
            const path = `/api/app/availability-report?component=${target.id}&${report.query}`;
            const uptime = percentage(daily, report.coverage), downtime = daily.toFixed(2);
            observations.push(
              [`${report.period} JSON`, () => j.json(`${path}&format=json`), body => {
                assert.equal(body.component.id, target.id);
                assert.equal(body.period, report.period);
                assert.equal(body.observedUntil, report.period === '2040-03' || report.period === '2040-Q1' ? '2040-04-01T00:00:00.000Z' : observedAt);
                assert.equal(body.uptime, uptime);
                assert.equal(body.downtimeMinutes, downtime);
              }],
              [`${report.period} CSV`, async () => { const response = await j.request(`${path}&format=csv`); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/csv/); return response.text(); }, csv => {
                const rows = subscriberCsvRows(csv);
                assert.equal(rows.length, 1);
                assert.equal(rows[0].component_id, target.id);
                assert.equal(rows[0].period, report.period);
                assert.equal(rows[0].uptime, uptime);
                assert.equal(rows[0].weighted_downtime_minutes, downtime);
              }],
              [`${report.period} PDF`, async () => { const response = await j.request(`${path}&format=pdf`); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /application\/pdf/); return response.text(); }, pdf => {
                assert.ok(pdf.startsWith('%PDF-') && pdf.trimEnd().endsWith('%%EOF'));
                assert.ok(pdf.includes(`(${report.period} - UTC) Tj`));
                assert.ok(pdf.includes(`(Uptime: ${uptime}) Tj`));
                assert.ok(pdf.includes(`(Downtime minutes: ${downtime}) Tj`));
              }],
            );
          }
          return observations;
        };
        const observe = async (observations, deadline) => {
          for (const [name, read, check] of observations) {
            let failure;
            do {
              try { check(await read()); failure = undefined; break; }
              catch (error) { failure = error; }
              await new Promise(resolve => setTimeout(resolve, 50));
            } while (performance.now() < deadline);
            if (failure) throw new Error(`${template}: ${name} missed the shared sixty-second deadline`, { cause: failure });
            assert.ok(performance.now() <= deadline, `${template}: ${name} was observed within the same sixty seconds`);
          }
        };
        await observe(views(1), performance.now() + 60_000);
        await j.json(correctionPath, 'POST', correction, 204);
        const committed = performance.now();
        await observe(views(0.5), committed + 60_000);
        console.log(`UPTIME_CORRECTION_DEADLINE ${JSON.stringify({ template, elapsedMs: Math.ceil(performance.now() - committed), limitMs: 60000, figures: views(0.5).map(([name]) => name) })}`);

        const after = await j.json(historyPath);
        assert.equal(after.history.length, original.history.length + 1);
        assert.deepEqual(after.history.filter(row => row.causeType !== 'correction'), original.history, 'original fact values survive unchanged');
        assert.equal(after.corrections.length, 1);
        const stored = after.corrections[0];
        for (const field of ['state', 'startsAt', 'endsAt', 'reason']) assert.equal(stored[field], correction[field]);
        assert.equal(stored.operatorId, operator.id);
        assert.equal(stored.createdAt, observedAt);
        const appended = after.history.find(row => row.id === stored.historyId);
        assert.equal(appended.causeType, 'correction');
        assert.equal(appended.previousState, 'Major outage');
        assert.equal(appended.newState, correction.state);
        assert.equal(appended.changedAt, startsAt);
        assert.equal(appended.operatorId, operator.id);
        const audits = (await j.json(`/api/app/audit-log?action=corrected&actorId=${operator.id}&limit=100`)).entries;
        const audit = audits.find(row => row.entityId === stored.historyId);
        assert.ok(audit, 'the correction is searchable under the actual operator');
        assert.equal(audit.actorId, operator.id);
        assert.equal(audit.reason, correction.reason);
        assert.equal(audit.createdAt, observedAt);
        const persisted = await auditRows();
        assert.equal(persisted.length, originalAudit.length + 1);
        const durable = persisted.find(row => row.entity_id === stored.historyId);
        assert.equal(durable.operator_id, operator.id);
        assert.equal(durable.reason, correction.reason);
        assert.deepEqual(JSON.parse(durable.payload_json), { componentId: target.id, ...correction });
        const exported = await j.request(`/api/app/audit-log?action=corrected&actorId=${operator.id}&format=csv`);
        assert.equal(exported.status, 200);
        assert.equal(subscriberCsvRows(await exported.text()).find(row => row.id === audit.id).reason, correction.reason);

        const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
        try {
          const page = await context.newPage();
          assert.equal((await page.goto(j.publicOrigin)).status(), 200);
          // Assertions run at one width. Phone capture is browser proof only.
          rootFigures(await page.content(), template, target, control, percentage(60, 90 * 1440), 30, correction.state);
          if (process.env.LAMP_SCREENSHOTS) {
            await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
            for (const width of [1440, 390]) {
              await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
              await page.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-uptime-correction-${template}.png`, fullPage: true });
            }
          }
        } finally { await context.close(); }
      } finally { await j.close(); }
    }
  } finally { await browser.close(); }
}
