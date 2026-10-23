import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';

export const providerFiles = async source => Promise.all((await readdir('tests/fixtures/' + source + '/small')).map(async name => ({ name, text: await readFile('tests/fixtures/' + source + '/small/' + name, 'utf8') })));
export const providerOptions = source => ({ source, pageId: 'synthetic-lamp-1', publicAccessAcknowledged: true });
const edit = (files, name, change) => files.map(file => file.name === name ? { ...file, text: JSON.stringify(change(JSON.parse(file.text))) } : file);

/** One source matrix inside the existing saved-reader behavior registration. */
export async function proveProviderReaders(adapters, mapSource) {
  for (const source of ['statusio', 'incidentio']) {
    const files = await providerFiles(source), options = providerOptions(source);
    const read = await adapters[source].read(files, options);
    assert.equal(read.namespace, source);
    assert.equal(read.data.components.length, 1);
    assert.equal(read.data.groups.length, 1);
    assert.equal(read.data.incidents.length, 1);
    assert.deepEqual(read.data.incidents[0].incident_updates.map(row => Date.parse(row.created_at)), [Date.parse('2024-01-01T12:00:00Z'), Date.parse('2024-01-01T12:30:00Z')]);
    assert.equal(read.data.maintenance.length, source === 'statusio' ? 1 : 0);
    if (source === 'statusio') assert.equal(read.data.maintenance[0].scheduled_until, '2024-01-01T13:00:00Z');
    else assert.ok(read.accounting.some(row => row.kind === 'maintenance' && row.outcome === 'rejected' && row.reason.includes('planned maintenance window')));
    assert.deepEqual(read.data.subscribers, []);
    assert.deepEqual(read.publicAddresses, {}, 'undocumented old public paths are never invented');
    const mapped = mapSource(read.data, { maxGroupOrder: -1, maxComponentOrder: -1, lastReference: { INC: 0, SCH: 0 }, allocated: new Set(), references: new Map(), orders: new Map(), destinations: new Map() }, 'operator', '2026-10-23T12:00:00Z', source);
    assert.ok(mapped.find(row => row.kind === 'incident')?.value);
    if (source === 'statusio') assert.ok(mapped.find(row => row.kind === 'maintenance')?.value);
    await assert.rejects(adapters[source].read(files, { ...options, publicAccessAcknowledged: false }), /Confirm/);
    if (source === 'statusio') {
    await assert.rejects(adapters[source].read(edit(files, 'statusio-components.json', value => ({ ...value, private: true })), options), /private/);
    await assert.rejects(adapters[source].read(edit(files, 'statusio-acl.json', value => ({ ...value, result: { ipv4: '192.0.2.0/24', ipv6: '' } })), options), /IP-restricted/);
    await assert.rejects(adapters[source].read(edit(files, 'statusio-incidents.json', value => ({ ...value, result: { ...value.result, resolved_incidents: Array.from({ length: 100 }, (_, i) => ({ ...value.result.resolved_incidents[0], _id: 'synthetic-lamp-' + (100 + i) })) } })), options), /truncated/);
    await assert.rejects(adapters[source].read(files.filter(file => !file.name.startsWith('statusio-maintenance-')), options), /unchanged documented/);
    } else {
      await assert.rejects(adapters[source].read(edit(files, 'incidentio-page.json', value => ({ ...value, private: true })), options), /private/);
      await assert.rejects(adapters[source].read(edit(files, 'incidentio-structure.json', value => { value.current_structure.items[0].group.hidden = true; return value; }), options), /hidden/);
      await assert.rejects(adapters[source].read(files.filter(file => file.name !== 'incidentio-incidents-2.json'), options), /unchanged documented/);
      await assert.rejects(adapters[source].read(edit(files, 'incidentio-incidents-2.json', value => ({ ...value, pagination_meta: { page_size: 100, after: 'synthetic-lamp-20' } })), options), /cursor/);
      await assert.rejects(adapters[source].read(edit(files, 'incidentio-maintenances.json', value => { value.status_page_maintenances[0].maintenance_status = 'maintenance_in_progress'; return value; }), options), /in progress/);
      const internal = edit(files, 'incidentio-components.json', value => ({ ...value, status_page_components: [...value.status_page_components, { id: 'synthetic-lamp-99', name: 'Other page component' }] }));
      assert.equal((await adapters[source].read(internal, options)).data.components.length, 1);
    }
    await assert.rejects(adapters[source].read([...files, files[0]], options), /Duplicate/);
    await assert.rejects(adapters[source].read([{ name: files[0].name, text: ' '.repeat(8 * 1024 * 1024 + 1) }], options), /limit/);
  }
}

