import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { operatorHydrated } from './operator-hydrated.mjs';

// run-uptime main: notification-content.ts, notification-context.ts and
// timestamped-body-signature.ts. Default body and Lamp-compatible headers.
const secret = 'synthetic-uptime-signing-secret-for-integration';
function envelope(monitorId, key, recovered = false) {
  const at = Date.now() - 90000;
  return { schemaVersion: 2, id: `${key}:${recovered ? 'recovery' : 'trigger'}`, kind: recovered ? 'recovery' : 'trigger', eventType: recovered ? 'uptime.incident.recovered' : 'uptime.incident.firing', incidentKey: key, state: recovered ? 'recovered' : 'firing', title: `${recovered ? 'Recovered' : 'Down'}: Checkout API`, monitorId, monitorRevision: 1, monitorName: 'Checkout API', url: 'https://shop.example.test/health', slotId: key, observedAt: recovered ? Date.now() : at, visibility: 'private', evidenceRef: `/api/monitors/${monitorId}/history`, explanation: 'Confirmed scheduled failure.', probes: [{ name: 'us-east', outcome: recovered ? 'pass' : 'target_failure', reason: recovered ? 'All checks passed' : 'Expected HTTP 200; received 503' }, { name: 'eu-west', outcome: recovered ? 'pass' : 'target_failure', reason: recovered ? 'All checks passed' : 'Expected HTTP 200; received 503' }], consoleUrl: 'https://uptime.example.test', webhookContext: { monitorType: 'http', httpStatusCode: recovered ? 200 : 503, responseTimeMs: 120, ...(recovered ? {} : { failedAssertion: 'status' }) }, incidentContext: { version: 2, confirmedStartedAt: at, confirmedRecoveredAt: recovered ? Date.now() : null, downtimeSeconds: recovered ? 90 : null, originalReason: 'Expected HTTP 200; received 503', failedLocations: [{ probe: 'us-east', name: 'US East', reason: 'HTTP 503' }, { probe: 'eu-west', name: 'EU West', reason: 'HTTP 503' }], timeZone: 'UTC' } };
}
async function send(source, payload, { timestamp = new Date().toISOString(), signingSecret = secret, body = JSON.stringify(payload), signature } = {}) {
  const response = await fetch(source.endpointUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lamp-Timestamp': timestamp, 'X-Lamp-Signature': signature ?? createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('base64url') }, body });
  return { status: response.status, body: await response.json() };
}

export async function uptimePresetFlow({ api, post, component, origin, publicOrigin, cookie }) {
  const targets = [await component('Checkout API (Uptime)'), await component('Payments worker (Uptime)')];
  const mappings = targets.map((row, index) => ({ monitorId: index ? 'payments' : 'checkout', componentId: row.id }));
  const input = { name: 'Production Uptime evidence', preset: 'uptime', credentialKind: 'hmac-sha256', signingSecret: secret, monitorMappings: mappings };
  assert.equal((await post('/api/app/intake/sources', { ...input, signingSecret: undefined })).status, 400);
  assert.equal((await post('/api/app/intake/sources', { ...input, monitorMappings: [mappings[0], mappings[0]] })).status, 400);
  const created = await post('/api/app/intake/sources', input);
  assert.equal(created.status, 201, created.text);
  const source = created.body.source;
  assert.equal(source.credentialKind, 'hmac-sha256');
  assert.deepEqual(source.monitorMappings, mappings);
  assert.ok(!(await api('/api/app/intake/sources')).text.includes(secret));
  const down = envelope('checkout', 'incident:checkout-first');
  assert.equal((await send(source, down, { timestamp: new Date(Date.now() - 6 * 60000).toISOString() })).status, 401, 'INTAKE-008 replay outside five minutes');
  assert.equal((await send(source, down, { signingSecret: 'wrong' })).status, 401);
  assert.equal((await send(source, down, { signature: createHmac('sha256', secret).update(JSON.stringify(down)).digest('base64url') })).status, 401, 'signature covers timestamp and exact body');
  assert.equal((await send(source, { ...down, kind: 'recovery' })).status, 400, 'unconfirmed or inconsistent transitions refused');
  assert.equal((await send(source, envelope('unmapped', 'incident:unmapped'))).status, 400);
  const firing = await send(source, down);
  assert.equal(firing.status, 202, JSON.stringify(firing));
  assert.equal((await send(source, down)).body.incidentId, firing.body.incidentId, 'duplicate webhook stays in one draft');
  const incident = (await api(`/api/app/incidents/${firing.body.incidentId}`)).body.incident;
  assert.deepEqual(incident.components.map(row => row.componentId), [targets[0].id]);
  assert.equal(incident.updates.length, 0);
  const brief = (await api(`/api/app/incidents/${incident.id}/brief`)).body.brief;
  assert.deepEqual(brief.whatWeKnow.alerts[0].payload, down);
  for (const text of ['US East', 'EU West', 'status', new Date(down.incidentContext.confirmedStartedAt).toISOString()]) assert.ok(brief.whatWeKnow.alerts[0].evidenceSummary.includes(text));
  const second = await send(source, envelope('payments', 'incident:checkout-first'));
  assert.notEqual(second.body.incidentId, incident.id, 'monitor identity isolates equal incident keys');
  assert.deepEqual((await api(`/api/app/incidents/${second.body.incidentId}`)).body.incident.components.map(row => row.componentId), [targets[1].id]);
  const recovery = await send(source, { ...down, id: 'recovered-event', kind: 'recovery', state: 'recovered', eventType: 'uptime.incident.recovered' });
  assert.equal(recovery.status, 202);
  assert.equal(recovery.body.incidentId, incident.id);
  assert.equal((await api(`/api/app/incidents/${incident.id}`)).body.incident.lifecycle, 'Resolved');
  assert.ok((await api('/api/app/intake/receipts')).body.receipts.some(row => row.id === recovery.body.receiptId && row.state === 'recovered'));
  assert.equal((await api(`/api/app/incidents/${second.body.incidentId}`)).body.incident.lifecycle, 'Investigating');
  assert.ok(!(await (await fetch(`${publicOrigin}/`)).text()).includes(incident.reference));

  const historical = envelope('checkout', 'incident:older-context');
  delete historical.incidentContext; delete historical.webhookContext;
  const oldResult = await send(source, historical);
  assert.equal(oldResult.status, 202);
  const oldBrief = (await api(`/api/app/incidents/${oldResult.body.incidentId}/brief`)).body.brief;
  assert.ok(oldBrief.whatWeKnow.alerts[0].evidenceSummary.includes('Confirmed failure time: not supplied'));
  const publishedId = second.body.incidentId;
  const draft = { lifecycle: 'Investigating', affectedAudience: 'Customers checking out.', customerImpact: 'Some payments are failing.', whatStillWorks: 'Browsing works.', details: '', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() };
  assert.equal((await api(`/api/app/incidents/${publishedId}/draft`, { method: 'PUT', body: JSON.stringify(draft) })).status, 200);
  assert.equal((await post(`/api/app/incidents/${publishedId}/publish`, { channels: [] })).status, 200);
  assert.equal((await send(source, envelope('payments', 'incident:checkout-first', true))).status, 202);
  assert.equal((await api(`/api/app/incidents/${publishedId}`)).body.incident.lifecycle, 'Investigating', 'INTAKE-008 recovery records evidence but cannot close a published incident');
  const changed = await api(`/api/app/intake/sources/${source.id}`, { method: 'PUT', body: JSON.stringify({ ...input, signingSecret: undefined }) });
  assert.equal(changed.status, 200, changed.text);
  assert.equal((await send(source, envelope('checkout', 'incident:after-edit'))).status, 202, 'blank secret preserves signed connection');


  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })));
    const page = await context.newPage();
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${origin}/app/alerts`); await operatorHydrated(page);
      await page.getByLabel('Uptime source name').fill(`Commerce Uptime ${width}`);
      await page.getByLabel('Uptime signing secret').fill(secret);
      await page.getByLabel('Uptime monitor ID 1', { exact: true }).fill('checkout');
      await page.getByLabel('Uptime component 1').selectOption(targets[0].id);
      await page.getByRole('button', { name: 'Add Uptime monitor', exact: true }).click();
      await page.getByLabel('Uptime monitor ID 2', { exact: true }).fill('payments');
      await page.getByLabel('Uptime component 2').selectOption(targets[1].id);
      await inspect('uptime-mappings', '.uptime-source-card');
      await page.getByRole('button', { name: 'Create Uptime source', exact: true }).click();
      const endpoint = page.getByLabel('Uptime endpoint', { exact: true }); await endpoint.waitFor();
      const connected = { endpointUrl: await endpoint.inputValue() };
      await inspect('uptime-configured', '.uptime-source-card');
      const result = await send(connected, envelope('checkout', `incident:browser-${width}`));
      assert.equal(result.status, 202);
      await page.reload(); await operatorHydrated(page);
      assert.ok((await api('/api/app/intake/sources')).body.sources.some(row => row.name === `Commerce Uptime ${width}` && row.monitorMappings.length === 2));
      const sourceCard = page.locator('article.alert-source-card').filter({ has: page.getByRole('heading', { name: `Commerce Uptime ${width}`, exact: true }) });
      await sourceCard.scrollIntoViewIfNeeded();
      if (process.env.LAMP_SCREENSHOTS) await sourceCard.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-uptime-source.png` });
      const receipt = page.locator('tr').filter({ has: page.locator(`a[href="/app/incidents/${result.body.incidentId}"]`) }).first();
      await receipt.waitFor(); await receipt.scrollIntoViewIfNeeded(); await inspect('uptime-receipt');
      await receipt.getByRole('link', { name: 'Open draft' }).click(); await operatorHydrated(page);
      await page.getByRole('heading', { name: 'Brief', exact: true }).waitFor();
      await page.locator('#brief-A1 summary').click();
      assert.ok(await page.locator('#brief-A1').getByText(/Vantages: US East/).isVisible());
      await inspect('uptime-brief', '.incident-brief');
      const recovered = await send(connected, envelope('checkout', `incident:browser-${width}`, true));
      assert.equal(recovered.status, 202);
      await page.reload(); await operatorHydrated(page);
      assert.equal((await api(`/api/app/incidents/${result.body.incidentId}`)).body.incident.lifecycle, 'Resolved');
      await page.evaluate(() => scrollTo(0, 0));
      await inspect('uptime-recovered');
      async function inspect(name, selector) {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${name} has no overflow`);
        assert.deepEqual(await page.locator('.uptime-source-card button').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent)), [], 'Uptime controls retain their full labels');
        if (process.env.LAMP_SCREENSHOTS) {
          const path = `${process.env.LAMP_SCREENSHOTS}/${width}-${name}.png`;
          if (selector) await page.locator(selector).screenshot({ path }); else await page.screenshot({ path });
        }
      }
    }
    await context.close();
  } finally { await browser.close(); }
}
