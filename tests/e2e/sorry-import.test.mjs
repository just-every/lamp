import { businessImportDoorFlow } from './helpers/import-door-flow.mjs';
import { importDoorScale } from './helpers/import-door-scale.mjs';
import { cutoverStatusFlow } from './helpers/cutover-status-flow.mjs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { nativeRequest, openNativeRuntime, origin, publicOrigin } from '../dev-ingress/runtime.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { devKey } from '../helpers/dev-key.mjs';
import { notificationActivity, assertNoNewNotifications, moveInDoor } from '../helpers/import-notifications.mjs';
import { load } from '../operator-readiness/runtime.mjs';

const endpoint = '/api/app/statuspage-import';
/** Whether any import custody row holds the value: plain, in a door upload's
 * base64 chunks, or in a kit job's compressed plan. Reads the local D1 file. */
function custodyHolds(runtime, value) {
  const directory = `${runtime.state}/v3/d1/miniflare-D1DatabaseObject`;
  const db = new DatabaseSync(`${directory}/${readdirSync(directory).find(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite')}`, { readOnly: true });
  const forms = text => [text, ...(/^[A-Za-z0-9+/]+=*$/.test(text) ? [Buffer.from(text, 'base64').toString('utf8')] : []),
    ...(text.includes('"d1Plan":2') ? [inflateRawSync(Buffer.from(JSON.parse(text).data, 'base64')).toString('utf8')] : [])];
  try {
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ik\\_%' ESCAPE '\\'").all().some(({ name }) =>
      db.prepare(`SELECT * FROM "${name}"`).all().some(row => Object.values(row).some(cell => typeof cell === 'string' && forms(cell).some(text => text.toLowerCase().includes(value)))));
  } finally { db.close(); }
}
const fixture = family => readdirSync(`tests/fixtures/sorry/${family}`).map(name => ({ name, text: readFileSync(`tests/fixtures/sorry/${family}/${name}`, 'utf8') }));
const source = { source: 'sorry', publicAccessAcknowledged: true, pageId: 'synthpage01' };

