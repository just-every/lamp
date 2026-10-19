import assert from 'node:assert/strict';
import { createHash, createHmac, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { nativeRequest, openNativeRuntime, origin, operator, publicOrigin } from '../../dev-ingress/runtime.mjs';
import { appOrigin } from './hosts.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { devKey } from '../../helpers/dev-key.mjs';
import { moveInDoor } from '../../helpers/import-notifications.mjs';

const json64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const sorry = family => readdirSync(`tests/fixtures/sorry/${family}`).map(name => ({ name, text: readFileSync(`tests/fixtures/sorry/${family}/${name}`, 'utf8') }));
const byPath = (a, b) => a.path.localeCompare(b.path);

/** RER's signed read of a move to this Lamp (POST /api/rer/cutover-status), through
 * the real Worker on its app host: what it answers after a move-in, alert intake
 * and new native records, and every request it refuses. */
export async function cutoverStatusFlow() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const stranger = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const kid = 'synthetic-business', installationId = randomUUID(), issuer = 'https://business.example.test';
  const trust = { RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify({ [kid]: publicKey.export({ format: 'jwk' }) }), RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId };
  const port = new URL(origin).port;
  const grant = (fields = {}, { key = privateKey, typ = 'rer-import-grant+jwt' } = {}) => {
    const iat = Math.floor(Date.now() / 1000);
    const input = `${json64({ alg: 'ES256', typ, kid })}.${json64({ v: 1, iss: issuer, aud: origin, installationId, email: operator, jti: randomUUID(), iat, exp: iat + 300, action: 'cutover-status', ...fields })}`;
    return `${input}.${sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  };
  const read = async (token, body = { since: new Date(0).toISOString() }, init = { method: 'POST' }) => {
    const response = await nativeRequest('/api/rer/cutover-status', { ...init, ...(body ? { json: body } : {}), headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, text: await response.text() };
  };
  const status = async since => {
    const response = await read(grant(), { since });
    assert.equal(response.status, 200, response.text);
    return { ...JSON.parse(response.text), text: response.text };
  };
  appOrigin(port, trust);
  const runtime = await openNativeRuntime();
  try {
    await runtime.start(); await runtime.seedOperator();
    const cookie = (await signInAs({ origin, key: devKey })).header;
    const owner = async (path, body, method = body ? 'POST' : 'GET', headers) => {
      const response = await nativeRequest(path, { cookie, method, ...(body ? { json: body } : {}), ...(headers ? { headers } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const moveIn = moveInDoor((path, body, headers) => owner(path, body, undefined, headers));
    const list = async () => {
      const [components, incidents, maintenance, subscribers] = await Promise.all(['/api/app/components', '/api/app/incidents', '/api/app/maintenance', '/api/app/subscribers'].map(path => owner(path)));
      return { components: components.body.components.length, incidents: incidents.body.incidents.length, maintenance: maintenance.body.maintenance.length, subscribers: subscribers.body.subscribers };
    };

    // A Sorry move-in: its old addresses, its records and its held subscribers.
    const started = new Date().toISOString();
    const files = sorry('authenticated');
    const preview = await moveIn.preview({ source: 'sorry', files, publicAccessAcknowledged: true, pageId: 'synthpage01' });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const imported = await moveIn.apply(preview.body);
    assert.equal(imported.status, 200, JSON.stringify(imported.body)); assert.equal(imported.body.job.state, 'completed');
    const moved = await list(), cutover = imported.body.report.cutover;
    const afterMove = await status(started);
    assert.ok(cutover.total > 0 && cutover.total <= 25);
    assert.deepEqual(afterMove.old_addresses, { total: cutover.total, sample: cutover.rows.map(({ path, target }) => ({ path, target })).sort(byPath) }, 'the old addresses Cutover lists, with their Lamp targets');
    assert.deepEqual(afterMove.counts, { components: moved.components, incidents: moved.incidents, maintenance: moved.maintenance });
    assert.ok(moved.subscribers.length > 0);
    assert.deepEqual(afterMove.subscribers, { held: moved.subscribers.filter(row => row.state === 'deactivated').length, pending: moved.subscribers.filter(row => row.state === 'pending').length, invited_since: 0 });
    assert.equal(afterMove.subscribers.held, moved.subscribers.length, 'Sorry subscribers are held until cutover');
    assert.deepEqual(afterMove.created_since, { incidents: 0, maintenance: 0, subscribers: 0 }, 'imported records are not records created in Lamp');
    assert.deepEqual(afterMove.intake, { sources: [] });

    // Business keeps the tool's final export as its archive and test-restores it, writing nothing native.
    assert.equal((await owner('/api/app/import-door/settings', { enabled: true }, 'PUT')).status, 200);
    const door = async (action, body) => {
      const response = await nativeRequest(`/api/rer/import/${action}`, { method: 'POST', json: body, headers: { Authorization: `Bearer ${grant({ action, namespace: 'sorry', maxBytes: 8 * 1024 * 1024, maxChunks: 128, maxRecords: 5000 })}` } });
      return { status: response.status, body: await response.json() };
    };
    const bytes = Buffer.from(JSON.stringify({ source: 'sorry', files, pageId: 'synthpage01', publicAccessAcknowledged: true })), sha = createHash('sha256').update(bytes).digest('hex');
    assert.ok(bytes.length <= 65536);
    const upload = await door('uploads', { name: 'sorry-final.json', bundleSha256: sha, totalBytes: bytes.length, totalChunks: 1, index: 0, chunkSha256: sha, base64: bytes.toString('base64') });
    assert.equal(upload.status, 200, JSON.stringify(upload.body));
    const takenAt = new Date().toISOString(), kept = await door('archive', { uploadId: upload.body.uploadId, tool: 'sorry', takenAt });
    assert.equal(kept.status, 200, JSON.stringify(kept.body));
    assert.deepEqual([kept.body.key, kept.body.bundleSha256, kept.body.bytes], [`business-archive/sorry/${takenAt}`, sha, bytes.length]);
    const restored = await door('restore-check', { archiveId: kept.body.archiveId });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.deepEqual([restored.body.bundleSha256, restored.body.counts, restored.body.rejected], [sha, kept.body.counts, []]);
    const archived = await list();
    assert.deepEqual([archived.components, archived.incidents, archived.maintenance, archived.subscribers.length], [moved.components, moved.incidents, moved.maintenance, moved.subscribers.length], 'archive and restore-check write nothing native');
    // Deleting a subscriber the archive names erases the archive's bytes with the rest of the door's content.
    assert.equal((await nativeRequest(`/api/app/subscribers/${moved.subscribers[0].id}`, { cookie, method: 'DELETE' })).status, 204);
    const withdrawn = await door('restore-check', { archiveId: kept.body.archiveId });
    assert.deepEqual([withdrawn.status, withdrawn.body.error], [410, 'archive_withdrawn']);

    // After the switch: an alert through an intake source, and a maintenance window created in Lamp.
    const switched = new Date().toISOString();
    const signingSecret = 'lamp-cutover-status-test-secret';
    const created = await owner('/api/app/intake/sources', { name: 'Cutover monitor', credentialKind: 'hmac-sha256', signingSecret, deduplicationPath: '$.event.key', titlePath: '$.event.summary', statePath: '$.event.state', recoveredValue: 'recovered' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const sourceId = created.body.source.id, body = JSON.stringify({ event: { key: 'checkout-1', summary: 'Checkout errors', state: 'firing' } }), timestamp = new Date().toISOString();
    const alert = await fetch(`${publicOrigin}/api/intake/${sourceId}`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'x-lamp-timestamp': timestamp, 'x-lamp-signature': createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('base64url') } });
    assert.ok(alert.ok, await alert.text());
    const component = (await owner('/api/app/components')).body.components[0].id, hour = 60 * 60 * 1000;
    const window = await owner('/api/app/maintenance', { title: 'Database upgrade', startsAt: new Date(Date.now() + 2 * hour).toISOString(), endsAt: new Date(Date.now() + 3 * hour).toISOString(), componentIds: [component] });
    assert.equal(window.status, 201, JSON.stringify(window.body));
    const now = await list(), afterSwitch = await status(switched);
    assert.deepEqual(afterSwitch.intake, { sources: [{ id: sourceId, kind: 'custom', receipts_since: 1 }] });
    assert.deepEqual(afterSwitch.created_since, { incidents: now.incidents - moved.incidents, maintenance: 1, subscribers: 0 });
    assert.deepEqual(afterSwitch.counts, { components: now.components, incidents: now.incidents, maintenance: now.maintenance });
    assert.deepEqual(afterSwitch.old_addresses, afterMove.old_addresses);
    const later = await status(new Date(Date.now() + hour).toISOString());
    assert.deepEqual([later.intake.sources[0].receipts_since, later.created_since], [0, { incidents: 0, maintenance: 0, subscribers: 0 }]);
    // Counts and ids only: no name, address, title or secret.
    const names = JSON.parse(files.find(file => file.name === 'sorry-components.json').text);
    for (const text of [afterMove.text, afterSwitch.text]) {
      assert.ok(!text.includes('@'), 'no email address');
      for (const value of [signingSecret, 'Cutover monitor', 'Checkout errors', 'Database upgrade', ...JSON.stringify(names).match(/"name":"[^"]+"/g).map(field => field.slice(8, -1))]) assert.ok(!text.includes(value), `no record content: ${value}`);
    }

    // Refusals: RER's signed grant of this action, installation, owner and key only.
    assert.equal((await read(grant(), { since: 'yesterday' })).status, 400);
    assert.equal((await read(undefined)).status, 401, 'unsigned');
    assert.equal((await read(grant(), null, { method: 'GET' })).status, 405);
    const iat = Math.floor(Date.now() / 1000) - 900;
    for (const [label, token] of [
      ['another action', grant({ action: 'runner-status' })],
      ['a door action', grant({ action: 'status' })],
      ['an expired grant', grant({ iat, exp: iat + 300 })],
      ['another installation', grant({ installationId: randomUUID() })],
      ['another owner', grant({ email: 'someone-else@example.test' })],
      ['a door grant', grant({ namespace: 'statuspage', maxBytes: 1, maxChunks: 1, maxRecords: 1 })],
      ['a wrong key', grant({}, { key: stranger })],
      ['an owner claim', grant({}, { typ: 'rer-owner-claim+jwt' })],
    ]) assert.equal((await read(token)).status, 403, label);
    assert.equal((await owner('/api/app/import-door/settings', { enabled: false, revokedKids: [kid] }, 'PUT')).status, 200);
    assert.equal((await read(grant())).status, 403, 'a revoked kid');

    // Self-hosted, without Run Edit Run's trust, the route does not exist.
    await runtime.stop();
    appOrigin(port, {});
    await runtime.start();
    assert.equal((await read(grant())).status, 404);
  } finally { await runtime.close(); }
}
