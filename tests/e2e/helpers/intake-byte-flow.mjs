import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openFollowUpsRuntime } from './follow-ups-runtime.mjs';

export async function intakeInventory(sql) {
  return Object.fromEntries(await Promise.all(['incidents', 'incident_drafts', 'incident_updates', 'alert_receipts', 'audit_entries'].map(async table =>
    [table, await sql(`SELECT * FROM ${table} ORDER BY id`)])));
}

/** Boundary requests traverse the real public route with the Worker's clock fixed. */
export async function intakeAuthenticationFlow({ t }) {
  const fixture = await openFollowUpsRuntime({ workerEntry: 'tests/e2e/helpers/automation-clock-worker.ts' });
  const { api, post, raw, db, publicOrigin } = fixture;
  const inventory = () => intakeInventory(async command => (await db.prepare(command).all()).results);
  const clock = Date.now() + 60_000;
  const secret = 'synthetic-lamp-intake-signing-1';
  const token = 'synthetic-lamp-intake-bearer-1';
  const mapping = { deduplicationPath: '$.key', titlePath: '$.title', statePath: '$.state' };
  const payload = key => JSON.stringify({ key, title: `Synthetic Lamp ${key}`, state: 'firing' });
  const createSource = async input => {
    const created = await post('/api/app/intake/sources', { ...mapping, ...input });
    assert.equal(created.status, 201, created.text);
    return created.body.source;
  };
  const send = (source, body, headers) => raw(`${publicOrigin}${source.endpointPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  const signedHeaders = (source, body, at, key = secret) => ({
    [source.timestampHeader]: at,
    [source.signatureHeader]: createHmac('sha256', key).update(`${at}.${body}`).digest('base64url'),
  });
  const admitted = async (source, body, headers) => {
    const response = await send(source, body, headers);
    assert.equal(response.status, 202, await response.clone().text());
    const accepted = await response.json();
    assert.equal(accepted.replayed, false, 'each boundary payload is a distinct admitted delivery');
    const receipt = (await api(`/api/app/intake/receipts?receipt=${accepted.receiptId}`)).body.receipts[0];
    assert.equal(receipt.id, accepted.receiptId);
    assert.equal(receipt.sourceId, source.id);
    assert.equal(receipt.deduplicationKey, JSON.parse(body).key);
    assert.equal(receipt.incidentId, accepted.incidentId);
    assert.equal(receipt.state, 'firing');
    assert.equal((await api(`/api/app/incidents/${accepted.incidentId}`)).body.incident.title, JSON.parse(body).title);
    return accepted;
  };
  const refused = async (source, body, headers, label) => {
    const before = await inventory();
    const response = await send(source, body, headers);
    assert.equal(response.status, 401, label);
    assert.deepEqual(await response.json(), { error: 'Invalid alert credential.' });
    assert.deepEqual(await inventory(), before, `${label}: every persisted incident, draft, update, receipt and audit field remains unchanged`);
  };
  try {
    const frozen = await raw('/test/clock', { method: 'PUT', body: JSON.stringify({ now: clock }) });
    assert.equal(frozen.status, 204, await frozen.text());
    const sources = [];
    for (const headers of [{}, { timestampHeader: 'x-monitor-at', signatureHeader: 'x-monitor-sign' }]) {
      const source = await createSource({ name: `Synthetic Lamp boundary ${sources.length}`, credentialKind: 'hmac-sha256', signingSecret: secret, ...headers });
      sources.push(source);
      const accepted = [];
      for (const offset of [-300_000, 300_000]) {
        const body = payload(`${source.id}-boundary-${offset}`), at = new Date(clock + offset).toISOString();
        accepted.push(await admitted(source, body, signedHeaders(source, body, at)));
      }
      assert.notEqual(accepted[0].receiptId, accepted[1].receiptId);
      assert.notEqual(accepted[0].incidentId, accepted[1].incidentId);
    }

    // Populate publications and audits too: refusal invariance must preserve real data.
    const target = await post('/api/app/components', { name: 'Synthetic Lamp authentication control', groupId: null, description: '', internal: false, displayOrder: 0, note: '' });
    assert.equal(target.status, 201, target.text);
    const control = (await api('/api/app/incidents')).body.incidents[0];
    assert.equal((await post(`/api/app/incidents/${control.id}/components`, { componentId: target.body.component.id, state: 'Major outage', relationship: 'Primary' })).status, 201);
    const draft = await api(`/api/app/incidents/${control.id}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle: 'Investigating', affectedAudience: 'Synthetic Lamp customers.', customerImpact: 'Synthetic Lamp requests are failing.', whatStillWorks: '', details: '', nextUpdateAt: new Date(clock + 3_600_000).toISOString() }) });
    assert.equal(draft.status, 200, draft.text);
    const published = await post(`/api/app/incidents/${control.id}/publish`, { channels: [] });
    assert.equal(published.status, 200, published.text);
    for (const [table, rows] of Object.entries(await inventory())) assert.ok(rows.length > 0, `${table} has populated control records`);

    for (const source of sources) {
      for (const offset of [-300_001, 300_001]) {
        const body = payload(`${source.id}-outside-${offset}`), at = new Date(clock + offset).toISOString();
        await refused(source, body, signedHeaders(source, body, at), `timestamp offset ${offset} milliseconds`);
      }
      const body = payload(`${source.id}-refused`), at = new Date(clock).toISOString();
      const headers = signedHeaders(source, body, at);
      for (const [label, credentials] of [
        ['absent HMAC credentials', {}],
        ['absent HMAC timestamp', { [source.signatureHeader]: headers[source.signatureHeader] }],
        ['absent HMAC signature', { [source.timestampHeader]: at }],
        ['malformed HMAC timestamp', signedHeaders(source, body, 'synthetic-lamp-not-a-date')],
        ['malformed HMAC signature', { ...headers, [source.signatureHeader]: 'synthetic-lamp-!invalid!' }],
        ['non-matching HMAC secret', signedHeaders(source, body, at, 'synthetic-lamp-wrong-secret')],
      ]) await refused(source, body, credentials, label);
    }

    const bearer = await createSource({ name: 'Synthetic Lamp generic bearer monitor', credentialKind: 'bearer-token', bearerToken: token });
    await admitted(bearer, payload('synthetic-lamp-bearer-accepted'), { Authorization: `Bearer ${token}` });
    for (const [label, authorization] of [
      ['absent bearer', undefined], ['missing bearer value', 'Bearer'],
      ['wrong bearer scheme', `Basic ${token}`], ['malformed bearer value', `Bearer ${token} extra`],
      ['non-matching bearer', 'Bearer synthetic-lamp-wrong-token'],
    ]) await refused(bearer, payload(`synthetic-lamp-${label}`), authorization === undefined ? {} : { Authorization: authorization }, label);
    t.diagnostic('PROBE INTAKE-001 acceptance 1: native public intake with controlled Worker time admits distinct signed payloads at -300000 and +300000 ms; -300001 and +300001 ms return 401.');
    t.diagnostic('PROBE INTAKE-001 acceptance 2: native public intake with the configured bearer returns 202 and the matching persisted receipt and incident.');
    t.diagnostic('PROBE INTAKE-001 acceptance 3: absent, malformed, stale and non-matching HMAC and bearer credentials return 401; complete ordered populated incident, draft, update, receipt and audit inventories stay identical after every refusal.');
  } finally { await fixture.close(); }
}

