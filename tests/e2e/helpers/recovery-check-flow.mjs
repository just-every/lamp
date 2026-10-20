import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { groupedPayload } from './grouped-alerts-flow.mjs';
import { operatorHydrated } from './operator-hydrated.mjs';

export async function recoveryCheckFlow({ api, post, component, alertSource, draft, sql, origin, publicOrigin, devKey, cookie }) {
  const path = id => `/api/app/incidents/${id}`;
  const check = async id => {
    const response = await api(`${path(id)}/recovery-check`);
    assert.equal(response.status, 200, response.text); return response.body.recovery;
  };
  const save = async (id, lifecycle) => {
    const response = await api(`${path(id)}/draft`, { method: 'PUT', body: JSON.stringify(draft({ lifecycle, nextUpdateAt: lifecycle === 'Resolved' ? null : new Date(Date.now() + 3600000).toISOString() })) });
    assert.equal(response.status, 200, response.text);
  };
  const target = await component('Checkout recovery evidence');
  const send = await alertSource('Checkout recovery monitor', target.id);
  const down = { alert_id: 'recovery-4401', alert_cycle_key: 'recovery-cycle', alert_transition: 'Triggered', alert_title: 'Checkout requests failing' };
  const accepted = await send(down); assert.equal(accepted.status, 202);
  const id = (await accepted.json()).incidentId;
  await save(id, 'Investigating'); assert.equal((await post(`${path(id)}/publish`, { channels: [] })).status, 200);
  await save(id, 'Resolved');
  const firing = await check(id);
  assert.equal(firing.passed, false); assert.ok(firing.items.some(item => item.state === 'firing' && item.source === 'Checkout recovery monitor' && Number.isFinite(Date.parse(item.evidenceAt))));
  assert.ok(firing.notTracked.length, 'absent evidence is explicitly named rather than certified recovered');
  const before = (await api(path(id))).body.incident;
  const refused = await post(`${path(id)}/publish`, { channels: [] });
  assert.equal(refused.status, 409, refused.text); assert.equal(refused.body.recovery.passed, false);
  assert.equal((await api(path(id))).body.incident.updates.length, before.updates.length);
  const reason = 'Customer checks confirm recovery; the monitor is still checking the retired endpoint.';
  const browser = process.env.LAMP_RECOVERY_SCREENSHOTS ? await openBrowser(origin, devKey, cookie) : null;
  try {
    if (browser) await capture(browser.page, origin, id, 'failing', async page => {
      await page.getByRole('combobox', { name: /^Status/ }).selectOption('Monitoring');
      await page.getByRole('combobox', { name: /^Status/ }).selectOption('Resolved');
      const rejected = page.waitForResponse(response => response.url().endsWith(`${path(id)}/publish`) && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Publish update', exact: true }).click();
      assert.equal((await rejected).status(), 409);
      await page.getByLabel('Recovery override reason', { exact: true }).fill(reason);
    });
    const overridden = await post(`${path(id)}/publish`, { channels: [], overrideReason: reason });
    assert.equal(overridden.status, 200, overridden.text);
    const closed = (await api(path(id))).body.incident;
    assert.equal(closed.lifecycle, 'Resolved'); assert.ok(closed.internalNotes.some(note => note.body.includes(reason)));
    const audit = (await api('/api/app/audit-log?limit=100')).body.entries;
    assert.ok(audit.some(entry => entry.reason === reason && entry.actorId), 'a named operator and reason are audited');
    const publicPage = await (await fetch(`${publicOrigin}/incidents/${closed.reference}`)).text();
    assert.ok(!publicPage.includes(reason), 'override reasons remain private');
    if (browser) await capture(browser.page, origin, id, 'overridden');
  } finally { await browser?.browser.close(); }

  const heldSend = await alertSource('Payment recovery hold', (await component('Payment recovery hold')).id);
  const heldDown = { ...down, alert_id: 'hold-4402', alert_cycle_key: 'hold-cycle' };
  const held = await heldSend(heldDown); assert.equal(held.status, 202); const heldId = (await held.json()).incidentId;
  await save(heldId, 'Investigating'); assert.equal((await post(`${path(heldId)}/publish`, { channels: [] })).status, 200);
  const recovered = { ...heldDown, alert_transition: 'Recovered', alert_title: 'Payment requests recovered' };
  assert.equal((await heldSend(recovered)).status, 202); await save(heldId, 'Resolved');
  assert.equal((await check(heldId)).passed, false); assert.ok((await check(heldId)).items.some(item => item.state === 'holding'));
  assert.equal((await post(`${path(heldId)}/publish`, { channels: [] })).status, 409);
  const old = new Date(Date.now() - 86400000).toISOString();
  // Historical stored receipts are fixture setup; the checks and publication
  // continue through the same authenticated public doors as the operator.
  const age = () => sql(`UPDATE alert_receipts SET recovered_at=CASE WHEN recovered_at IS NULL THEN NULL ELSE '${old}' END, received_at='${old}' WHERE incident_id='${heldId}'`);
  age(); assert.equal((await check(heldId)).passed, true);
  assert.equal((await heldSend({ ...heldDown, event_title: 'Payment failures returned' })).status, 202);
  assert.equal((await check(heldId)).passed, false, 'a later re-fire cancels the prior recovery');
  assert.equal((await heldSend({ ...recovered, event_title: 'Payment recovered after the second failure' })).status, 202);
  age(); assert.equal((await check(heldId)).passed, true);
  assert.equal((await post(`${path(heldId)}/publish`, { channels: [] })).status, 200, 'a recovered monitor past the hold needs no override');

  const grouped = await post('/api/app/intake/sources', { name: 'Regional recovery group', preset: 'alertmanager', credentialKind: 'bearer-token', labelMatchers: [{ componentId: target.id, labels: { region: 'us-east' } }] });
  assert.equal(grouped.status, 201, grouped.text);
  const groupSend = body => fetch(grouped.body.source.endpointUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${grouped.body.source.token}` }, body: JSON.stringify(body) });
  const groupResult = await groupSend(groupedPayload('regional-recovery')); assert.equal(groupResult.status, 202); const groupId = (await groupResult.json()).incidentId;
  await save(groupId, 'Investigating'); assert.equal((await post(`${path(groupId)}/publish`, { channels: [] })).status, 200);
  assert.equal((await groupSend(groupedPayload('regional-recovery', ['resolved', 'firing']))).status, 202);
  await save(groupId, 'Resolved'); const partial = await check(groupId);
  assert.equal(partial.passed, false); assert.ok(partial.items.some(item => item.state === 'firing'), 'one recovered member cannot hide another firing member');
  assert.equal((await post(`${path(groupId)}/publish`, { channels: [] })).status, 409);
  const scheduled = await post(`${path(groupId)}/draft/schedule`, { channels: [], publishAt: new Date(Date.now() + 60000).toISOString() });
  assert.equal(scheduled.status, 202, scheduled.text);
  sql(`UPDATE incident_drafts SET scheduled_publish_at='${old}' WHERE incident_id='${groupId}'`);
  assert.equal((await fetch(`${publicOrigin}/cdn-cgi/local/scheduled`)).status, 200);
  const retained = (await api(path(groupId))).body.incident;
  assert.equal(retained.lifecycle, 'Investigating', 'scheduled resolution cannot bypass recovery');
  assert.equal(retained.updates.length, 1); assert.ok(retained.draft, 'failing scheduled draft is retained');
}


async function openBrowser(origin, devKey, cookie) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext();
    await context.route(url => url.pathname.startsWith('/@fs/'), route => route.continue({ headers: { ...route.request().headers(), 'x-rer-dev-key': devKey } }));
    await context.addCookies(cookie.split(/;\s*/).map(pair => { const split = pair.indexOf('='); return { name: pair.slice(0, split), value: pair.slice(split + 1), url: origin, httpOnly: true, sameSite: 'Lax' }; }));
    assert.equal((await context.request.get(origin + '/api/app/session')).status(), 200, 'the browser uses the existing signed-in operator session');
    const page = await context.newPage(); await page.goto(origin + '/app'); await page.waitForURL('**/app');
    return { browser, page };
  } catch (cause) { await browser.close(); throw cause; }
}
async function capture(page, origin, id, state, prepare) {
  await mkdir(process.env.LAMP_RECOVERY_SCREENSHOTS, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(`${origin}/app/incidents/${id}`);
    await operatorHydrated(page);
    await page.getByRole('heading', { name: 'Recovery check', exact: true }).waitFor();
    await page.getByText('Checking the linked evidence…', { exact: true }).waitFor({ state: 'hidden' });
    await prepare?.(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'recovery screen fits');
    await page.screenshot({ path: `${process.env.LAMP_RECOVERY_SCREENSHOTS}/AGENT-004-${state}-${width}.png`, fullPage: true });
  }
}
