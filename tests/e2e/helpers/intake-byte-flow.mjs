import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

/** Public-route authentication must bind the bytes, before any JSON decoding. */
export async function intakeByteFlow({ api, post, publicOrigin, source, payload, secret }) {
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
      const response = await send(body, signature, at);
      assert.equal(response.status, 401, `${source.preset ?? source.timestampHeader}: ${label} must fail before recording anything`);
      await response.body?.cancel();
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
