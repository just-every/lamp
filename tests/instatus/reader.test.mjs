import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('wrangler'))('esbuild');
let scratch, reader, fetchSource;
const files = async (family) => Promise.all((await readdir(`tests/fixtures/instatus/${family}`)).map(async name => ({ name, text: await readFile(`tests/fixtures/instatus/${family}/${name}`, 'utf8') })));
const options = { pageId: 'synthpage01', publicAccessAcknowledged: true };
const edit = (source, name, mutate) => source.map(file => file.name === name ? { ...file, text: JSON.stringify(mutate(JSON.parse(file.text))) } : file);
const editMaintenance = (source, name, mutate) => edit(source, name, value => Array.isArray(value) ? value.map(mutate) : mutate(value));
const maintenanceFiles = ['instatus-maintenances.json', 'instatus-maintenance-maintenance-1.json'];
before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lamp-instatus-'));
  for (const entry of ['normalize', 'api']) await build({ entryPoints: [`src/core/features/statuspage-import/instatus/${entry}.ts`], outfile: join(scratch, `${entry}.mjs`), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  reader = (await import(pathToFileURL(join(scratch, 'normalize.mjs')))).readInstatusResponses;
  fetchSource = (await import(pathToFileURL(join(scratch, 'api.mjs')))).fetchInstatusResponses;
});
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });

test("Saved Instatus import preserves history and refuses unsafe or ambiguous source authority", async t => {
  t.diagnostic("saved Instatus collections preserve full history, visual groups and explicit email consent");
  await (async () => {
  for (const family of ['small', 'large']) {
    const source = await files(family), read = await reader(source, options);
    const raw = name => JSON.parse(source.find(file => file.name === `instatus-${name}.json`).text);
    const subscribers = source.filter(file => /^instatus-subscribers(?:-\d+)?\.json$/.test(file.name)).flatMap(file => JSON.parse(file.text));
    assert.equal(read.namespace, 'instatus');
    assert.equal(read.data.components.length, raw('components').length);
    assert.equal(read.data.groups.length, new Set(raw('components').flatMap(row => row.group ? [row.group.id] : [])).size);
    assert.equal(read.data.incidents.length, raw('incidents').length);
    assert.deepEqual(read.data.incidents.flatMap(row => row.incident_updates.map(update => update.display_at)), raw('incidents').flatMap(row => row.updates.map(update => update.started)));
    const eligible = subscribers.filter(row => row.email && row.confirmed && row.approved && !row.phone && !row.webhook && !row.slack);
    assert.equal(read.data.subscribers.length, eligible.length);
    assert.equal(read.accounting.filter(row => row.kind === 'subscriber' && row.outcome === 'skipped').length, subscribers.length - eligible.length);
    assert.deepEqual(read.data.subscribers.map(row => row.components), eligible.map(row => row.components));
    const detail = raw('maintenance-maintenance-1');
    assert.equal(read.data.maintenance[0].incident_updates.length, detail.updates.length);
    assert.equal(Date.parse(read.data.maintenance[0].scheduled_until) - Date.parse(detail.start), detail.duration * 60000);
    const link = raw('summary').recentlyResolvedIncidents[0];
    assert.deepEqual(read.publicAddresses[`incident:${link.id}`], [link.url]);
  }
})(t);
  t.diagnostic("unsafe source access, incomplete pages and wrong shapes produce one-line refusals");
  await (async () => {
  const source = await files('small');
  const bad = [
    [source, { pageId: options.pageId }],
    [edit(source, 'instatus-pages.json', rows => [{ ...rows[0], private: true }]), options],
    [edit(source, 'instatus-audience-groups.json', () => [{ id: 'audience', name: 'Restricted customers' }]), options],
    [edit(source, 'instatus-components.json', rows => [{ ...rows[0], groupId: 'missing', group: null }]), options],
    [edit(source, 'instatus-components.json', () => ({ data: [] })), options],
    [edit(source, 'instatus-components.json', rows => rows.map((row, index) => index ? row : { ...row, group: { ...row.group, private: true } })), options],
    [edit(source, 'instatus-components.json', rows => rows.map((row, index) => index ? row : { ...row, group: 'not-an-object' })), options],
    [edit(source, 'instatus-components.json', rows => [rows[0], { ...rows[1], group: { ...rows[0].group, createdAt: '2022-01-01T00:00:00Z' } }]), options],
    [edit(source, 'instatus-maintenance-maintenance-1.json', row => ({ ...row, updates: row.updates.map((update, index) => index ? update : { ...update, createdAt: '2023-05-30T00:00:00Z' }) })), options],
    [source.map(file => file.name === 'instatus-components.json' ? { ...file, text: '{' } : file), options],
    [source.filter(file => file.name !== 'instatus-maintenance-maintenance-1.json'), options],
    [(await files('large')).filter(file => file.name !== 'instatus-subscribers-3.json'), options],
    [[{ name: 'instatus-components.json', text: ' '.repeat(8 * 1024 * 1024 + 1) }], options],
  ];
  for (const name of maintenanceFiles) for (const page of [{ siteId: 'other-page' }, { site: { id: 'other-page' } }]) {
    bad.push([editMaintenance(source, name, row => ({ ...row, ...page })), options]);
    bad.push([editMaintenance(source, name, row => ({ ...row, updates: row.updates.map((update, index) => index ? update : { ...update, ...page }) })), options]);
  }
  for (const facts of [
    [{ private: true }, { private: false }],
    [{ shouldPublish: false }, { shouldPublish: true }],
    [{ audienceGroups: [{ id: 'restricted' }] }, { audienceGroups: [] }],
    [{ published: false }, { published: 'false' }],
  ]) for (const history of [false, true]) {
    let conflicting = source;
    for (const [index, name] of maintenanceFiles.entries()) conflicting = editMaintenance(conflicting, name, row => history ? { ...row, updates: row.updates.map((update, updateIndex) => updateIndex ? update : { ...update, ...facts[index] }) } : { ...row, ...facts[index] });
    bad.push([conflicting, options]);
  }
  for (const [input, opts] of bad) await assert.rejects(reader(input, opts), error => error.message.length > 10 && !error.message.includes('\n'));
})(t);
  t.diagnostic("publication, consent and unresolved preferences refuse without widening or retaining capabilities");
  await (async () => {
  let source = await files('small');
  source = edit(source, 'instatus-incidents.json', rows => rows.map((row, index) => index ? row : { ...row, shouldPublish: false }));
  source = edit(source, 'instatus-subscribers.json', rows => rows.map((row, index) => index ? row : { ...row, all: false, components: ['missing'], unsubscribeToken: 'capability-must-not-survive' }));
  source = edit(source, 'instatus-components.json', rows => rows.map(row => ({ ...row, uniqueEmail: 'capability@automation.instatus.invalid' })));
  const read = await reader(source, options);
  assert.equal(read.data.incidents.some(row => row.id === 'incident-1'), false);
  assert.equal(read.data.subscribers.length, 0);
  assert.ok(read.accounting.some(row => row.kind === 'incident' && row.outcome === 'rejected'));
  assert.ok(read.accounting.some(row => row.reason.includes('broaden')));
  assert.doesNotMatch(JSON.stringify(read.records), /capability|unsubscribeToken|uniqueEmail/);
  for (const channel of ['microsoftTeamsWebhook', 'googleChatWebhook', 'discord', 'webhookEmail']) {
    const channelSource = edit(await files('small'), 'instatus-subscribers.json', rows => rows.map((row, index) => index ? row : { ...row, [channel]: 'https://example.invalid/private-capability' }));
    const checked = await reader(channelSource, options);
    assert.equal(checked.data.subscribers.length, 0);
    assert.doesNotMatch(JSON.stringify(checked.records), /private-capability/);
  }
  const original = await files('small');
  for (const name of maintenanceFiles) for (const restriction of [
    { private: true }, { useAllowList: true }, { allowList: ['restricted@example.invalid'] },
    { secureLink: 'https://example.invalid/private-capability' }, { audienceGroups: [{ id: 'restricted' }] },
    { shouldPublish: false }, { published: false }, { isPublished: false }, { draft: true },
  ]) for (const history of [false, true]) {
    const input = editMaintenance(original, name, row => history ? { ...row, updates: row.updates.map((update, index) => index ? update : { ...update, ...restriction }) } : { ...row, ...restriction });
    const checked = await reader(input, options);
    assert.equal(checked.data.maintenance.length, 0, `${name}: ${history ? 'update' : 'record'} ${Object.keys(restriction)[0]}`);
    assert.ok(checked.accounting.some(row => row.kind === 'maintenance' && row.outcome === 'rejected'));
    assert.doesNotMatch(JSON.stringify(checked.records), /private-capability/);
  }
  let publicHistory = original;
  for (const name of maintenanceFiles) publicHistory = editMaintenance(publicHistory, name, row => ({ ...row, private: false, audienceGroups: [], updates: row.updates.map(update => ({ ...update, published: true, allowList: [], providerMetadata: { note: 'unknown fields retained' } })) }));
  const checked = await reader(publicHistory, options);
  assert.equal(checked.data.maintenance.length, 1);
  const retained = checked.records.find(row => row.kind === 'maintenance').payload;
  for (const response of [retained.list, retained.detail]) assert.deepEqual(response.updates[0].providerMetadata, { note: 'unknown fields retained' });
})(t);
});





