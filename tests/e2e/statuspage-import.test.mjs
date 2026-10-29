import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { openStatusJourney } from './helpers/status-journey.mjs';
import { notificationActivity, assertNoNewNotifications, moveInDoor } from '../helpers/import-notifications.mjs';
import { importedIncidentLiveFlow } from './helpers/imported-incident-live-flow.mjs';
import { incidentSubscriberFiles, incidentSubscriberImportFlow } from './helpers/incident-subscriber-import-flow.mjs';
import { postmortemTemplateImportFlow } from './helpers/postmortem-template-import-flow.mjs';

const fixtures = source => readdirSync(`tests/fixtures/${source}/small`).map(name => ({ name, text: readFileSync(`tests/fixtures/${source}/small/${name}`, 'utf8') }));
const parsed = (files, name) => JSON.parse(files.find(file => file.name === name).text);
function sourceHistory(source, files) {
  if (source === 'statuspage') return parsed(files, 'incidents.json').map(row => ({ title: row.name, times: row.incident_updates.map(update => update.display_at) }));
  if (source === 'instatus') return parsed(files, 'instatus-incidents.json').map(row => ({ title: row.name, times: row.updates.map(update => update.started) }));
  return parsed(files, 'status-reports.json').data.filter(row => row.attributes.report_type !== 'maintenance').map(row => ({
    title: row.attributes.title,
    times: files.filter(file => file.name.startsWith(`status-updates-${row.id}`)).flatMap(file => JSON.parse(file.text).data.map(update => update.attributes.published_at)),
  }));
}

