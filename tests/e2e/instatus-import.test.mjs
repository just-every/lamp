import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { nativeRequest, openNativeRuntime, publicOrigin, origin } from '../dev-ingress/runtime.mjs';
import { devKey } from '../helpers/dev-key.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { notificationActivity, assertNoNewNotifications } from '../helpers/import-notifications.mjs';
const fixtures = family => readdirSync(join('tests/fixtures/instatus', family)).map(name => ({ name, text: readFileSync(join('tests/fixtures/instatus', family, name), 'utf8') }));
const source = { source: 'instatus', pageId: 'synthpage01', publicAccessAcknowledged: true };
let runtime, cookie;
const api = async (path, json, method = 'POST', headers) => {
  const response = await nativeRequest(path, { cookie, ...(json === undefined ? {} : { json, method }), headers });
  return { status: response.status, body: await response.json() };
};
const get = path => api(path);
const route = '/api/app/statuspage-import';
const expected = files => {
  const rows = prefix => files.filter(file => new RegExp(`^instatus-${prefix}(?:-\\d+)?\\.json$`).test(file.name)).flatMap(file => JSON.parse(file.text));
  const subscribers = rows('subscribers');
  return { components: rows('components').length, groups: new Set(rows('components').flatMap(row => row.group ? [row.group.id] : [])).size, incidents: rows('incidents').length, maintenance: rows('maintenances').length, subscribers: subscribers.filter(row => row.email && row.confirmed && row.approved && !row.phone && !row.webhook && !row.slack).length, skipped: subscribers.filter(row => !row.email || !row.confirmed || !row.approved || row.phone || row.webhook || row.slack).length };
};
async function counts() {
  const [components, incidents, maintenance] = await Promise.all(['/api/app/components', '/api/app/incidents', '/api/app/maintenance'].map(get));
  let subscribers = 0;
  for (;;) { const page = (await get(`/api/app/subscribers?limit=100&offset=${subscribers}`)).body; subscribers += page.subscribers.length; if (!page.hasMore) break; }
  return { components: components.body.components.length, groups: components.body.groups.length, incidents: incidents.body.incidents.length, maintenance: maintenance.body.maintenance.length, subscribers };
}
async function apply(files) {
  const preview = await api(`${route}/preview`, { ...source, files });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  let response = await api(`${route}/apply`, { ...source, files, asOf: preview.body.report.asOf, fingerprint: preview.body.report.fingerprint, acknowledged: true });
  for (let round = 0; round < 100 && response.body.job?.state === 'applying'; round++) response = await api(`${route}/jobs/${response.body.job.id}/resume`, {});
  assert.equal(response.status, 200, JSON.stringify(response.body)); assert.equal(response.body.job.state, 'completed');
  return { preview: preview.body, result: response.body };
}
async function undo(job) {
  let response;
  for (let round = 0; round < 100; round++) { response = await api(`${route}/jobs/${job}/undo`, {}); if (response.body.job?.state !== 'undoing') break; }
  assert.equal(response.status, 200, JSON.stringify(response.body)); assert.equal(response.body.job.state, 'undone'); return response.body;
}
before(async () => {
  runtime = await openNativeRuntime(); await runtime.start(); await runtime.seedOperator();
  cookie = (await signInAs({ origin, key: devKey })).header;
  await fetch(`${publicOrigin}/`);
});
after(async () => { await runtime?.close(); });