test('API key path requests fixed-origin GETs with complete pagination and refuses redirects or reflection', async () => {
  const source = await files('large'), calls = [], key = 'synthetic-instatus-key-0001';
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    const path = url.pathname, page = Number(url.searchParams.get('page') ?? 1);
    const resource = path === '/v2/pages' ? 'pages' : path.split('/')[3];
    const detail = path.split('/')[4];
    const name = detail ? `instatus-maintenance-${detail}.json` : `instatus-${resource}${page === 1 ? '' : `-${page}`}.json`;
    return new Response(source.find(file => file.name === name)?.text ?? '[]', { status: 200 });
  };
  const fetched = await fetchSource({ ...options, apiKey: key, fetcher });
  const read = await reader(fetched, options);
  assert.equal(read.data.subscribers.length, (await reader(source, options)).data.subscribers.length);
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, 'https://api.instatus.com');
    assert.equal(call.init.method, 'GET'); assert.equal(call.init.redirect, 'manual');
    assert.equal(call.init.headers.Authorization, `Bearer ${key}`);
    assert.equal(call.url.includes(key), false);
  }
  let redirects = 0;
  await assert.rejects(fetchSource({ ...options, apiKey: key, fetcher: async () => { redirects++; return new Response(null, { status: 302, headers: { Location: 'https://example.invalid/steal' } }); } }), /redirect/i);
  assert.equal(redirects, 1);
  await assert.rejects(fetchSource({ ...options, apiKey: key, fetcher: async () => new Response(JSON.stringify([{ id: options.pageId, note: key }])) }), error => /credential/.test(error.message) && !error.message.includes(key));
  await assert.rejects(fetchSource({ ...options, apiKey: key, fetcher: async () => new Response(' '.repeat(8 * 1024 * 1024 + 1)) }), /limit/);
});