test('SUB-019 MOVE-001 MOVE-002 MOVE-003 MOVE-004 MOVE-005 MOVE-009 MOVE-011 MOVE-012 MOVE-013 MOVE-014 SUB-023 ACCESS-001 — owner reviews provider history, imports silently, keeps public readers, invites deliberately and conditionally undoes', { timeout: 600_000 }, async t => {
  const sourceFiles = fixtures('statuspage'), apiKey = 'synthetic-owner-import-key';
  const requests = [];
  let incidentSubscriberProbe = false;
  const runtime = await openStatusJourney({ providerEdge: async request => {
    const url = new URL(request.url);
    if (url.origin !== 'https://api.statuspage.io') return;
    requests.push({ method: request.method, path: url.pathname, url: url.href, authorization: request.headers.get('authorization') });
    if (request.headers.get('authorization') !== `OAuth ${apiKey}`) return Response.json({}, { status: 401 });
    const incidentSubscribers = /^\/v1\/pages\/synthpage01\/incidents\/([^/]+)\/subscribers$/u.exec(url.pathname);
    const selectedFiles = incidentSubscriberProbe ? incidentSubscriberFiles(sourceFiles) : sourceFiles;
    if (incidentSubscribers) return new Response(selectedFiles.find(row => row.name === `incident-subscribers-${incidentSubscribers[1]}.json`)?.text ?? '[]', { headers: { 'Content-Type': 'application/json' } });
    const resource = url.pathname.replace('/v1/pages/synthpage01', '').replace(/^\//, '').replaceAll('_', '-').replace('/', '-');
    const page = Number(url.searchParams.get('page') ?? 1);
    const name = resource ? `${resource}${page > 1 ? `-${page}` : ''}.json` : 'page.json';
    return new Response(selectedFiles.find(file => file.name === name)?.text ?? '[]', { headers: { 'Content-Type': 'application/json' } });
  } });
  const origin = runtime.appOrigin, publicOrigin = runtime.publicOrigin;
  const fetch = (input, init) => runtime.raw(input, init);
  const nativeRequest = (path, { json, ...init } = {}) => runtime.request(path, { ...init, ...(json === undefined ? {} : { body: JSON.stringify(json) }) });
  try {
    const api = async (path, json, headers, method = json === undefined ? 'GET' : 'POST') => {
      const response = await nativeRequest(path, { method, ...(json === undefined ? {} : { json }), headers });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    };
    const moveIn = moveInDoor(api);
    const counts = async () => {
      const rows = await Promise.all(['/api/app/components', '/api/app/incidents', '/api/app/maintenance', '/api/app/subscribers?limit=100'].map(path => api(path)));
      return { components: rows[0].body.components.length, groups: rows[0].body.groups.length, incidents: rows[1].body.incidents.length, maintenance: rows[2].body.maintenance.length, subscribers: rows[3].body.subscribers.length };
    };
    const apply = async input => {
      const review = await moveIn.preview(input); assert.equal(review.status, 200, JSON.stringify(review.body));
      const result = await moveIn.apply(review.body); assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.job.state, 'completed');
      return { review: review.body, result: result.body };
    };
    assert.equal((await runtime.raw('/api/operator/import/uploads', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Import-Source': 'statuspage' } })).status, 401);
    const fetched = await moveIn.preview({ pageId: 'synthpage01', apiKey });
    assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
    assert.ok(requests.length && requests.every(row => row.method === 'GET' && row.authorization === `OAuth ${apiKey}`));
    assert.ok(!JSON.stringify(fetched.body).includes(apiKey), 'source authority is never returned in the saved plan');
    assert.equal((await moveIn.preview({ pageId: 'synthpage01', apiKey: 'wrong-source-key' })).status, 400);
    const privateFiles = fixtures('statuspage');
    privateFiles.find(file => file.name === 'page.json').text = readFileSync('tests/fixtures/statuspage/private/page.json', 'utf8');
    assert.equal((await moveIn.preview({ files: privateFiles })).status, 400, 'private source history cannot become public');
    const beforeSignout = await counts();
    assert.equal((await nativeRequest('/api/app/session/signout', { method: 'POST', json: {} })).status, 204);
    assert.equal((await moveIn.apply(fetched.body)).status, 401, 'a retained review grants no authority to a revoked session');
    await runtime.signIn(undefined, { fresh: true });
    assert.deepEqual(await counts(), beforeSignout);
    const native = await api('/api/app/components', { name: 'Owner-created service', description: '', groupId: null, internal: false, displayOrder: 0, note: '' });
    assert.equal(native.status, 201, JSON.stringify(native.body));
    assert.equal((await moveIn.apply(fetched.body)).status, 409, 'a page edited after review requires a fresh import review');
    assert.deepEqual(await counts(), { ...beforeSignout, components: beforeSignout.components + 1 });

    // Each row is the same owner migration, using one saved export per provider.
    // Assertions compare source records with native documents, rather than pinning fixture sizes.
    for (const source of ['statuspage', 'betterstack', 'instatus']) {
      const files = fixtures(source), input = { source, files, pageId: 'synthpage01', publicAccessAcknowledged: true };
      const before = await counts(), quiet = await notificationActivity(runtime);
      const reviewed = await moveIn.preview(input); assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
      assert.deepEqual(await counts(), before, `${source} review writes nothing`);
      const changed = reviewed.body.fingerprint[0] === '0' ? '1' : '0';
      assert.equal((await moveIn.apply(reviewed.body, changed + reviewed.body.fingerprint.slice(1))).status, 409);
      assert.deepEqual(await counts(), before, 'unreviewed source bytes cannot apply');
      const { review, result } = await apply(input);
      assert.deepEqual(result.report.counts, review.report.counts);
      const after = await counts();
      for (const [kind, plural] of [['component', 'components'], ['group', 'groups'], ['incident', 'incidents'], ['maintenance', 'maintenance'], ['subscriber', 'subscribers']]) {
        assert.equal(after[plural] - before[plural], result.report.counts[kind].imported + result.report.counts[kind].changed, `${source} applies its complete reviewed ${kind} inventory`);
      }
      const incidents = (await api('/api/app/incidents')).body.incidents;
      for (const row of sourceHistory(source, files)) {
        const incident = incidents.find(candidate => candidate.title === row.title); assert.ok(incident, row.title);
        assert.deepEqual(incident.updates.map(update => Date.parse(update.publishedAt)).sort(), row.times.map(Date.parse).sort());
        assert.ok(incident.updates.every(update => update.isRetroactive));
        const page = await fetch(`${publicOrigin}/incidents/${incident.reference}`); assert.equal(page.status, 200);
        assert.ok((await page.text()).includes(incident.title), 'imported history is immediately readable without script');
      }
      const windows = (await api('/api/app/maintenance')).body.maintenance;
      assert.ok(windows.every(window => window.notices.length === 0), 'imported windows do not replay lifecycle notices');
      if (source === 'betterstack') {
        const window = windows.find(row => row.title.includes('maintenance')); assert.ok(window);
        const html = await (await fetch(`${publicOrigin}/maintenance/${window.reference}`)).text();
        const sourceWindow = parsed(files, 'status-reports.json').data.find(row => row.attributes.report_type === 'maintenance');
        const messages = files.filter(file => file.name.startsWith(`status-updates-${sourceWindow.id}`)).flatMap(file => JSON.parse(file.text).data);
        for (const message of messages) assert.ok(html.includes(message.attributes.message), 'maintenance history keeps every source message');
      }
      for (const row of result.report.cutover.rows) {
        const alias = await fetch(publicOrigin + row.path, { redirect: 'manual' }); assert.equal(alias.status, 301, row.path);
        assert.equal(alias.headers.get('location'), row.target);
        assert.equal((await fetch(publicOrigin + row.target)).status, 200);
        assert.equal((await fetch(origin + row.path, { redirect: 'manual' })).status, 404);
      }
      for (const feed of result.report.cutover.feeds) assert.equal(await (await fetch(publicOrigin + feed)).text(), await (await fetch(publicOrigin + '/feed.atom')).text());
      assert.equal((await fetch(publicOrigin + '/history.rss')).status, 200);
      assert.equal((await fetch(publicOrigin + '/api/v2/summary.json')).status, 200);
      await assertNoNewNotifications(runtime, quiet, 'review, apply and Cutover reads never mail historical incidents');
      const again = await apply(input); assert.equal(again.result.job.id, result.job.id);
      assert.deepEqual(await counts(), after, 'repeating the same source duplicates nothing');
      const edited = incidents.find(row => row.title === sourceHistory(source, files)[0].title);
      const draft = await api(`/api/app/incidents/${edited.id}/draft`, { lifecycle: 'Resolved', affectedAudience: 'API customers', customerImpact: 'Owner correction after import', whatStillWorks: 'All services', details: 'Owner-reviewed history', nextUpdateAt: null }, { 'If-Match': `-:${edited.updates.length}` }, 'PUT');
      assert.equal(draft.status, 200, JSON.stringify(draft.body));
      const published = await api(`/api/app/incidents/${edited.id}/publish`, { channels: [] }, { 'If-Match': `${draft.body.draft.id}:${edited.updates.length}` });
      assert.equal(published.status, 200, JSON.stringify(published.body));
      if (source === 'statuspage') {
        const pending = (await api('/api/app/subscribers?limit=100')).body.subscribers;
        assert.ok(pending.length && pending.every(row => row.state === 'pending'));
        const expired = pending.at(-1), delayed = pending[0];
        const originalReview = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const originalDeadline = new Date(Date.parse(originalReview) + 72 * 60 * 60 * 1000).toISOString();
        await runtime.db.prepare('UPDATE subscribers SET created_at=? WHERE id=?').bind(originalReview, delayed.id).run();
        await runtime.db.prepare('UPDATE subscribers SET created_at=? WHERE id=?').bind(new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(), expired.id).run();
        const mailBefore = runtime.messages.length;
        const invited = await api(`/api/app/statuspage-import/jobs/${result.job.id}/send-invitations`, {});
        assert.equal((await api(`/api/app/statuspage-import/jobs/${result.job.id}/send-invitations`, {})).status, 200);
        const messages = runtime.messages.slice(mailBefore).map(message => ({ message: { ...message, to: message.to[0] } }));
        assert.equal(invited.status, 200, JSON.stringify(invited.body));
        assert.equal(invited.body.report.cutover.invitations.expired, 1);
        assert.equal(messages.length, pending.length - 1, 'expired pending subscribers receive no invitation');
        assert.ok(messages.find(row => row.message.to === delayed.destination)?.message.text.includes(originalDeadline), 'delayed sending preserves the original confirmation deadline');
        assert.equal(new Set(messages.map(row => row.message.to)).size, pending.length - 1, 'explicit repeats hand off each invitation once');
        assert.ok(messages.every(row => !row.message.text.includes(edited.title)), 'confirmation invitations mention no past incident');
        const link = messages[0].message.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/u)[0];
        assert.equal((await fetch(link)).status, 200);
        assert.ok((await api('/api/app/subscribers?limit=100')).body.subscribers.some(row => row.destination === messages[0].message.to && row.state === 'active'));
      }
      const undone = await moveIn.undo(result.door); assert.equal(undone.status, 200, JSON.stringify(undone.body));
      assert.equal(undone.body.job.state, 'undone');
      assert.ok(undone.body.undo.dispositions.some(row => row.targetKind === 'incident' && row.disposition === 'retained' && row.reason));
      const retained = (await api('/api/app/incidents')).body.incidents;
      assert.ok(retained.some(row => row.id === edited.id && row.updates.some(update => update.customerImpact === 'Owner correction after import')));
      assert.equal(retained.length, before.incidents + 1, 'untouched source history is removed while the owner correction survives');
    }
    // Published reports, private reports and reusable templates travel with a source,
    // remain private until publication, and retain operator edits through undo.
    const importAll = async files => { const { review, result } = await apply({ files }); return { preview: review, result }; };
    await postmortemTemplateImportFlow({ api, request: (path, init) => nativeRequest(path, init), importAll, moveIn, original: sourceFiles, publicOrigin, preserveEdits: true, fetcher: fetch });
    const beforeIncidentFollowers = await counts();
    incidentSubscriberProbe = true;
    const requestOffset = requests.length;
    try {
      const fetched = await api('/api/app/statuspage-import/fetch', { source: 'statuspage', pageId: 'synthpage01', apiKey });
      assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
      const file = fetched.body.files.find(row => row.name === 'incident-subscribers-followinc001.json');
      assert.equal(JSON.parse(file.text).length, 3, 'the fixed-origin reader retains every unresolved incident follower response');
      const reads = requests.slice(requestOffset).filter(row => new URL(row.url).pathname.endsWith('/subscribers'));
      const incidentReads = reads.filter(row => row.path.includes('/incidents/'));
      assert.equal(incidentReads.length, 1, 'only the unresolved incident follower endpoint is read');
      assert.ok(incidentReads.every(row => new URL(row.url).searchParams.get('per_page') === '100'), 'incident follower reads use documented pagination');
      assert.ok(reads.every(row => row.method === 'GET' && row.authorization === `OAuth ${apiKey}`));
    } finally { incidentSubscriberProbe = false; }
    await incidentSubscriberImportFlow({ t, runtime, api, moveIn, importAll, original: sourceFiles, origin, publicOrigin });
    assert.deepEqual(await counts(), beforeIncidentFollowers, 'incident follower undo leaves the prior installation intact');
    await importedIncidentLiveFlow(sourceFiles);
    assert.deepEqual(await counts(), beforeIncidentFollowers, 'the separate live import proof leaves the undo installation intact');

  } finally { await runtime.close(); }
});
