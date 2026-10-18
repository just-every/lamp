import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { operatorHydrated } from './operator-hydrated.mjs';

export const groupedPayload = (key, states = ['firing', 'firing']) => ({ version: '4', receiver: 'lamp', status: states.some(state => state === 'firing') ? 'firing' : 'resolved', groupKey: key, groupLabels: { alertname: 'ServiceUnavailable' }, commonLabels: { region: 'us-east' }, commonAnnotations: {}, externalURL: 'https://monitor.example.test', truncatedAlerts: 0,
  alerts: states.map((status, index) => ({ status, labels: { alertname: 'ServiceUnavailable', service: index ? 'dashboard' : 'api', region: 'us-east' }, annotations: { summary: index ? 'Dashboard requests timing out' : 'API request failures' }, startsAt: '2026-10-18T00:00:00Z', endsAt: status === 'resolved' ? '2026-10-18T00:05:00Z' : '0001-01-01T00:00:00Z', generatorURL: 'https://monitor.example.test/graph', fingerprint: index ? 'b2b2b2' : 'a1a1a1' })) });

export async function groupedAlertsFlow({ api, post, component, sql, origin, publicOrigin, cookie }) {
  const targets = [await component('US API grouped alerts'), await component('Dashboard grouped alerts')];
  const matchers = targets.map((target, index) => ({ componentId: target.id, labels: { service: index ? 'dashboard' : 'api', region: 'us-east' } }));
  const send = async (source, body, token = source.token) => {
    const response = await fetch(source.endpointUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  for (const preset of ['alertmanager', 'grafana']) {
    const created = await post('/api/app/intake/sources', { name: `${preset} production grouped alerts`, preset, credentialKind: 'bearer-token', labelMatchers: matchers });
    assert.equal(created.status, 201, created.text);
    const source = created.body.source;
    const body = groupedPayload(`${preset}-service-group`);
    if (preset === 'grafana') delete body.version; // Grafana's default shape has no version field.
    assert.equal((await send(source, body, 'invalid')).status, 401);
    assert.equal((await send(source, { arbitrary: 'not a documented group' })).status, 400);
    assert.equal((await send(source, { ...body, alerts: [{ ...body.alerts[0], labels: { service: 'not-mapped' } }] })).status, 400);
    const unmapped = (await api('/api/app/intake/receipts')).body.receipts.find(row => row.sourceId === source.id && row.error?.includes('Unmapped'));
    assert.ok(unmapped && !unmapped.incidentId);
    const results = await Promise.all([send(source, body), send(source, body)]);
    assert.ok(results.every(result => result.status === 202), JSON.stringify(results));
    assert.equal(results[0].body.incidentId, results[1].body.incidentId, 'concurrent duplicate group has one incident');
    const id = results[0].body.incidentId;
    let incident = (await api(`/api/app/incidents/${id}`)).body.incident;
    assert.deepEqual(incident.components.map(row => row.componentId).sort(), targets.map(row => row.id).sort());
    assert.equal(incident.updates.length, 0);
    assert.equal(sql(`SELECT count(*) AS n FROM alert_group_members WHERE incident_id='${id}'`)[0].n, 2);
    const mixed = { ...body, ...groupedPayload(body.groupKey, ['resolved', 'firing']) };
    if (preset === 'grafana') delete mixed.version;
    await send(source, mixed);
    incident = (await api(`/api/app/incidents/${id}`)).body.incident;
    assert.equal(incident.lifecycle, 'Investigating', 'partial recovery keeps the group open');
    assert.equal(sql(`SELECT count(*) AS n FROM alert_group_members WHERE incident_id='${id}' AND state='resolved'`)[0].n, 1);
    const resolved = { ...body, ...groupedPayload(body.groupKey, ['resolved', 'resolved']) };
    if (preset === 'grafana') delete resolved.version;
    const singleRecovery = { ...body, alerts: [resolved.alerts[0]], status: 'resolved' };
    await send(source, singleRecovery);
    assert.equal((await api(`/api/app/incidents/${id}`)).body.incident.lifecycle, 'Investigating', 'an omitted firing fingerprint is still active');
    await send(source, resolved);
    assert.equal((await api(`/api/app/incidents/${id}`)).body.incident.lifecycle, 'Resolved');
    assert.equal((await api(`/api/app/incidents/${id}`)).body.incident.updates.length, 0);
    const refired = await send(source, { ...body, firingCycle: 2 });
    assert.notEqual(refired.body.incidentId, id, 'a new firing after recovery starts a new group incident');
    const publishedId = refired.body.incidentId;
    await api(`/api/app/incidents/${publishedId}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle: 'Investigating', affectedAudience: 'US customers', customerImpact: 'Requests are timing out.', nextUpdateAt: new Date(Date.now() + 3600000).toISOString(), whatStillWorks: '', details: '' }) });
    assert.equal((await post(`/api/app/incidents/${publishedId}/publish`, { channels: [] })).status, 200);
    await send(source, { ...resolved, firingCycle: 2 });
    assert.equal((await api(`/api/app/incidents/${publishedId}`)).body.incident.lifecycle, 'Investigating', 'monitor recovery cannot resolve a public incident');
    assert.equal((await api('/api/app/intake/sources')).text.includes(source.token), false, 'token remains write-only');
  }

  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })));
    const page = await context.newPage();
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${origin}/app/alerts`);
      await operatorHydrated(page);
      await page.getByLabel('Grouped tool').selectOption(width === 390 ? 'grafana' : 'alertmanager');
      await page.getByLabel('Grouped source name').fill(`US production ${width}`);
      await page.getByLabel('Mapped component 1').selectOption(targets[0].id);
      await page.getByLabel('Label matchers 1').fill('service="api", region="us-east"');
      await page.getByRole('button', { name: 'Add component mapping', exact: true }).click();
      await page.getByLabel('Mapped component 2').selectOption(targets[1].id);
      await page.getByLabel('Label matchers 2').fill('service="dashboard", region="us-east"');
      await inspect('grouped-mappings');
      await page.getByRole('button', { name: 'Create grouped source', exact: true }).click();
      await page.getByText('Grouped source saved. Alerts remain private until publication.').waitFor();
      const endpointUrl = await page.getByLabel('Grouped endpoint', { exact: true }).inputValue();
      const token = await page.getByLabel('Grouped token', { exact: true }).inputValue();
      await inspect('grouped-configured');
      const payload = groupedPayload(`browser-group-${width}`);
      const response = await send({ endpointUrl, token }, payload);
      assert.equal(response.status, 202);
      await page.reload();
      await operatorHydrated(page);
      const receipt = page.locator('tr').filter({ has: page.locator(`a[href="/app/incidents/${response.body.incidentId}"]`) }).first();
      await receipt.waitFor();
      await inspect('grouped-receipt');
      await receipt.getByRole('link', { name: 'Open draft' }).click();
      await page.getByRole('heading', { name: 'Compose public update' }).waitFor();
      await operatorHydrated(page);
      const result = (await api(`/api/app/incidents/${response.body.incidentId}`)).body.incident;
      assert.deepEqual(result.components.map(row => row.componentId).sort(), targets.map(row => row.id).sort());
      assert.equal(result.updates.length, 0);
      await inspect('grouped-private-draft');
      const publicText = await (await fetch(`${publicOrigin}/`)).text();
      assert.ok(!publicText.includes(result.reference), 'inbound group has no public story before operator publication');
      async function inspect(name) {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${name} overflow`);
        assert.deepEqual(await page.locator('.grouped-source-card button').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent)), [], 'mapping controls keep their full labels');
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(axe.violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => row.id), [], `${width} ${name} accessibility`);
        if (process.env.LAMP_SCREENSHOTS) {
          const path = `${process.env.LAMP_SCREENSHOTS}/${width}-${name}.png`;
          if (name === 'grouped-mappings' || name === 'grouped-configured') await page.locator('section[aria-labelledby=grouped-title]').screenshot({ path });
          else if (name === 'grouped-receipt') { await receipt.scrollIntoViewIfNeeded(); await page.screenshot({ path }); }
          else await page.screenshot({ path, fullPage: true });
        }
      }
    }
    await context.close();
  } finally { await browser.close(); }
}
