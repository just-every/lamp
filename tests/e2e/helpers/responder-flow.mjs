import { operationsFlow } from './operations-flow.mjs';
import { operationsEdge } from './operations-edge.mjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { unstable_splitSqlQuery } from 'wrangler';
import { authFixture, secret as sessionSecret } from '../../auth-adoption/runtime.mjs';
import { fixtureProcessEnv } from '../../helpers/worker-environment.mjs';
import { localWranglerConfig } from '../../helpers/wrangler-config.mjs';
import { withDraftVersion } from '../draft-version-helper.mjs';
import { requestHeaders } from '../../helpers/request-headers.mjs';

const require = createRequire(import.meta.url), workerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = workerRequire('miniflare');
const { build } = workerRequire('esbuild');
const execute = promisify(execFile);
const origin = 'https://app.example.test', publicOrigin = 'https://status.example.test';
const signingSecret = 'synthetic-pagerduty-v3-subscription-secret';
const apiKey = 'synthetic-pagerduty-rest-api-key';
const trigger = JSON.parse(await readFile(new URL('../../fixtures/pagerduty/triggered.json', import.meta.url), 'utf8'));

function event(type, id, { incidentId = 'PDINC1', serviceId = 'PAPI123', at = '2026-10-20T01:01:00.000Z', title = trigger.event.data.title } = {}) {
  const payload = structuredClone(trigger);
  Object.assign(payload.event, { id, event_type: `incident.${type}`, occurred_at: at });
  Object.assign(payload.event.data, { id: incidentId, title });
  payload.event.data.service.id = serviceId;
  return payload;
}

