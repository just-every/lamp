import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { operationCredentials } from './operations-edge.mjs';
const fixture = async (preset, action) => JSON.parse(await readFile(new URL(`../fixtures/operations/${preset}-${action.toLowerCase()}.json`, import.meta.url), 'utf8'));

/** Called by the existing responder journey: one real Worker, shared archive/restore,
 * and only provider HTTP edges replaced. No extra registered case. */
export async function operationsFlow({ api, post, put, worker, db, edge, publicOrigin, t }) {
  const states = [];
  for (const preset of ['jsm', 'opsgenie']) {
    t.diagnostic(`INTAKE-014 ${preset}: documented actions, all-component mapping and private notes`);
    const targets = await Promise.all(['API', 'API workers'].map(name => post('/api/app/components', { groupId: null, name: `${name} (${preset})`, description: '', internal: false, displayOrder: 0, note: '' })));
    for (const target of targets) assert.equal(target.status, 201, target.text);
    const input = { name: `${preset} production responders`, preset, credentialKind: 'bearer-token', closeAlertOnResolve: true,
      labelMatchers: [{ componentId: targets[0].body.component.id, labels: { tag: 'component:api' } }, { componentId: targets[1].body.component.id, labels: { entity: 'production-api' } }] };
    for (const credentials of preset === 'jsm' ? [
      { ...operationCredentials.jsm, site: 'https://atlassian.net.evil.example' },
      { ...operationCredentials.jsm, site: 'https://synthetic-lamp.atlassian.net/extra' },
      { ...operationCredentials.jsm, site: 'https://user@synthetic-lamp.atlassian.net' },
    ] : [{ ...operationCredentials.opsgenie, host: 'https://opsgenie.example.test' }]) {
      assert.equal((await post('/api/app/intake/sources', { ...input, operationsCredentials: credentials })).status, 400);
    }
    const created = await post('/api/app/intake/sources', input);
    assert.equal(created.status, 201, created.text);
    const source = created.body.source, token = source.token;
    assert.equal(source.responderConnection, 'not-connected');
    const receipts = async () => (await api('/api/app/intake/receipts?limit=250')).body.receipts.filter(row => row.sourceId === source.id);
    const incident = async id => (await api(`/api/app/incidents/${id}`)).body.incident;
    const send = async (body, credential = token, path = source.endpointUrl) => {
      const response = await worker().dispatchFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const create = await fixture(preset, 'Create');
    assert.equal((await send(create, '')).status, 401);
    assert.equal((await send(create, 'synthetic-lamp-wrong-token')).status, 401);
    assert.equal((await send(create, token, `${source.endpointUrl}/${token}`)).status, 401, 'responder credentials belong in a custom header, never a URL');
    assert.deepEqual(await receipts(), [], 'bad authentication records nothing');
    const fired = await send(create);
    assert.equal(fired.status, 202);
    const id = fired.body.incidentId, initial = await incident(id);
    assert.equal(initial.updates.length, 0);
    assert.deepEqual(initial.components.map(row => row.componentId).sort(), targets.map(row => row.body.component.id).sort());
    assert.ok(initial.components.every(row => row.publishedAt === null));
    assert.equal((await send(create)).body.incidentId, id);
    assert.equal((await receipts()).length, 1, 'delivery replay records once');
    assert.equal((await send({ ...create, alert: { ...create.alert, message: 'Updated API alert' } })).body.incidentId, id, 'alertId dedup keeps one draft');
    const unmapped = await send({ ...create, alert: { ...create.alert, alertId: 'synthetic-lamp-16', tags: [], entity: 'unmapped' } });
    assert.equal(unmapped.status, 400);
    assert.match((await receipts()).find(row => row.id === unmapped.body.receiptId).error, /Unmapped/);
    for (const action of ['Acknowledge', 'Escalate', 'AddNote']) assert.equal((await send(await fixture(preset, action))).status, 202, action);
    const privateNote = (await fixture(preset, 'AddNote')).alert.note;
    const current = await incident(id);
    assert.ok(current.internalNotes.some(note => note.body.includes(privateNote)), 'AddNote enters INCIDENT-008 internal notes');
    const briefResponse = await api(`/api/app/incidents/${id}/brief`);
    assert.ok(!briefResponse.text.includes(privateNote) && !briefResponse.text.includes('AddNote'), 'AddNote never enters the model-shared brief');
    for (const action of ['Acknowledge', 'Escalate']) {
      const entry = briefResponse.body.brief.whatWeKnow.alerts.find(row => row.payload?.action === action);
      assert.ok(entry && entry.evidenceSummary.includes(entry.receivedAt), `${action}: explicitly labelled receipt time`);
      assert.match(entry.evidenceSummary, action === 'Escalate' ? /API responders.*team/ : /API responder.*role not supplied/);
    }
    const rawReceipt = await db().prepare('SELECT payload_json FROM alert_receipts WHERE source_id=?').bind(source.id).all();
    assert.ok(!JSON.stringify(rawReceipt.results).includes(privateNote), 'intake storage never duplicates private note text into alert payloads');
    const privateCreate = { ...create, alert: { ...create.alert, alertId: 'synthetic-lamp-17' } };
    const privateId = (await send(privateCreate)).body.incidentId;
    assert.equal((await send({ ...await fixture(preset, 'Close'), alert: { ...create.alert, alertId: 'synthetic-lamp-17' } })).status, 202);
    assert.equal((await incident(privateId)).lifecycle, 'Resolved');
    assert.equal((await incident(privateId)).updates.length, 0);
    const publicBefore = await (await worker().dispatchFetch(`${publicOrigin}/api/public/status`)).text();
    assert.ok(!publicBefore.includes(initial.reference) && !publicBefore.includes(privateNote));
    const connected = await put(`/api/app/intake/sources/${source.id}`, { ...input, operationsCredentials: operationCredentials[preset] });
    assert.equal(connected.status, 200, connected.text);
    assert.equal(connected.body.source.responderConnection, 'connected');
    for (const secret of Object.values(operationCredentials[preset])) assert.ok(!connected.text.includes(secret), 'connected credential fields are write-only');
    assert.ok(!JSON.stringify((await db().prepare('SELECT * FROM alert_sources WHERE id=?').bind(source.id).first())).includes(preset === 'jsm' ? 'synthetic-lamp-12' : 'synthetic-lamp-14'), 'API credential is sealed at rest');
    const calls = kind => edge.requests.filter(row => row.preset === preset && row.path.endsWith(`/${kind}`));
    const publish = async (text, lifecycle = 'Monitoring') => {
      const saved = await put(`/api/app/incidents/${id}/draft`, { lifecycle, affectedAudience: 'API customers.', customerImpact: text, whatStillWorks: 'Dashboard works.', details: 'Responders are checking API requests.', nextUpdateAt: new Date(Date.now() + 3600000).toISOString() });
      assert.equal(saved.status, 200, saved.text);
      const published = await post(`/api/app/incidents/${id}/publish`, { channels: [], ...(lifecycle === 'Resolved' ? { overrideReason: 'Owner verified that the API recovered before the monitor hold expires.' } : {}) });
      assert.equal(published.status, 200, published.text);
      for (let attempt = 0; ; attempt++) {
        const pending = await db().prepare("SELECT count(*) AS n FROM alert_responder_posts WHERE incident_update_id=? AND (state IN ('queued','sending') OR close_state IN ('queued','sending'))").bind(published.body.update.id).first();
        if (!pending.n) break;
        assert.ok(attempt < 200, 'responder publication reaches a durable end state');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return published;
    };
    await publish('API requests are failing.', 'Investigating');
    assert.equal(calls('notes').length, 1);
    for (const text of ['API requests are failing.', 'API customers.', 'Dashboard works.', 'Responders are checking API requests.', `${publicOrigin}/incidents/${initial.reference}`]) assert.ok(calls('notes')[0].body.note.includes(text));
    assert.equal((await post(`/api/app/incidents/${id}/publish`, { channels: [] })).status, 409, 'another publication requires a saved draft');
    assert.equal(calls('notes').length, 1, 'repeated publish adds no note');
    edge.statuses[preset] = 403;
    await publish('API recovery is being checked.');
    assert.equal(calls('notes').length, 2);
    assert.ok((await receipts()).some(row => row.error?.includes('403')), 'provider rejection appears in source receipts');
    edge.statuses[preset] = 302;
    await publish('API checking continues.');
    assert.equal(calls('notes').length, 3, 'redirect is not followed');
    assert.ok((await receipts()).some(row => row.error?.includes('302')));
    assert.equal((await incident(id)).updates.length, 3, 'failed outbound requests never block publication');
    assert.equal((await send(await fixture(preset, 'Close'))).status, 202);
    assert.equal((await incident(id)).lifecycle, 'Monitoring', 'published recovery is evidence only');
    assert.equal(calls('close').length, 0, 'incoming Close never calls the provider');
    states.push({ preset, input, source, token, id, privateNote, calls, publish, receipts, incident, send });
  }
  return {
    assertArchive(text) {
      const rows = JSON.parse(text).tables.find(table => table.name === 'alert_sources').rows;
      for (const state of states) {
        const row = rows.find(row => row.id === state.source.id);
        assert.equal(row.responder_sealed_credentials, null);
        assert.equal(row.responder_connected, 1);
      }
    },
    async restored() {
      for (const state of states) {
        const { preset, input, source, id, privateNote, calls, publish, receipts, incident, send } = state;
        assert.equal((await api('/api/app/intake/sources')).body.sources.find(row => row.id === source.id).responderConnection, 'reconnect');
        await publish('Restored operators are checking the API.');
        assert.equal(calls('notes').length, 3, 'restored sources send nothing until reconnected');
        assert.equal((await put(`/api/app/intake/sources/${source.id}`, { ...input, operationsCredentials: operationCredentials[preset] })).status, 200);
        edge.statuses[preset] = preset === 'jsm' ? 200 : 202;
        await publish('The API has recovered.', 'Resolved');
        assert.equal(calls('notes').length, 4);
        assert.equal(calls('close').length, 1, 'opt-in Resolved publication closes exactly once');
        const close = await fixture(preset, 'Close');
        const echoed = await send({ ...close, alert: { ...close.alert, username: 'Responder after Lamp resolution' } });
        assert.equal(echoed.status, 202, 'a provider Close echoed after the resolved publication remains recovery evidence');
        assert.equal(echoed.body.incidentId, id);
        assert.equal((await incident(id)).lifecycle, 'Resolved');
        assert.equal((await post(`/api/app/incidents/${id}/publish`, { channels: [] })).status, 409, 'another publication requires a saved draft');
        assert.equal(calls('notes').length, 4); assert.equal(calls('close').length, 1);
        const report = await post(`/api/app/incidents/${id}/report/draft`, {});
        assert.equal(report.status, 200, report.text);
        const brief = (await api(`/api/app/incidents/${id}/brief`)).body.brief;
        for (const action of ['Acknowledge', 'Escalate']) {
          const evidence = brief.whatWeKnow.alerts.find(row => row.payload?.action === action);
          assert.ok(report.body.report.timeline.includes(`[${evidence.ref}]`) && report.body.report.timeline.includes(evidence.evidenceSummary), 'AGENT-005 retains cited responder evidence');
        }
        const publicAfter = await (await worker().dispatchFetch(`${publicOrigin}/api/public/status`)).text();
        assert.ok(!JSON.stringify(report).includes(privateNote) && !publicAfter.includes(privateNote));
        assert.equal((await api(`/api/app/intake/sources/${source.id}`, { method: 'DELETE' })).status, 200);
        assert.deepEqual(await receipts(), []);
        assert.equal((await db().prepare('SELECT count(*) AS n FROM alert_responder_posts WHERE source_id=?').bind(source.id).first()).n, 0);
        assert.equal((await incident(id)).updates.length, 5, 'source erasure preserves operator history');
      }
      t.diagnostic('INTAKE-014: both provider edges, private internal notes, recorded recovery, idempotent note and close, credential-free archive and reconnect, and source erasure passed.');
    },
  };
}
