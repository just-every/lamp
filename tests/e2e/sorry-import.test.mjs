import { businessImportDoorFlow } from './helpers/import-door-flow.mjs';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { nativeRequest, openNativeRuntime, origin, publicOrigin } from '../dev-ingress/runtime.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { devKey } from '../helpers/dev-key.mjs';
import { notificationActivity, assertNoNewNotifications } from '../helpers/import-notifications.mjs';
import { load } from '../operator-readiness/runtime.mjs';

const endpoint = '/api/app/statuspage-import';
const fixture = family => readdirSync(`tests/fixtures/sorry/${family}`).map(name => ({ name, text: readFileSync(`tests/fixtures/sorry/${family}/${name}`, 'utf8') }));
const source = { source: 'sorry', publicAccessAcknowledged: true, pageId: 'synthpage01' };

test('MOVE-001 MOVE-002 MOVE-004 MOVE-005 MOVE-006 Sorry and the opt-in Business door preview, apply, reconcile and undo history with subscribers held until cutover', { timeout: 600000 }, async () => {
  const runtime = await openNativeRuntime();
  try {
    await runtime.start(); await runtime.seedOperator();
    const cookie = (await signInAs({ origin, key: devKey })).header;
    const call = async (path, body) => {
      const response = await nativeRequest(path, { cookie, ...(body ? { method: 'POST', json: body } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const counts = async () => {
      const rows = await Promise.all(['/api/app/components', '/api/app/incidents', '/api/app/maintenance', '/api/app/subscribers'].map(path => call(path)));
      return [rows[0].body.components.length, rows[0].body.groups.length, rows[1].body.incidents.length, rows[2].body.maintenance.length, rows[3].body.subscribers.length];
    };
    const read = files => call(`${endpoint}/preview`, { ...source, files });
    const apply = async files => {
      const preview = await read(files); assert.equal(preview.status, 200, JSON.stringify(preview.body));
      let result = await call(`${endpoint}/apply`, { ...source, files, asOf: preview.body.report.asOf, fingerprint: preview.body.report.fingerprint, acknowledged: true });
      while (result.body.job?.state === 'applying') result = await call(`${endpoint}/jobs/${result.body.job.id}/resume`, {});
      assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.job.state, 'completed');
      return result.body;
    };
    const undo = async id => {
      let result;
      do { result = await call(`${endpoint}/jobs/${id}/undo`, {}); assert.equal(result.status, 200, JSON.stringify(result.body)); } while (result.body.job.state === 'undoing');
      assert.equal(result.body.job.state, 'undone'); return result.body;
    };
    const initial = await counts(), notifications = await notificationActivity(runtime), files = fixture('public');
    const guest = await nativeRequest(`${endpoint}/preview`, { method: 'POST', json: { ...source, files } }); assert.equal(guest.status, 401);
    const preview = await read(files); assert.equal(preview.status, 200, JSON.stringify(preview.body));
    for (const [kind, amount] of Object.entries({ component: 2, group: 1, incident: 1, maintenance: 1, subscriber: 0 })) assert.equal(preview.body.report.counts[kind].read, amount);
    assert.deepEqual(await counts(), initial); await assertNoNewNotifications(runtime, notifications);
    assert.equal((await read(files.filter(file => file.name !== 'sorry-notice-100.json'))).status, 400, 'incomplete detail cannot be applied');
    assert.equal((await read([...files, ...fixture('authenticated').filter(file => file.name.includes('subscribers'))])).status, 400, 'public captures cannot contain subscribers');
    const altered = files.map(file => file.name.includes('components') ? { ...file, text: file.text.replace('Billing API', 'Changed billing API') } : file);
    assert.equal((await call(`${endpoint}/apply`, { ...source, files: altered, asOf: preview.body.report.asOf, fingerprint: preview.body.report.fingerprint, acknowledged: true })).status, 409);
    const imported = await apply(files);
    assert.deepEqual(await counts(), [2, 1, 1, 1, 0]);
    const incident = (await call('/api/app/incidents')).body.incidents[0];
    assert.deepEqual(incident.updates.map(row => row.publishedAt).sort(), ['2025-04-02T10:00:00.000Z', '2025-04-02T10:30:00.000Z']);
    const maintenance = (await call('/api/app/maintenance')).body.maintenance[0];
    assert.equal(maintenance.state, 'Completed'); assert.equal(maintenance.notices.length, 0);
    await assertNoNewNotifications(runtime, notifications);
    for (const path of ['/notices/100', '/notices/synthetic-delayed-invoice-processing']) {
      const response = await fetch(publicOrigin + path, { redirect: 'manual' }); assert.equal(response.status, 301);
      assert.equal(response.headers.get('location'), `/incidents/${incident.reference}`);
      assert.equal((await fetch(publicOrigin + response.headers.get('location'))).status, 200);
    }
    for (const path of ['/notices', '/history', '/history/2026/october', '/history/2025/april']) {
      const history = await fetch(publicOrigin + path, { redirect: 'manual' }); assert.equal(history.status, 301);
      assert.equal(history.headers.get('location'), '/history/');
      assert.ok(history.headers.get('x-lamp-snapshot-version'));
      assert.equal((await fetch(publicOrigin + history.headers.get('location'))).status, 200);
    }
    assert.equal((await fetch(`${publicOrigin}/history/2026/not-a-month`, { redirect: 'manual' })).status, 404);
    assert.equal((await apply(files)).job.id, imported.job.id);
    await undo(imported.job.id); assert.deepEqual(await counts(), initial);
    assert.equal((await fetch(`${publicOrigin}/notices/100`, { redirect: 'manual' })).status, 404);
    assert.equal((await fetch(`${publicOrigin}/history/2026/october`, { redirect: 'manual' })).status, 404);
    assert.equal((await fetch(`${publicOrigin}/history`, { redirect: 'manual' })).status, 200);
    const { fetchSorryResponses } = await load('src/core/features/statuspage-import/sorry/fetch.ts');
    const { readSorryResponses } = await load('src/core/features/statuspage-import/sorry/read.ts');
    const saved = fixture('authenticated'), apiKey = 'synthetic-sorry-api-key';
    const fetcher = async (url, init) => {
      assert.equal(url.origin, 'https://api.sorryapp.com'); assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'manual'); assert.equal(init.headers.Authorization, `Bearer ${apiKey}`);
      const resource = url.pathname.replace('/v1/pages/synthpage01', '').replace(/^\//, '');
      const name = resource.startsWith('notices/') ? `sorry-notice-${resource.split('/')[1]}.json` : `sorry-${resource || 'page'}.json`;
      const file = saved.find(file => file.name === name); assert.ok(file, 'API requests only documented source resources');
      return new Response(file.text, { headers: { 'content-type': 'application/json' } });
    };
    const authFiles = await fetchSorryResponses({ pageId: source.pageId, apiKey, fetcher });
    const parsed = await readSorryResponses(authFiles, source);
    const channels = JSON.parse(saved.find(file => file.name === 'sorry-subscribers.json').text).response;
    const retainedInput = JSON.stringify(parsed);
    for (const row of channels) for (const field of ['phone_number', 'slack_webhook_url', 'microsoft_teams_url']) if (row[field]) assert.ok(!retainedInput.includes(row[field]), 'channel value must not enter retained records or original bytes');
    assert.notEqual(parsed.artifacts.find(row => row.name === 'sorry-subscribers.json').original?.status, 'available');
    for (const [field, value] of [['google_chat_space', 'https://chat.googleapis.com/v1/spaces/synthetic?key=synthetic'], ['legacy_slack_oauth_token', 'synthetic-legacy-slack']]) {
      const files = authFiles.map(file => file.name !== 'sorry-subscribers.json' ? file : { ...file, text: JSON.stringify({ response: [{ ...channels[0], [field]: value }], count: 1 }) });
      const read = await readSorryResponses(files, source);
      assert.equal(read.data.subscribers.length, 1); assert.ok(!JSON.stringify(read).includes(value));
    }
    const credential = authFiles.map(file => file.name !== 'sorry-page.json' ? file : { ...file, text: file.text.replace('"response": {', '"response": {"api_key":"must-be-refused",') });
    assert.equal((await read(credential)).status, 400, 'other credential-bearing responses still fail closed');
    const held = await apply(authFiles);
    assert.equal((await call('/api/app/maintenance')).body.maintenance.find(row => row.title === 'Cancelled database maintenance').state, 'Cancelled');
    assert.equal((await call('/api/app/incidents')).body.incidents.find(row => row.title === 'Billing support hours').lifecycle, 'Resolved');
    assert.equal(held.report.counts.subscriber.imported + held.report.counts.subscriber.changed, 1); assert.equal(held.report.counts.subscriber.skipped, 3);
    for (const name of ['Slack', 'Microsoft Teams']) assert.ok(held.report.items.some(row => row.kind === 'subscriber' && row.outcome === 'skipped' && row.reason.includes(name)));
    assert.equal(held.report.cutover.invitations.deadline, null); assert.equal(held.invites.remaining, 1);
    const subscriber = (await call('/api/app/subscribers')).body.subscribers.find(row => row.destination === 'reader@example.invalid'); assert.equal(subscriber.state, 'deactivated');
    await assertNoNewNotifications(runtime, notifications);
    assert.equal((await call(`${endpoint}/jobs/${held.job.id}/send-invitations`, {})).status, 409);
    assert.equal((await call(`${endpoint}/jobs/${held.job.id}/send-invitations`, { liveOrigin: 'https://wrong.example.invalid', hostnameLive: true, watchWindowClosed: true })).status, 409);
    const sent = await call(`${endpoint}/jobs/${held.job.id}/send-invitations`, { liveOrigin: publicOrigin, hostnameLive: true, watchWindowClosed: true });
    assert.equal(sent.status, 200, JSON.stringify(sent.body)); assert.equal(sent.body.report.cutover.invitations.claimed, 1);
    const repeated = await call(`${endpoint}/jobs/${held.job.id}/send-invitations`, { liveOrigin: publicOrigin, hostnameLive: true, watchWindowClosed: true }); assert.equal(repeated.body.invites.sent, 0);
    const retained = await undo(held.job.id);
    assert.ok(retained.undo.dispositions.some(row => row.targetKind === 'subscriber' && row.disposition === 'retained'), 'release changes the held row, so undo cannot claim to retract its invitation');
  } finally { await runtime.close(); }
  await businessImportDoorFlow();
});