/** Only the provider edge is replaced: a real local HTTP receiver supplies the
 * unchanged responses and records headers. It never talks to a provider. */
export async function proveProviderFetches(adapters, findPages) {
  for (const source of ['statusio', 'incidentio']) {
    const files = await providerFiles(source), calls = [];
    const apiId = randomBytes(20).toString('hex'), apiKey = randomBytes(24).toString('hex');
    let mode = 'success';
    const server = createServer((request, response) => {
      calls.push({ url: request.url, headers: request.headers, method: request.method });
      if (mode === 'redirect') { response.writeHead(302, { Location: 'https://example.invalid/never' }); response.end(); return; }
      if (mode === 'reflection') { response.end(JSON.stringify({ note: apiKey })); return; }
      const url = new URL(request.url, 'http://localhost'), path = url.pathname;
      if (source === 'incidentio' && path === '/v2/status_pages') {
        const page = JSON.parse(files.find(file => file.name === 'incidentio-page.json').text).status_page;
        response.end(JSON.stringify({ status_pages: url.searchParams.has('after') ? [] : [page], pagination_meta: { page_size: 100, ...(url.searchParams.has('after') ? {} : { after: 'synthetic-lamp-21' }) } })); return;
      }
      const name = source === 'incidentio' ? (path.includes('/status_pages/') ? 'incidentio-page.json' : path.includes('/status_page_structures/') ? 'incidentio-structure.json' : path === '/v2/status_page_components' ? 'incidentio-components.json' : path === '/v2/status_page_incidents' ? 'incidentio-incidents' + (url.searchParams.has('after') ? '-2' : '') + '.json' : 'incidentio-maintenances.json') : path.includes('/admin/') ? 'statusio-acl.json' : path.includes('/component/') ? 'statusio-components.json' : path.includes('/status/') ? 'statusio-summary.json' : path.includes('/incident/') ? 'statusio-incidents.json' : path.includes('/maintenance/') ? 'statusio-maintenance-' + path.split('/').at(-1) + '.json' : 'statusio-maintenances.json';
      response.setHeader('Content-Type', 'application/json');
      response.end(files.find(file => file.name === name)?.text ?? '{}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const local = 'http://127.0.0.1:' + server.address().port;
    const fetcher = (url, init) => {
      assert.equal(url.origin, source === 'statusio' ? 'https://api.status.io' : 'https://api.incident.io');
      assert.equal(init.redirect, 'manual');
      assert.equal(init.method, 'GET');
      assert.equal(String(url).includes(apiKey), false);
      return fetch(local + url.pathname + url.search, init);
    };
    try {
      const fetched = await adapters[source].fetch({ ...providerOptions(source), apiId, apiKey, fetcher });
      assert.equal((await adapters[source].read(fetched, providerOptions(source))).data.incidents.length, 1);
      if (source === 'incidentio') assert.deepEqual(await findPages({ source, apiKey, fetcher }), [{ id: 'synthetic-lamp-1', name: 'Synthetic page', address: 'https://status.example.invalid' }]);
      for (const call of calls) { assert.equal(call.method, 'GET'); if (source === 'statusio') { assert.equal(call.headers['x-api-id'], apiId); assert.equal(call.headers['x-api-key'], apiKey); } else assert.equal(call.headers.authorization, 'Bearer ' + apiKey); }
      const before = calls.length; mode = 'redirect';
      await assert.rejects(adapters[source].fetch({ ...providerOptions(source), apiId, apiKey, fetcher }), /redirect/);
      assert.equal(calls.length, before + 1);
      mode = 'reflection';
      await assert.rejects(adapters[source].fetch({ ...providerOptions(source), apiId, apiKey, fetcher }), error => /credential/.test(error.message) && !error.message.includes(apiKey));
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
