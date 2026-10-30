import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { openStatusJourney } from './helpers/status-journey.mjs';
import { sorryReceiptFlow } from './helpers/sorry-receipt-flow.mjs';
import { notificationActivity, assertNoNewNotifications, moveInDoor } from '../helpers/import-notifications.mjs';

const fixture = (source, family) => readdirSync(`tests/fixtures/${source}/${family}`).map(name => ({ name, text: readFileSync(`tests/fixtures/${source}/${family}/${name}`, 'utf8') }));
const json64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Erasure is observable through the route and retained archive. Inspect custody
// only to prove that no alternate compressed/upload copy keeps the erased address.
async function custodyHolds(runtime, value) {
  const db = runtime.db;
  const forms = text => [text, ...(/^[A-Za-z0-9+/]+=*$/.test(text) ? [Buffer.from(text, 'base64').toString('utf8')] : []), ...(text.includes('"d1Plan":2') ? [inflateRawSync(Buffer.from(JSON.parse(text).data, 'base64')).toString('utf8')] : [])];
  for (const { name } of (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ik\\_%' ESCAPE '\\'").all()).results) {
    const rows = (await db.prepare(`SELECT * FROM "${name}"`).all()).results;
    if (rows.some(row => Object.values(row).some(cell => typeof cell === 'string' && forms(cell).some(text => text.toLowerCase().includes(value))))) return true;
  }
  return false;
}

test('MOVE-001 MOVE-002 MOVE-003 MOVE-004 MOVE-005 MOVE-006 — Sorry move-in, Business approval, bounded catch-up, original archive, cutover and erasure remain one recoverable owner flow', { timeout: 600_000 }, async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const kid = 'synthetic-business', installationId = randomUUID(), issuer = 'https://business.example.test';
  const trust = { RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify({ [kid]: publicKey.export({ format: 'jwk' }) }), RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId };
  const runtime = await openStatusJourney({ extraBindings: trust });
  const origin = runtime.appOrigin, publicOrigin = runtime.publicOrigin, operator = 'synthetic-lamp-owner@example.test';
  const fetch = (input, init) => runtime.raw(input, init);
  const nativeRequest = (path, { json, ...init } = {}) => runtime.raw(path, { ...init, ...(json === undefined ? {} : { body: JSON.stringify(json), headers: { 'Content-Type': 'application/json', ...init.headers } }) });
  try {
    const owner = async (path, body, method = body === undefined ? 'GET' : 'POST', headers) => {
      const response = await runtime.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    };
    const grant = (action, namespace, extra = {}) => {
      const iat = Math.floor(Date.now() / 1000);
      const input = `${json64({ alg: 'ES256', typ: 'rer-import-grant+jwt', kid })}.${json64({ v: 1, iss: issuer, aud: origin, installationId, email: operator, jti: randomUUID(), iat, exp: iat + 300, action, ...(namespace ? { namespace, maxBytes: 8 * 1024 * 1024, maxChunks: 128, maxRecords: 5000 } : {}), ...extra })}`;
      return `${input}.${sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    };
    const door = async (action, source, body, approval = {}) => {
      const response = await nativeRequest(`/api/rer/import/${action}`, { method: 'POST', json: body, headers: { Authorization: `Bearer ${grant(action, source, approval)}` } });
      return { status: response.status, body: await response.json() };
    };
    const snapshot = async () => {
      const rows = await Promise.all(['/api/app/components', '/api/app/incidents', '/api/app/maintenance', '/api/app/subscribers'].map(path => owner(path)));
      return { components: rows[0].body.components, incidents: rows[1].body.incidents, maintenance: rows[2].body.maintenance, subscribers: rows[3].body.subscribers };
    };
    const cutover = async () => {
      const response = await nativeRequest('/api/rer/cutover-status', { method: 'POST', json: { since: new Date(0).toISOString() }, headers: { Authorization: `Bearer ${grant('cutover-status')}` } });
      assert.equal(response.status, 200, await response.clone().text()); return response.json();
    };
    const moveIn = moveInDoor((path, body, headers) => owner(path, body, undefined, headers));
    const source = { source: 'sorry', pageId: 'synthpage01', publicAccessAcknowledged: true };
    const preview = async files => { const result = await moveIn.preview({ ...source, files }); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
    const apply = async files => {
      const review = await preview(files), result = await moveIn.apply(review);
      assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.job.state, 'completed'); return result.body;
    };
    const undo = async imported => { const result = await moveIn.undo(imported.door); assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.job.state, 'undone'); return result.body; };
    await sorryReceiptFlow(async files => {
      const reviewed = await moveIn.preview({ ...source, files });
      assert.equal(reviewed.status, 200, `every .json file of a fresh capture folder is accepted: ${JSON.stringify(reviewed.body)}`);
    });
    const initial = await snapshot(), quiet = await notificationActivity(runtime);
    const publicFiles = fixture('sorry', 'public');
    await preview(publicFiles); assert.deepEqual(await snapshot(), initial, 'public saved-response review writes nothing');
    assert.equal((await moveIn.preview({ ...source, files: publicFiles.filter(file => file.name !== 'sorry-notice-100.json') })).status, 400, 'incomplete source history is refused');
    const publicImport = await apply(publicFiles);
    const verification = await owner(`/api/app/statuspage-import/jobs/${publicImport.job.id}/verification`);
    assert.equal(verification.status, 200);
    assert.equal(verification.body.unexplainedDifferences, 0);
    assert.deepEqual(verification.body.manifests.rows.source, verification.body.manifests.rows.target);
    assert.deepEqual(verification.body.manifests.provenance.source, verification.body.manifests.provenance.target);
    assert.equal((await nativeRequest(`/api/app/statuspage-import/jobs/${publicImport.job.id}/verification`)).status, 401, 'receipt evidence requires the current owner session');
    const publicIncident = (await snapshot()).incidents[0];
    const sourceNotice = JSON.parse(publicFiles.find(file => file.name === 'sorry-notice-100.json').text).notice;
    assert.deepEqual(publicIncident.updates.map(row => Date.parse(row.publishedAt)).sort(), sourceNotice.updates.map(row => Date.parse(row.created_at)).sort());
    for (const path of ['/notices/100', '/notices/synthetic-delayed-invoice-processing']) {
      const response = await fetch(publicOrigin + path, { redirect: 'manual' }); assert.equal(response.status, 301);
      assert.equal(response.headers.get('location'), `/incidents/${publicIncident.reference}`);
      assert.equal((await fetch(publicOrigin + response.headers.get('location'))).status, 200);
    }
    const history = await fetch(publicOrigin + '/history/2025/april', { redirect: 'manual' }); assert.equal(history.status, 301); assert.equal(history.headers.get('location'), '/history/');
    assert.equal((await apply(publicFiles)).job.id, publicImport.job.id);
    await undo(publicImport); assert.deepEqual(await snapshot(), initial);
    assert.equal((await fetch(publicOrigin + '/notices/100', { redirect: 'manual' })).status, 404);
    const authenticatedFiles = fixture('sorry', 'authenticated');
    const held = await apply(authenticatedFiles), moved = await snapshot();
    assert.ok(moved.subscribers.length && moved.subscribers.every(row => row.state === 'deactivated'), 'source subscribers stay held until the owner approves cutover');
    assert.ok(moved.maintenance.every(row => row.notices.length === 0), 'old maintenance sends no new notice');
    const status = await cutover();
    assert.equal(status.subscribers.held, moved.subscribers.length);
    assert.deepEqual(status.old_addresses.sample, held.report.cutover.rows.map(({ path, target }) => ({ path, target })).sort((a, b) => a.path.localeCompare(b.path)));
    assert.ok(!JSON.stringify(status).includes(moved.subscribers[0].destination), 'Business cutover status reveals counts, never destinations');
    await assertNoNewNotifications(runtime, quiet);
    assert.equal((await owner(`/api/app/statuspage-import/jobs/${held.job.id}/send-invitations`, {})).status, 409);
    assert.equal((await door('uploads', 'sorry', {})).status, 404, 'the Business door requires owner opt-in');
    assert.equal((await owner('/api/app/import-door/settings', { enabled: true }, 'PUT')).status, 200);
    const upload = async (namespace, files, name) => {
      const bytes = Buffer.from(JSON.stringify({ source: namespace, files, ...(namespace === 'sorry' ? { pageId: source.pageId, publicAccessAcknowledged: true } : {}) }));
      let uploadId;
      for (let offset = 0, index = 0; offset < bytes.length; offset += 65536, index++) {
        const chunk = bytes.subarray(offset, offset + 65536);
        const result = await door('uploads', namespace, { ...(uploadId ? { uploadId } : {}), name, bundleSha256: hash(bytes), totalBytes: bytes.length, totalChunks: Math.ceil(bytes.length / 65536), index, chunkSha256: hash(chunk), base64: chunk.toString('base64') });
        assert.equal(result.status, 200, JSON.stringify(result.body)); uploadId = result.body.uploadId;
      }
      return uploadId;
    };
    const saved = await upload('sorry', authenticatedFiles, 'sorry-final.json');
    const archive = await door('archive', 'sorry', { uploadId: saved, tool: 'sorry', takenAt: new Date().toISOString() }); assert.equal(archive.status, 200, JSON.stringify(archive.body));
    const restored = await door('restore-check', 'sorry', { archiveId: archive.body.archiveId }); assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.deepEqual(restored.body.counts, archive.body.counts); assert.deepEqual(restored.body.rejected, []);
    assert.deepEqual(await snapshot(), moved, 'archive restore-check never writes native records');
    const released = await owner(`/api/app/statuspage-import/jobs/${held.job.id}/send-invitations`, { liveOrigin: publicOrigin, hostnameLive: true, watchWindowClosed: true });
    assert.equal(released.status, 200, JSON.stringify(released.body));
    assert.equal((await owner(`/api/app/statuspage-import/jobs/${held.job.id}/send-invitations`, { liveOrigin: publicOrigin, hostnameLive: true, watchWindowClosed: true })).body.invites.sent, 0);
    const subscriber = moved.subscribers[0]; assert.ok(await custodyHolds(runtime, subscriber.destination));
    assert.equal((await owner(`/api/app/subscribers/${subscriber.id}`, undefined, 'DELETE')).status, 204);
    assert.equal(await custodyHolds(runtime, subscriber.destination), false);
    const erasedArchive = await door('restore-check', 'sorry', { archiveId: archive.body.archiveId }); assert.equal(erasedArchive.status, 410);
    await undo(held);

    // A retained Business approval can catch up a large source within its scope.
    // The whole reviewed source is compared through native routes after each step.
    const files = fixture('statuspage', 'small');
    const incidentFile = files.find(file => file.name === 'incidents.json');
    const seed = JSON.parse(incidentFile.text)[0];
    const incidents = Array.from({ length: 60 }, (_, index) => {
      const id = `business${index}`;
      return { ...structuredClone(seed), id, shortlink: `https://stspg.io/${id}`, name: `Business history ${index}`, incident_updates: seed.incident_updates.map((row, ordinal) => ({ ...row, id: `${id}u${ordinal}`, incident_id: id })) };
    });
    incidentFile.text = JSON.stringify(incidents);
    const baseline = await snapshot();
    const plan = async (exportFiles, extra = {}) => door('plan', 'statuspage', { uploadId: await upload('statuspage', exportFiles, 'statuspage-history.json'), ...(extra.catchup ? { catchup: true } : {}) }, extra);
    const run = async (action, planned, approval = {}) => {
      let result;
      for (let batch = 0; batch < 100; batch++) {
        result = await door(action, 'statuspage', { planId: planned.planId, ...(action === 'apply' ? { reviewedFingerprint: planned.fingerprint } : {}) }, approval);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        if (['completed', 'undone'].includes(result.body.job?.state)) return result.body;
      }
      assert.fail(`${action} did not finish`);
    };
    const reviewed = await plan(files); assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.deepEqual(await snapshot(), baseline, 'Business planning writes nothing native');
    const approval = { fingerprint: reviewed.body.fingerprint, approvalRecordId: randomUUID(), approvedAt: new Date().toISOString() };
    assert.equal((await door('apply', 'statuspage', { planId: reviewed.body.planId, reviewedFingerprint: 'unreviewed' }, approval)).status, 403);
    const firstBusiness = await run('apply', reviewed.body, approval);
    const imported = await snapshot(), original = imported.incidents.find(row => row.title === incidents[1].name);
    assert.equal(imported.incidents.length, baseline.incidents.length + incidents.length);
    assert.ok(imported.subscribers.every(row => row.state === 'deactivated'), 'Business never activates subscribers on import');
    assert.equal((await door('reconcile', 'statuspage', { planId: reviewed.body.planId })).body.ok, true);
    const changedFiles = structuredClone(files), changedRows = structuredClone(incidents);
    changedRows[1].name += ' corrected at source';
    const addition = structuredClone(incidents[0]); addition.id = 'business-added'; addition.name = 'New source incident'; addition.shortlink = 'https://stspg.io/business-added';
    addition.incident_updates = addition.incident_updates.map((row, ordinal) => ({ ...row, id: `${addition.id}u${ordinal}`, incident_id: addition.id })); changedRows.push(addition);
    changedFiles.find(file => file.name === 'incidents.json').text = JSON.stringify(changedRows);
    const standing = { catchup: 'bounded', approvalRecordId: randomUUID(), approvedAt: new Date().toISOString() };
    const caught = await plan(changedFiles, standing); assert.equal(caught.status, 200, JSON.stringify(caught.body));
    assert.deepEqual(await snapshot(), imported, 'catch-up review writes nothing');
    await run('apply', caught.body, { ...standing, fingerprint: caught.body.fingerprint });
    const updated = await snapshot();
    assert.ok(updated.incidents.some(row => row.id === original.id && row.reference === original.reference && row.title === changedRows[1].name));
    assert.equal(updated.incidents.filter(row => row.title === addition.name).length, 1);
    assert.equal((await door('reconcile', 'statuspage', { planId: caught.body.planId })).body.ok, true);
    assert.equal((await door('undo', 'statuspage', { planId: reviewed.body.planId })).status, 409, 'undo begins with the newest catch-up');
    await run('undo', caught.body); assert.deepEqual(await snapshot(), imported, 'catch-up undo restores the original native documents');
    const over = structuredClone(changedFiles), overRows = JSON.parse(over.find(file => file.name === 'incidents.json').text);
    for (const row of overRows.slice(2, 6)) row.name += ' additional source edit';
    over.find(file => file.name === 'incidents.json').text = JSON.stringify(overRows);
    assert.equal((await plan(over, standing)).status, 409, 'larger changes need a new proposal');
    assert.equal((await owner(`/api/app/incidents/${original.id}`, { reason: 'Owner edit after import' }, 'DELETE')).status, 200);
    const editedEvidence = await owner(`/api/app/statuspage-import/jobs/${firstBusiness.job.id}/verification`);
    assert.equal(editedEvidence.status, 200);
    assert.ok(editedEvidence.body.unexplainedDifferences > 0, 'receipt evidence detects a native record removed through its real owner door');
    assert.equal((await plan(changedFiles, standing)).status, 409, 'standing approval cannot replace an owner edit');
    await run('undo', reviewed.body);
    const token = grant('uploads', 'statuspage');
    assert.equal((await owner('/api/app/import-door/settings', { enabled: true, revokedKids: [kid] }, 'PUT')).status, 200);
    const revoked = await nativeRequest('/api/rer/import/uploads', { method: 'POST', json: {}, headers: { Authorization: `Bearer ${token}` } }); assert.equal(revoked.status, 403);
    assert.equal((await owner('/api/app/import-door/settings', { enabled: false }, 'PUT')).status, 200);
    assert.equal((await door('uploads', 'statuspage', {})).status, 404, 'owner disable removes the Business import door');
    const revokedRead = await nativeRequest('/api/rer/cutover-status', { method: 'POST', json: { since: new Date(0).toISOString() }, headers: { Authorization: `Bearer ${grant('cutover-status')}` } });
    assert.equal(revokedRead.status, 403, 'revoked Business authority cannot read cutover state');
  } finally { await runtime.close(); }
});