/** Public-route authentication must bind the bytes, before any JSON decoding. */
export async function intakeByteFlow({ api, post, publicOrigin, source, payload, secret, sql }) {
  const generic = { name: 'Exact-byte generic source', credentialKind: 'hmac-sha256', signingSecret: secret, deduplicationPath: '$.key', titlePath: '$.title', statePath: '$.state' };
  const sources = [{ source, payload }, ...await Promise.all([{}, { timestampHeader: 'x-monitor-at', signatureHeader: 'x-monitor-sign' }].map(async headers => {
    const created = await post('/api/app/intake/sources', { ...generic, name: `${generic.name} ${headers.timestampHeader ?? 'default'}`, ...headers });
    assert.equal(created.status, 201, created.text);
    return { source: created.body.source, payload: { key: created.body.source.id, title: 'Café monitor', state: 'firing' } };
  }))];
  for (const { source, payload } of sources) {
    const timestamp = new Date().toISOString();
    const raw = Buffer.from(JSON.stringify(payload));
    const sign = (body, at = timestamp) => createHmac('sha256', secret).update(`${at}.`).update(body).digest('base64url');
    const send = (body, signature = sign(body), at = timestamp) => fetch(source.endpointUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', [source.timestampHeader]: at, [source.signatureHeader]: signature }, body });
    const before = {
      receipts: (await api('/api/app/intake/receipts?limit=250')).body,
      incidents: (await api('/api/app/incidents')).body,
      page: await (await fetch(`${publicOrigin}/api/public/status`)).text(),
    };
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw]);
    const replacement = Buffer.from(JSON.stringify({ ...payload, title: 'byte-�-evidence' }));
    const invalid = Buffer.concat([replacement.subarray(0, replacement.indexOf(Buffer.from('�'))), Buffer.from([0x80]), replacement.subarray(replacement.indexOf(Buffer.from('�')) + 3)]);
    for (const [label, body, signature, at] of [
      ['prepended UTF-8 BOM', bom, sign(raw), timestamp],
      ['invalid UTF-8 replacing signed replacement character', invalid, sign(replacement), timestamp],
      ['added whitespace', Buffer.concat([raw, Buffer.from(' ')]), sign(raw), timestamp],
      ['changed JSON body', Buffer.from(JSON.stringify({ ...payload, title: 'altered' })), sign(raw), timestamp],
      ['changed timestamp', raw, sign(raw), new Date(Date.parse(timestamp) + 1000).toISOString()],
      ['stale timestamp', raw, sign(raw, new Date(Date.now() - 360000).toISOString()), new Date(Date.now() - 360000).toISOString()],
    ]) {
      const persisted = await intakeInventory(sql);
      const response = await send(body, signature, at);
      assert.equal(response.status, 401, `${source.preset ?? source.timestampHeader}: ${label} must fail before recording anything`);
      await response.body?.cancel();
      assert.deepEqual(await intakeInventory(sql), persisted, `${label}: authentication refusal preserves complete persisted records`);
    }
    assert.deepEqual((await api('/api/app/intake/receipts?limit=250')).body, before.receipts, 'authentication failures create no receipt');
    assert.deepEqual((await api('/api/app/incidents')).body, before.incidents, 'authentication failures create no draft');
    assert.equal(await (await fetch(`${publicOrigin}/api/public/status`)).text(), before.page, 'authentication failures change no public snapshot');
    const normal = await send(raw);
    assert.equal(normal.status, 202);
    const accepted = await normal.json();
    for (const [label, body] of [['exact signed BOM', bom], ['exact signed whitespace', Buffer.concat([raw, Buffer.from(' \n')])]]) {
      const response = await send(body);
      assert.equal(response.status, 202, `${label} follows existing JSON decoding policy`);
      assert.equal((await response.json()).incidentId, accepted.incidentId);
    }
    const decoded = await send(invalid);
    assert.equal(decoded.status, 202, 'correctly signed invalid UTF-8 inside a JSON string retains replacement decoding policy');
    await decoded.body?.cancel();
    const malformed = await send(Buffer.from([0x80]));
    assert.equal(malformed.status, 400, 'correctly signed bytes still require parseable JSON');
    const rejected = await malformed.json();
    assert.ok((await api('/api/app/intake/receipts?limit=250')).body.receipts.some(row => row.id === rejected.receiptId && row.state === 'invalid'));
  }
}
