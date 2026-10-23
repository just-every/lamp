import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';

export const providerFiles = async source => Promise.all((await readdir('tests/fixtures/' + source + '/small')).map(async name => ({ name, text: await readFile('tests/fixtures/' + source + '/small/' + name, 'utf8') })));
export const providerOptions = source => ({ source, pageId: 'synthetic-lamp-1', publicAccessAcknowledged: true });
const edit = (files, name, change) => files.map(file => file.name === name ? { ...file, text: JSON.stringify(change(JSON.parse(file.text))) } : file);

/** One source matrix inside the existing saved-reader behavior registration. */
export async function proveProviderReaders(adapters, mapSource) {
  for (const source of ['statusio']) {
    const files = await providerFiles(source), options = providerOptions(source);
    const read = await adapters[source].read(files, options);
    assert.equal(read.namespace, source);
    assert.equal(read.data.components.length, 1);
    assert.equal(read.data.groups.length, 1);
    assert.equal(read.data.incidents.length, 1);
    assert.deepEqual(read.data.incidents[0].incident_updates.map(row => Date.parse(row.created_at)), [Date.parse('2024-01-01T12:00:00Z'), Date.parse('2024-01-01T12:30:00Z')]);
    assert.equal(read.data.maintenance.length, 1);
    assert.equal(read.data.maintenance[0].scheduled_until, '2024-01-01T13:00:00Z');
    assert.deepEqual(read.data.subscribers, []);
    assert.deepEqual(read.publicAddresses, {}, 'undocumented old public paths are never invented');
    const mapped = mapSource(read.data, { maxGroupOrder: -1, maxComponentOrder: -1, lastReference: { INC: 0, SCH: 0 }, allocated: new Set(), references: new Map(), orders: new Map(), destinations: new Map() }, 'operator', '2026-10-23T12:00:00Z', source);
    assert.ok(mapped.find(row => row.kind === 'incident')?.value);
    assert.ok(mapped.find(row => row.kind === 'maintenance')?.value);
    await assert.rejects(adapters[source].read(files, { ...options, publicAccessAcknowledged: false }), /Confirm/);
    await assert.rejects(adapters[source].read(edit(files, 'statusio-components.json', value => ({ ...value, private: true })), options), /private/);
    await assert.rejects(adapters[source].read(edit(files, 'statusio-acl.json', value => ({ ...value, result: { ipv4: '192.0.2.0/24', ipv6: '' } })), options), /IP-restricted/);
    await assert.rejects(adapters[source].read(edit(files, 'statusio-incidents.json', value => ({ ...value, result: { ...value.result, resolved_incidents: Array.from({ length: 100 }, (_, i) => ({ ...value.result.resolved_incidents[0], _id: 'synthetic-lamp-' + (100 + i) })) } })), options), /truncated/);
    await assert.rejects(adapters[source].read(files.filter(file => !file.name.startsWith('statusio-maintenance-')), options), /unchanged documented/);
    await assert.rejects(adapters[source].read([...files, files[0]], options), /Duplicate/);
    await assert.rejects(adapters[source].read([{ name: files[0].name, text: ' '.repeat(8 * 1024 * 1024 + 1) }], options), /limit/);
  }
}

/** Only the provider edge is replaced: a real local HTTP receiver supplies the
 * unchanged responses and records headers. It never talks to a provider. */
export async function proveProviderFetches(adapters) {
  for (const source of ['statusio']) {
    const files = await providerFiles(source), calls = [];
    const apiId = randomBytes(20).toString('hex'), apiKey = randomBytes(24).toString('hex');
    let mode = 'success';
    const server = createServer((request, response) => {
      calls.push({ url: request.url, headers: request.headers, method: request.method });
      if (mode === 'redirect') { response.writeHead(302, { Location: 'https://example.invalid/never' }); response.end(); return; }
      if (mode === 'reflection') { response.end(JSON.stringify({ note: apiKey })); return; }
      const path = new URL(request.url, 'http://localhost').pathname;
      const name = path.includes('/admin/') ? 'statusio-acl.json' : path.includes('/component/') ? 'statusio-components.json' : path.includes('/status/') ? 'statusio-summary.json' : path.includes('/incident/') ? 'statusio-incidents.json' : path.includes('/maintenance/') ? 'statusio-maintenance-' + path.split('/').at(-1) + '.json' : 'statusio-maintenances.json';
      response.setHeader('Content-Type', 'application/json');
      response.end(files.find(file => file.name === name)?.text ?? '{}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const local = 'http://127.0.0.1:' + server.address().port;
    const fetcher = (url, init) => {
      assert.equal(url.origin, 'https://api.status.io');
      assert.equal(init.redirect, 'manual');
      assert.equal(init.method, 'GET');
      assert.equal(String(url).includes(apiKey), false);
      return fetch(local + url.pathname + url.search, init);
    };
    try {
      const fetched = await adapters[source].fetch({ ...providerOptions(source), apiId, apiKey, fetcher });
      assert.equal((await adapters[source].read(fetched, providerOptions(source))).data.incidents.length, 1);
      for (const call of calls) { assert.equal(call.method, 'GET'); assert.equal(call.headers['x-api-id'], apiId); assert.equal(call.headers['x-api-key'], apiKey); }
      const before = calls.length; mode = 'redirect';
      await assert.rejects(adapters[source].fetch({ ...providerOptions(source), apiId, apiKey, fetcher }), /redirect/);
      assert.equal(calls.length, before + 1);
      mode = 'reflection';
      await assert.rejects(adapters[source].fetch({ ...providerOptions(source), apiId, apiKey, fetcher }), error => /credential/.test(error.message) && !error.message.includes(apiKey));
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