test('MOVE-001 MOVE-002 MOVE-004 MOVE-005 MOVE-006 Sorry and the opt-in Business door preview, apply, reconcile and undo history with subscribers held until cutover, at real size and under a bounded catch-up', { timeout: 900000 }, async () => {
  const runtime = await openNativeRuntime();
  try {
    await runtime.start(); await runtime.seedOperator();
    const cookie = (await signInAs({ origin, key: devKey })).header;
    const call = async (path, body, headers) => {
      const response = await nativeRequest(path, { cookie, ...(body ? { method: 'POST', json: body } : {}), ...(headers ? { headers } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const moveIn = moveInDoor(call);
    const counts = async () => {
      const rows = await Promise.all(['/api/app/components', '/api/app/incidents', '/api/app/maintenance', '/api/app/subscribers'].map(path => call(path)));
      return [rows[0].body.components.length, rows[0].body.groups.length, rows[1].body.incidents.length, rows[2].body.maintenance.length, rows[3].body.subscribers.length];
    };
    const read = files => moveIn.preview({ ...source, files });
    const apply = async files => {
      const preview = await read(files); assert.equal(preview.status, 200, JSON.stringify(preview.body));
      const result = await moveIn.apply(preview.body);
      assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.job.state, 'completed');
      return result.body;
    };
    const undo = async imported => {
      const result = await moveIn.undo(imported.door);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.job.state, 'undone'); return result.body;
    };
    const initial = await counts(), notifications = await notificationActivity(runtime), files = fixture('public');
    const guest = await nativeRequest('/api/operator/import/uploads', { method: 'POST', json: {}, headers: { 'X-Import-Source': 'sorry' } }); assert.equal(guest.status, 401);
    const preview = await read(files); assert.equal(preview.status, 200, JSON.stringify(preview.body));
    for (const [kind, amount] of Object.entries({ component: 2, group: 1, incident: 1, maintenance: 1, subscriber: 0 })) assert.equal(preview.body.report.counts[kind].read, amount);
    assert.deepEqual(await counts(), initial); await assertNoNewNotifications(runtime, notifications);
    assert.equal((await read(files.filter(file => file.name !== 'sorry-notice-100.json'))).status, 400, 'incomplete detail cannot be applied');
    assert.equal((await read([...files, ...fixture('authenticated').filter(file => file.name.includes('subscribers'))])).status, 400, 'public captures cannot contain subscribers');
    const altered = files.map(file => file.name.includes('components') ? { ...file, text: file.text.replace('Billing API', 'Changed billing API') } : file);
    const alteredPlan = await read(altered); assert.equal(alteredPlan.status, 200, JSON.stringify(alteredPlan.body));
    const crossed = await moveIn.apply(alteredPlan.body, preview.body.fingerprint);
    assert.equal(crossed.status, 409, 'a reviewed fingerprint applies only the bytes it reviewed'); assert.equal(crossed.body.error, 'The source or this page changed since the dry run. Review a fresh dry run.');
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
    await undo(imported); assert.deepEqual(await counts(), initial);
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
    const retained = await undo(held);
    assert.ok(retained.undo.dispositions.some(row => row.targetKind === 'subscriber' && row.disposition === 'retained'), 'release changes the held row, so undo cannot claim to retract its invitation');
    // Deleting the subscriber erases their address from every retained import copy.
    assert.ok(custodyHolds(runtime, 'reader@example.invalid'), 'the import retained the address before the deletion');
    assert.equal((await nativeRequest(`/api/app/subscribers/${subscriber.id}`, { cookie, method: 'DELETE' })).status, 204);
    assert.equal(custodyHolds(runtime, 'reader@example.invalid'), false, 'no upload, plan snapshot or import job keeps a deleted subscriber');
  } finally { await runtime.close(); }
  await businessImportDoorFlow({ afterApply: async ({ source, runtime, door, planId, cookies }) => {
    if (source !== 'statuspage') return;
    const directory = `${runtime.state}/v3/d1/miniflare-D1DatabaseObject`;
    const db = new DatabaseSync(`${directory}/${readdirSync(directory).find(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite')}`, { readOnly: true });
    const rows = sql => db.prepare(sql).all().map(row => ({ ...row }));
    const snapshot = () => ({
      incidents: rows('SELECT * FROM incidents ORDER BY id'),
      links: rows('SELECT * FROM incident_components ORDER BY id'),
      updates: rows('SELECT * FROM incident_updates ORDER BY id'),
      components: rows('SELECT * FROM components ORDER BY id'),
      targets: rows('SELECT * FROM statuspage_import_targets ORDER BY kind,id'),
    });
    try {
      const before = snapshot();
      const files = readdirSync('tests/fixtures/statuspage/small').map(name => ({ name, text: readFileSync(`tests/fixtures/statuspage/small/${name}`, 'utf8') }));
      const file = files.find(file => file.name === 'incidents.json');
      const incidents = JSON.parse(file.text), originalName = incidents[0].name;
      const added = structuredClone(incidents[0]);
      added.id = 'i0000000099'; added.shortlink = 'https://stspg.io/99'; added.name = 'Catch-up added incident';
      added.incident_updates = added.incident_updates.map((update, index) => ({ ...update, id: `${added.id}u${index + 1}`, incident_id: added.id }));
      incidents[0].name = `${originalName} (renamed at source)`;
      incidents.push(added); file.text = JSON.stringify(incidents);
      const bytes = Buffer.from(JSON.stringify({ source, files }));
      const hash = bytes => createHash('sha256').update(bytes).digest('hex');
      let uploadId;
      for (let offset = 0, index = 0; offset < bytes.length; offset += 65536, index++) {
        const chunk = bytes.subarray(offset, offset + 65536);
        const uploaded = await door('uploads', source, { ...(uploadId ? { uploadId } : {}), name: 'statuspage-catchup.json', bundleSha256: hash(bytes), totalBytes: bytes.length, totalChunks: Math.ceil(bytes.length / 65536), index, chunkSha256: hash(chunk), base64: chunk.toString('base64') });
        assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body)); uploadId = uploaded.body.uploadId;
      }
      const planned = await door('plan', source, { uploadId, catchup: true });
      assert.equal(planned.status, 200, JSON.stringify(planned.body));
      assert.equal(planned.body.differences.additions.length, 1);
      assert.deepEqual(planned.body.differences.replacements.map(key => JSON.parse(key)[0]).sort(), ['incident', 'metadata'], 'the renamed incident and the namespace source record are replaced');
      assert.deepEqual(planned.body.differences.conflicts, [], 'already-imported subscribers are unchanged, not conflicts');
      assert.deepEqual(snapshot(), before, 'catch-up planning makes no native writes');
      const { planId: catchupId, fingerprint } = planned.body;
      const retainedPlan = JSON.parse(rows(`SELECT body FROM ik_door_plan_chunks WHERE plan_id='${catchupId}' ORDER BY ordinal`).map(row => row.body).join(''));
      const original = before.incidents.find(row => row.title === originalName);
      const priorTarget = before.targets.find(row => row.kind === 'incident' && row.id === original.id);
      const replacement = retainedPlan.plan.entries.flatMap(entry => entry.effects).find(effect => effect.targetKind === 'incident' && effect.targetId === original.id);
      assert.equal(replacement.expectedRevision, priorTarget.revision, 'catch-up is fenced by the current native revision');
      const approval = { fingerprint, approvalRecordId: randomUUID(), approvedAt: new Date().toISOString() };
      let applied;
      for (let round = 0; round < 40; round++) {
        applied = await door('apply', source, { planId: catchupId, reviewedFingerprint: fingerprint }, approval);
        if (applied.status !== 200) console.log('Failed catch-up custody:', JSON.stringify(rows(`SELECT j.state,a.owner,a.approval_id FROM ik_door_plans p JOIN ik_jobs j ON j.id=p.job_id LEFT JOIN ik_door_approvals a ON a.plan_id=p.id WHERE p.id='${catchupId}'`)));
        assert.equal(applied.status, 200, JSON.stringify(applied.body));
        if (applied.body.job.state === 'completed') break;
      }
      assert.equal(applied.body.job.state, 'completed');
      const after = snapshot();
      assert.equal(after.incidents.find(row => row.id === original.id).title, incidents[0].name);
      assert.equal(after.incidents.find(row => row.id === original.id).reference, original.reference, 'the replaced incident keeps its public reference');
      assert.equal(after.incidents.filter(row => row.title === added.name).length, 1);
      assert.equal(after.incidents.length, before.incidents.length + 1);
      assert.equal(new Set(after.incidents.map(row => row.id)).size, after.incidents.length);
      assert.deepEqual(after.components, before.components, 'existing components are reused');
      // The reviewed image leaves columns added after import planning at their defaults.
      assert.deepEqual(after.links.filter(row => row.incident_id === original.id), replacement.value.tables.incident_components.map(row => ({ ...row, detached_internal: 0 })).sort((a, b) => a.id.localeCompare(b.id)), 'replacement links match the full reviewed image');
      assert.ok(after.links.every(row => after.components.some(component => component.id === row.component_id)), 'all incident component links resolve');
      const provenance = rows(`SELECT record_json FROM ik_provenance WHERE job_id='${applied.body.job.id}' AND target_kind='incident' AND target_id='${original.id}'`).map(row => JSON.parse(row.record_json));
      assert.equal(provenance.length, 1);
      assert.equal(provenance[0].before.revision, priorTarget.revision, 'replacement retained the expected previous revision');
      const target = after.targets.find(row => row.kind === 'incident' && row.id === original.id);
      assert.notEqual(target.revision, priorTarget.revision);
      assert.equal(target.revision, provenance[0].appliedRevision, 'native target records the applied revision');
      const reconciled = await door('reconcile', source, { planId: catchupId });
      assert.equal(reconciled.status, 200, JSON.stringify(reconciled.body)); assert.equal(reconciled.body.ok, true);
      if (process.env.LAMP_IMPORT_DOOR_VISUALS) {
        const { captureImportDoor } = await import('./helpers/import-door-visuals.mjs');
        await captureImportDoor({ cookies, source: 'statuspage-catchup', jobId: applied.body.job.id, origin, directory: process.env.LAMP_IMPORT_DOOR_VISUALS });
      }
      const olderUndo = await door('undo', source, { planId });
      assert.equal(olderUndo.status, 409, 'undo must start with the newest catch-up');
      let undone;
      for (let round = 0; round < 40; round++) {
        undone = await door('undo', source, { planId: catchupId });
        assert.equal(undone.status, 200, JSON.stringify(undone.body));
        if (undone.body.job.state === 'undone') break;
      }
      assert.equal(undone.body.job.state, 'undone');
      assert.deepEqual(snapshot(), before, 'catch-up undo restores all previous native records and target revisions');
      assert.equal((await door('reconcile', source, { planId })).body.ok, true);
      console.log('Statuspage catch-up: changed incident replaced, addition unique, revision advanced, reconcile clean, undo restored full previous state.');
    } finally { db.close(); }
  }, afterSources: importDoorScale });
  // RER's signed cutover-status read of a move to this Lamp, and the door's archive of its final export.
  await cutoverStatusFlow();
});