// Full application routes in workerd; only the fixed PagerDuty HTTP edge is fake.
// Pause native Vite while this fixture owns a Worker, then resume it for teardown.
export async function responderFlow({ runtime: nativeRuntime, t }) {
  await nativeRuntime.stop();
  const directory = await mkdtemp(join(tmpdir(), 'lamp-pagerduty-'));
  let worker;
  const notes = [], requests = [];
  const edge = operationsEdge();
  let providerStatus = 201;
  try {
    const env = fixtureProcessEnv();
    const configPath = join(directory, 'wrangler.json');
    const config = JSON.parse(localWranglerConfig(value => value, env));
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const built = await build({ entryPoints: ['tests/fixtures/pagerduty/worker.ts'], bundle: true, format: 'esm', platform: 'browser', write: false,
      external: ['cloudflare:workers', 'node:*'], define: { 'import.meta.env.DEV': 'false' },
      plugins: [{ name: 'renderer-assets', setup(builder) {
        builder.onResolve({ filter: /\?(inline|raw)$/ }, args => ({ path: resolve(args.resolveDir, args.path.split('?')[0]), namespace: 'renderer-asset' }));
        builder.onLoad({ filter: /.*/, namespace: 'renderer-asset' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`, loader: 'js' }));
      } }],
    });
    const openWorker = state => new Miniflare(convertV4MiniflareOptions({
      name: 'lamp-pagerduty-proof', host: '127.0.0.1', modules: true, script: built.outputFiles[0].text, port: 0,
      compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
      bindings: { LAMP_PAGE_HOST: new URL(publicOrigin).hostname, LAMP_APP_HOST: new URL(origin).hostname, AUTH_ORIGIN: origin,
        SETUP_OPERATOR_EMAIL: 'operator@example.test', SESSION_SECRET: sessionSecret, MAIL_FROM_ADDRESS: 'status@example.test',
        SUBSCRIBER_TOKEN_SECRET: 'fixture-pagerduty-subscriber-token-secret', WEBHOOK_SIGNING_SECRET: 'fixture-pagerduty-encryption-key-aaaaaaaa' },
      d1Databases: { DB: config.d1_databases[0].database_id }, r2Buckets: { SNAPSHOTS: config.r2_buckets[0].bucket_name },
      durableObjects: { SNAPSHOT_CACHE: { className: 'SnapshotCache', useSQLite: true } }, queueProducers: { JOBS: 'lamp-pagerduty-proof-jobs' },
      resourcePersistencePath: join(state, 'v3'),
      outboundService: async request => {
        if (new URL(request.url).hostname !== 'api.pagerduty.com') return edge.fetch(request);
        requests.push(request.url);
        assert.equal(request.url, 'https://api.pagerduty.com/incidents/PDINC1/notes', 'credentials only reach the fixed PagerDuty note endpoint');
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.get('authorization'), `Token token=${apiKey}`);
        assert.equal(request.headers.get('accept'), 'application/vnd.pagerduty+json;version=2');
        assert.equal(request.headers.get('content-type'), 'application/json');
        assert.equal(request.headers.get('from'), 'operator@example.test', 'the connected owner is the default note author');
        notes.push(await request.json());
        return Response.json(providerStatus === 201 ? { note: { id: `fixture-note-${notes.length}` } } : { error: { message: 'Provider refused note' } }, {
          status: providerStatus, ...(providerStatus === 302 ? { headers: { Location: 'https://credential-leak.example.test/notes' } } : {}),
        });
      },
    }));
    t.diagnostic("PagerDuty: start the real Worker and apply the prior schema.");
    const sourceState = join(directory, 'source');
    worker = openWorker(sourceState);
    await worker.ready;
    t.diagnostic('PagerDuty: Worker ready.');
    const db = await worker.getD1Database('DB');
    t.diagnostic("PagerDuty: D1 binding ready.");
    const migrations = (await readdir('migrations/core')).filter(name => name.endsWith('.sql')).sort();
    const applyMigration = async name => {
      const statements = unstable_splitSqlQuery(await readFile(join('migrations/core', name), 'utf8'));
      await db.batch(statements.map(statement => db.prepare(statement)));
    };
    for (const name of migrations.slice(0, -1)) await applyMigration(name);
    await db.batch([
      db.prepare("INSERT INTO operators(id,email,display_name,is_setup_operator,created_at,updated_at) VALUES('01J00000000000000000000001','operator@example.test','PagerDuty owner',1,'2026-10-20','2026-10-20')"),
      db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('01J00000000000000000000001','operator@example.test','PagerDuty owner','owner','active',?)").bind(Date.now()),
      db.prepare("INSERT INTO oa_bootstrap(singleton,claim_id,claimed_at) VALUES(1,'01J00000000000000000000001',?)").bind(Date.now()),
      db.prepare("INSERT INTO page_settings(id,page_name,tagline,accent_color,timezone,hostname,feed_id,mail_from_address,created_at,updated_at) VALUES('default','PagerDuty proof','','#16794c','UTC','status.example.test','pagerduty-proof-feed','status@example.test','2026-10-20','2026-10-20')"),
      db.prepare("INSERT INTO setup_readiness(step,evidence_key,checked_at) VALUES('first-run','complete','2026-10-20')"),
      db.prepare("INSERT INTO alert_sources(id,name,credential_kind,bearer_token_hash,deduplication_path,title_path,state_path,created_by_operator_id,created_at,updated_at,grouped_preset,label_matchers_json) VALUES('01J00000000000000000000081','Existing Alertmanager source','bearer-token','fixture-existing-token-hash','preset:alertmanager','preset:alertmanager','preset:alertmanager','01J00000000000000000000001','2026-10-19','2026-10-19','alertmanager','[]')"),
      db.prepare("INSERT INTO alert_receipts(id,source_id,request_hash,state,received_at,payload_json,error,created_at,updated_at) VALUES('01J00000000000000000000082','01J00000000000000000000081','fixture-existing-receipt','invalid','2026-10-19','{}','Existing refused payload','2026-10-19','2026-10-19')"),
    ]);
    const preserved = await Promise.all(['operators', 'page_settings', 'alert_sources', 'alert_receipts'].map(async table => ({ table, rows: (await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results })));
    await applyMigration(migrations.at(-1));
    for (const { table, rows } of preserved) {
      const columns = Object.keys(rows[0]).map(name => `"${name}"`).join(',');
      assert.deepEqual((await db.prepare(`SELECT ${columns} FROM ${table} ORDER BY id`).all()).results, rows, `responder migration preserves existing ${table}`);
    }
    t.diagnostic("PagerDuty: migration retained prior rows; authenticate the owner.");
    const cookie = await authFixture(db, { origin, owner: 'operator@example.test' }).signIn();
    const call = async (path, init = {}) => {
      init = await withDraftVersion(path, { ...init, headers: requestHeaders({ Origin: origin }, init.headers) }, call);
      return worker.dispatchFetch(`${origin}${path}`, { ...init, headers: requestHeaders({ Host: new URL(origin).host, Origin: origin, Cookie: cookie,
        'CF-Connecting-IP': '192.0.2.9', ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, init.headers) });
    };
    const api = async (path, init) => {
      const response = await call(path, init), text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null, text };
    };
    const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
    const put = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) });
    const receipts = async sourceId => (await api('/api/app/intake/receipts?limit=250')).body.receipts.filter(row => row.sourceId === sourceId);
    const incident = async id => (await api(`/api/app/incidents/${id}`)).body.incident;
    t.diagnostic("PagerDuty: map signed webhook evidence and publish responder notes.");
    const targets = await Promise.all(['Production API', 'API background workers'].map(name => post('/api/app/components', { groupId: null, name, description: '', internal: false, displayOrder: 0, note: '' })));
    for (const target of targets) assert.equal(target.status, 201, target.text);
    const input = { name: 'PagerDuty production responders', preset: 'pagerduty', credentialKind: 'hmac-sha256', signingSecret,
      labelMatchers: targets.map(target => ({ componentId: target.body.component.id, labels: { service_id: 'PAPI123' } })) };
    const created = await post('/api/app/intake/sources', { ...input, signingSecret: undefined });
    assert.equal(created.status, 201, created.text);
    const source = created.body.source;
    assert.equal(source.responderConnection, 'not-connected');
    assert.equal(source.webhookConnected, false);
    const send = async (payload, { signature, raw = JSON.stringify(payload, null, 2), endpoint = source.endpointUrl } = {}) => {
      const valid = createHmac('sha256', signingSecret).update(raw).digest('hex');
      const response = await worker.dispatchFetch(endpoint, { method: 'POST', headers: { Host: new URL(endpoint).host,
        'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10', 'X-PagerDuty-Signature': signature ?? `v1=${'0'.repeat(64)}, v1=${valid}, v1=${'f'.repeat(64)}` }, body: raw });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await send(trigger)).status, 401, 'an endpoint can be created before the subscription secret is connected');
    assert.deepEqual(await receipts(source.id), []);
    const connected = await put(`/api/app/intake/sources/${source.id}`, { ...input, pagerDutyApiKey: apiKey });
    assert.equal(connected.status, 200, connected.text);
    assert.equal(connected.body.source.webhookConnected, true);
    assert.equal(connected.body.source.responderConnection, 'connected');
    for (const response of [created, connected, await api('/api/app/intake/sources')]) {
      assert.ok(!response.text.includes(signingSecret) && !response.text.includes(apiKey), 'both credentials are write-only');
    }
    assert.ok(!JSON.stringify((await db.prepare('SELECT * FROM alert_sources').all()).results).includes(apiKey), 'REST credential is sealed at rest');
    assert.equal((await send(trigger, { signature: `v1=${'0'.repeat(64)}` })).status, 401);
    assert.deepEqual(await receipts(source.id), [], 'wrong signature records no receipt');
    const originalRaw = JSON.stringify(trigger, null, 2);
    const originalSignature = `v1=${createHmac('sha256', signingSecret).update(originalRaw).digest('hex')}`;
    assert.equal((await send(trigger, { raw: `${originalRaw}\n`, signature: originalSignature })).status, 401, 'a valid signature cannot authenticate changed raw bytes');
    assert.deepEqual(await receipts(source.id), [], 'tampering records no receipt');
    const fired = await send(trigger);
    assert.equal(fired.status, 202, JSON.stringify(fired));
    const id = fired.body.incidentId;
    const initial = await incident(id);
    assert.deepEqual(initial.components.map(row => row.componentId).sort(), targets.map(target => target.body.component.id).sort(), 'every matching service row attaches its component');
    assert.equal(initial.updates.length, 0);
    assert.ok(initial.components.every(row => row.publishedAt === null));
    assert.equal((await send(trigger)).body.incidentId, id, 'delivery replay retains the linked draft');
    assert.equal((await receipts(source.id)).length, 1);
    const timeline = [event('acknowledged', 'PDACK1'), event('escalated', 'PDESC1', { at: '2026-10-20T01:02:00.000Z' })];
    for (const payload of timeline) {
      const accepted = await send(payload);
      assert.equal(accepted.status, 202, JSON.stringify(accepted));
      assert.equal(accepted.body.incidentId, id);
    }
    const brief = (await api(`/api/app/incidents/${id}/brief`)).body.brief;
    for (const payload of timeline) {
      const entry = brief.whatWeKnow.alerts.find(row => row.payload?.event?.id === payload.event.id);
      assert.ok(entry, `${payload.event.event_type} is brief evidence`);
      assert.deepEqual(entry.payload, payload);
      assert.ok(entry.evidenceSummary.includes(payload.event.occurred_at), 'brief shows provider occurrence time');
      assert.ok(entry.evidenceSummary.includes('Primary responder'), 'brief identifies the responder');
    }
    for (const payload of [event('triggered', 'PDUNMAPPED', { serviceId: 'POTHER' }), event('reassigned', 'PDUNSUPPORTED')]) {
      const refused = await send(payload);
      assert.equal(refused.status, 400, JSON.stringify(refused));
      assert.equal(refused.body.incidentId, null);
      const receipt = (await receipts(source.id)).find(row => row.id === refused.body.receiptId);
      assert.equal(receipt.state, 'invalid');
      assert.ok(receipt.error);
    }
    const privateTrigger = event('triggered', 'PDPRIVATE', { incidentId: 'PDPRIVATE1', title: 'Private recovered outage' });
    const privateId = (await send(privateTrigger)).body.incidentId;
    const privateRecovery = await send(event('resolved', 'PDPRIVATERESOLVED', { incidentId: 'PDPRIVATE1', title: privateTrigger.event.data.title }));
    assert.equal(privateRecovery.status, 202);
    const recoveredPrivate = await incident(privateId);
    assert.equal(recoveredPrivate.lifecycle, 'Resolved');
    assert.equal(recoveredPrivate.updates.length, 0);
    const publicBefore = await (await worker.dispatchFetch(`${publicOrigin}/api/public/status`)).text();
    for (const hidden of [initial.reference, recoveredPrivate.reference, privateTrigger.event.data.title]) assert.ok(!publicBefore.includes(hidden));
    assert.equal(notes.length, 0, 'private drafts and responder events send no note');

    const publish = async (customerImpact, lifecycle = 'Investigating') => {
      const saved = await put(`/api/app/incidents/${id}/draft`, { lifecycle, affectedAudience: 'API customers.', customerImpact,
        whatStillWorks: 'The dashboard works.', details: 'Responders are investigating API requests.', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() });
      assert.equal(saved.status, 200, saved.text);
      const published = await post(`/api/app/incidents/${id}/publish`, { channels: [], ...(lifecycle === 'Resolved' ? { overrideReason: 'Owner verified that both API components recovered; publish before the monitor hold expires.' } : {}) });
      assert.equal(published.status, 200, published.text);
      // The public route commits first and runs snapshot/notes with waitUntil.
      // Observe its durable intent reaching an end state before counting HTTP calls.
      const currentDb = await worker.getD1Database('DB');
      for (let attempt = 0; ; attempt++) {
        const pending = await currentDb.prepare("SELECT count(*) AS n FROM alert_responder_posts WHERE incident_update_id = ? AND state IN ('queued','sending')").bind(published.body.update.id).first();
        if (!pending.n) break;
        assert.ok(attempt < 200, 'publication note must reach a recorded end state');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return published;
    };
    t.diagnostic("PagerDuty: publish one note per update, including provider failure.");
    await publish('Some API requests fail.');
    assert.equal(notes.length, 1);
    const note = notes[0].note.content;
    for (const text of ['Some API requests fail.', 'API customers.', 'The dashboard works.', 'Responders are investigating API requests.', `${publicOrigin}/incidents/${initial.reference}`]) assert.ok(note.includes(text));
    await post(`/api/app/incidents/${id}/publish`, { channels: [] });
    assert.equal(notes.length, 1, 'repeating publish without a new draft adds no note');
    assert.equal((await incident(id)).updates.length, 1);
    await publish('API errors are falling.', 'Monitoring');
    assert.equal(notes.length, 2, 'each distinct publication adds exactly one note');
    assert.ok(notes[1].note.content.includes('API errors are falling.'));
    providerStatus = 403;
    await publish('The API remains under observation.', 'Monitoring');
    assert.equal(notes.length, 3);
    assert.equal((await incident(id)).updates.length, 3, 'provider rejection cannot undo a publication');
    const failure = (await receipts(source.id)).find(row => row.state === 'invalid' && row.error?.includes('403'));
    assert.ok(failure && failure.incidentId === id, 'rejected outbound note has a visible linked error receipt');
    assert.ok(!failure.error.includes(apiKey));
    const publicAfter = await (await worker.dispatchFetch(`${publicOrigin}/api/public/status`)).text();
    assert.ok(publicAfter.includes('The API remains under observation.'));
    providerStatus = 302;
    const requestsBeforeRedirect = requests.length;
    await publish('Responders continue to check API health.', 'Monitoring');
    assert.equal(notes.length, 4);
    assert.equal(requests.length, requestsBeforeRedirect + 1, 'a PagerDuty redirect receives one request and is never followed');
    const redirectFailure = (await receipts(source.id)).find(row => row.state === 'invalid' && row.error?.includes('302'));
    assert.ok(redirectFailure && redirectFailure.incidentId === id, 'redirect rejection has a linked operator receipt');
    assert.equal((await incident(id)).updates.length, 4, 'a redirect cannot undo the publication');
    const recovery = await send(event('resolved', 'PDRESOLVED1', { at: '2026-10-20T01:10:00.000Z' }));
    assert.equal(recovery.status, 202);
    assert.equal(recovery.body.incidentId, id);
    assert.equal((await incident(id)).lifecycle, 'Monitoring', 'provider recovery after publication is evidence only');
    assert.equal((await incident(id)).updates.length, 4);
    assert.equal(notes.length, 4);

    t.diagnostic("PagerDuty: export and restore without credentials.");
    let operationsDb = await worker.getD1Database('DB');
    const operations = await operationsFlow({ api, post, put, worker: () => worker, db: () => operationsDb, edge, publicOrigin, t });
    await worker.dispose(); worker = undefined;
    const archive = join(directory, 'archive'), restoredState = join(directory, 'restored');
    const runArchive = (script, args) => execute(process.execPath, [resolve('scripts', script), '--config', configPath, ...args], { env, maxBuffer: 4 * 1024 * 1024 });
    await runArchive('export.mjs', ['--persist-to', sourceState, '--out', archive]);
    const archived = await readFile(join(archive, 'entities.json'), 'utf8');
    operations.assertArchive(archived);
    assert.ok(!archived.includes(apiKey), 'archive contains no REST key');
    const archivedSource = JSON.parse(archived).tables.find(table => table.name === 'alert_sources').rows.find(row => row.id === source.id);
    assert.equal(archivedSource.responder_sealed_credentials, null, 'archive also strips the sealed REST credential');
    await runArchive('import.mjs', ['--persist-to', restoredState, '--from', archive]);
    worker = openWorker(restoredState);
    operationsDb = await worker.getD1Database('DB');
    const restoredSource = (await api('/api/app/intake/sources')).body.sources.find(row => row.id === source.id);
    assert.equal(restoredSource.responderConnection, 'reconnect');
    assert.deepEqual(restoredSource.labelMatchers, input.labelMatchers);
    assert.equal((await incident(id)).updates.length, 4);
    assert.ok((await receipts(source.id)).some(row => row.id === recovery.body.receiptId), 'provider evidence survives restore');
    await publish('Restored operators are checking API health.', 'Monitoring');
    assert.equal(notes.length, 4, 'restored connection sends nothing until the owner reconnects');
    providerStatus = 201;
    const reconnected = await put(`/api/app/intake/sources/${source.id}`, { ...input, pagerDutyApiKey: apiKey });
    assert.equal(reconnected.status, 200, reconnected.text);
    assert.equal(reconnected.body.source.responderConnection, 'connected');
    await publish('Both API components have recovered.', 'Resolved');
    assert.equal(notes.length, 5, 'supplying a new REST key reconnects the restored source');
    const reportDraft = await post(`/api/app/incidents/${id}/report/draft`, {});
    assert.equal(reportDraft.status, 200, reportDraft.text);
    const restoredBrief = (await api(`/api/app/incidents/${id}/brief`)).body.brief;
    for (const payload of timeline) {
      const evidence = restoredBrief.whatWeKnow.alerts.find(row => row.payload?.event?.id === payload.event.id);
      const citedLine = reportDraft.body.report.timeline.split('\n').find(line => line.includes(`[${evidence.ref}]`));
      assert.ok(citedLine, 'report keeps the brief evidence citation');
      for (const text of [payload.event.event_type.slice('incident.'.length), payload.event.occurred_at, 'Primary responder']) assert.ok(citedLine.includes(text), `cited report timeline retains ${text}`);
    }
    const unrelated = await post('/api/app/intake/sources', { ...input, name: 'Independent PagerDuty source' });
    assert.equal(unrelated.status, 201, unrelated.text);
    const otherEvent = await send(event('triggered', 'PDOTHER', { incidentId: 'PDOTHER1' }), { endpoint: unrelated.body.source.endpointUrl });
    assert.equal(otherEvent.status, 202);
    const unconnectedId = otherEvent.body.incidentId;
    const unconnectedDraft = await put(`/api/app/incidents/${unconnectedId}/draft`, { lifecycle: 'Investigating', affectedAudience: 'API customers.',
      customerImpact: 'An independently reviewed API issue.', whatStillWorks: '', details: '', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() });
    assert.equal(unconnectedDraft.status, 200, unconnectedDraft.text);
    const unconnectedPublication = await post(`/api/app/incidents/${unconnectedId}/publish`, { channels: [] });
    assert.equal(unconnectedPublication.status, 200, unconnectedPublication.text);
    assert.equal(notes.length, 5, 'a source without a REST key publishes normally and sends no note');
    const beforeErase = await receipts(source.id);
    assert.ok(beforeErase.length > 0);
    const erased = await api(`/api/app/intake/sources/${source.id}`, { method: 'DELETE' });
    assert.equal(erased.status, 200, erased.text);
    assert.ok(!(await api('/api/app/intake/sources')).body.sources.some(row => row.id === source.id));
    assert.deepEqual(await receipts(source.id), []);
    assert.equal((await receipts(unrelated.body.source.id)).length, 1, 'erasure keeps other sources and their evidence');
    assert.equal((await send(event('triggered', 'PDAFTERERASE'))).status, 404);
    assert.equal((await incident(id)).updates.length, 6, 'source erasure preserves operator publications');
    assert.equal((await incident(id)).lifecycle, 'Resolved');
    assert.equal((await api(`/api/app/incidents/${id}/report`)).body.report.timeline, reportDraft.body.report.timeline, 'source erasure preserves the drafted report');
    const restoredDb = await worker.getD1Database('DB');
    assert.equal((await restoredDb.prepare('SELECT count(*) AS n FROM alert_sources WHERE id=?').bind(source.id).first()).n, 0);
    assert.equal((await restoredDb.prepare('SELECT count(*) AS n FROM alert_responder_posts WHERE source_id=?').bind(source.id).first()).n, 0, 'erasure removes outbound source records too');
    await operations.restored();
    t.diagnostic('PagerDuty workerd proof: signed mapping, private recovery, timed brief, one note per publication, visible HTTP 403, credential-free restore/reconnect, and source erasure.');
  } catch (error) {
    console.error("PagerDuty journey failed:", error);
    throw error;
  } finally {
    await worker?.dispose();
    await rm(directory, { recursive: true, force: true });
    await nativeRuntime.start();
  }
}