test('MOVE-001/002/003/004/005 Instatus owner route reviews, fences, imports silently, preserves history and conditionally undoes', async () => {
  const initial = await counts(), mailBefore = await notificationActivity(runtime);
  const small = fixtures('small'), large = fixtures('large');
  const guest = await nativeRequest(`${route}/preview`, { method: 'POST', json: { ...source, files: small } });
  assert.equal(guest.status, 401);
  for (const text of ['{broken', '{"data":[]}', ' '.repeat(8 * 1024 * 1024 + 1)]) {
    const refused = await api(`${route}/preview`, { ...source, files: [{ name: 'instatus-components.json', text }] });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.ok(refused.body.error.length > 10); assert.doesNotMatch(refused.body.error, /[\r\n]/);
    assert.deepEqual(await counts(), initial);
  }
  for (const files of [small, large]) {
    const preview = await api(`${route}/preview`, { ...source, files });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const want = expected(files), report = preview.body.report;
    for (const [kind, plural] of [['component', 'components'], ['group', 'groups'], ['incident', 'incidents'], ['maintenance', 'maintenance'], ['subscriber', 'subscribers']]) assert.equal(report.counts[kind].imported + report.counts[kind].changed, want[plural]);
    assert.equal(report.counts.subscriber.skipped, want.skipped);
    assert.deepEqual(await counts(), initial); await assertNoNewNotifications(runtime, mailBefore);
  }
  const preview = (await api(`${route}/preview`, { ...source, files: small })).body;
  const changedSource = small.map(file => file.name === 'instatus-components.json' ? { ...file, text: file.text.replace('Synthetic service', 'Changed source service') } : file);
  const reviewed = { ...source, asOf: preview.report.asOf, fingerprint: preview.report.fingerprint, acknowledged: true };
  assert.equal((await api(`${route}/apply`, { ...reviewed, files: changedSource })).status, 409);
  const created = await api('/api/app/components', { name: 'Native component', description: '', groupId: null, internal: false, displayOrder: 0, note: '' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await api(`${route}/apply`, { ...reviewed, files: small })).status, 409);
  const beforeSmall = await counts();
  const smallImport = await apply(small), smallWant = expected(small);
  assert.deepEqual(await counts(), Object.fromEntries(Object.entries(beforeSmall).map(([key, value]) => [key, value + smallWant[key]])));
  await assertNoNewNotifications(runtime, mailBefore);
  await undo(smallImport.result.job.id);
  assert.deepEqual(await counts(), beforeSmall);
  await assertNoNewNotifications(runtime, mailBefore);
  const beforeImport = await counts();
  const imported = await apply(large), want = expected(large);
  assert.deepEqual(await counts(), Object.fromEntries(Object.entries(beforeImport).map(([key, value]) => [key, value + want[key]])));
  await assertNoNewNotifications(runtime, mailBefore, 'preview/apply/resume do not send invitations');
  assert.equal((await get('/api/app/deliveries?limit=100')).body.deliveries.length, 0);
  const incidents = (await get('/api/app/incidents')).body.incidents;
  const raw = JSON.parse(large.find(file => file.name === 'instatus-incidents.json').text);
  for (const row of raw) {
    const native = incidents.find(incident => incident.title === row.name);
    assert.deepEqual(native.updates.map(update => Date.parse(update.publishedAt)).sort(), row.updates.map(update => Date.parse(update.started)).sort());
    assert.ok(native.updates.every(update => update.isRetroactive));
  }
  const maintenance = (await get('/api/app/maintenance')).body.maintenance[0];
  assert.equal(maintenance.state, 'Completed'); assert.equal(maintenance.notices.length, 0);
  const summary = JSON.parse(large.find(file => file.name === 'instatus-summary.json').text);
  for (const row of [...summary.recentlyResolvedIncidents, ...summary.activeMaintenances]) {
    const response = await fetch(`${publicOrigin}${new URL(row.url).pathname}`, { redirect: 'manual' });
    assert.equal(response.status, 301, row.url);
    assert.equal((await fetch(`${publicOrigin}${response.headers.get('Location')}`)).status, 200);
  }
  assert.equal(await (await fetch(`${publicOrigin}/history.atom`)).text(), await (await fetch(`${publicOrigin}/feed.atom`)).text());
  const cutover = await get(`${route}/jobs/${imported.result.job.id}`);
  assert.ok(cutover.body.report.cutover.readerGaps.some(message => message.includes('/history.rss')));
  await assertNoNewNotifications(runtime, mailBefore, 'Cutover read sends nothing');
  const beforeRepeated = await counts();
  const repeated = await apply(large);
  assert.deepEqual(await counts(), beforeRepeated);
  assert.equal(repeated.preview.report.state, 'already imported');
  assert.deepEqual(repeated.result.report.counts, imported.result.report.counts);
  await assertNoNewNotifications(runtime, mailBefore);
  // The same provider-local IDs and creation dates still name different native
  // components; email destinations stay unique across source namespaces.
  const otherComponents = JSON.parse(readFileSync('tests/fixtures/statuspage/small/components.json', 'utf8')).map(row => ({ ...row, created_at: '2020-01-01T00:00:00Z', name: `Statuspage ${row.name}` }));
  const otherFiles = [{ name: 'components.json', text: JSON.stringify(otherComponents) }, { name: 'subscribers.json', text: JSON.stringify([{ id: 'subscriber-1', mode: 'email', email: 'large-1@example.invalid', components: [] }]) }];
  const otherPreview = await api(`${route}/preview`, { source: 'statuspage', files: otherFiles });
  assert.equal(otherPreview.status, 200, JSON.stringify(otherPreview.body));
  assert.equal(otherPreview.body.report.counts.subscriber.skipped, 1);
  const beforeOther = await counts();
  let other = await api(`${route}/apply`, { source: 'statuspage', files: otherFiles, asOf: otherPreview.body.report.asOf, fingerprint: otherPreview.body.report.fingerprint, acknowledged: true });
  while (other.body.job?.state === 'applying') other = await api(`${route}/jobs/${other.body.job.id}/resume`, {});
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.equal((await counts()).components, beforeOther.components + otherComponents.length);
  assert.equal((await counts()).subscribers, beforeOther.subscribers);
  const allComponents = (await get('/api/app/components')).body.components;
  assert.equal(new Set(allComponents.map(row => row.id)).size, allComponents.length);
  const edited = incidents.find(row => row.title === raw.find(source => source.id === summary.recentlyResolvedIncidents[0].id).name);
  const draft = await api(`/api/app/incidents/${edited.id}/draft`, { lifecycle: 'Resolved', affectedAudience: 'API customers', customerImpact: 'Owner correction after import', whatStillWorks: 'All services', details: 'Owner-reviewed history', nextUpdateAt: null }, 'PUT', { 'If-Match': `-:${edited.updates.length}` });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  const publish = await api(`/api/app/incidents/${edited.id}/publish`, { channels: [] }, 'POST', { 'If-Match': `${draft.body.draft.id}:${edited.updates.length}` });
  assert.equal(publish.status, 200, JSON.stringify(publish.body));
  // Publish commits the update before waitUntil finishes its public snapshot.
  // Observe the real artifact, as the native publishing browser journey does.
  let publishedPage, publishedHtml;
  for (let attempt = 0; attempt < 40; attempt++) {
    publishedPage = await fetch(`${publicOrigin}/incidents/${edited.reference}`);
    publishedHtml = await publishedPage.text();
    if (publishedPage.status === 200 && publishedHtml.includes('Owner correction after import')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(publishedPage.status, 200);
  assert.match(publishedHtml, /Owner correction after import/);
  const publishedFeed = await (await fetch(`${publicOrigin}/feed.atom`)).text();
  assert.match(publishedFeed, /Owner correction after import/);
  assert.equal(await (await fetch(`${publicOrigin}/history.atom`)).text(), publishedFeed, 'overlapping source feed paths serve the current published feed');
  const undone = await undo(imported.result.job.id);
  assert.ok(undone.undo.dispositions.some(row => row.targetKind === 'incident' && row.disposition === 'retained' && row.reason));
  assert.equal((await get('/api/app/incidents')).body.incidents.length, initial.incidents + 1);
  assert.equal((await fetch(`${publicOrigin}${new URL(summary.recentlyResolvedIncidents[0].url).pathname}`, { redirect: 'manual' })).status, 301);
  assert.equal((await fetch(`${publicOrigin}${new URL(summary.recentlyResolvedIncidents[1].url).pathname}`, { redirect: 'manual' })).status, 404);
  assert.equal(await (await fetch(`${publicOrigin}/history.atom`)).text(), await (await fetch(`${publicOrigin}/feed.atom`)).text(), 'surviving imports keep the shared feed address after conditional undo');
  await assertNoNewNotifications(runtime, mailBefore);
});
