import { themeHeaderImage } from "./helpers/theme-fixture.mjs";
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { openStatusJourney, eventually } from './helpers/status-journey.mjs';
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const { build } = wranglerRequire('esbuild');

test('THEME-001 PAGE-005 PAGE-006 PAGE-007 PAGE-018 — a published status survives storage, database and queue failures, cold restart and an independent heartbeat silence alarm', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lamp-resilience-'));
  let runtime, j, monitor, alarmTimer;
  let receipt = null, alarm = false, pings = 0;
  try {
    monitor = createServer((request, response) => {
      assert.equal(request.method, 'GET'); assert.equal(request.url, '/ping');
      receipt = Date.now(); pings++; alarm = false; clearTimeout(alarmTimer);
      alarmTimer = setTimeout(() => { alarm = true; }, 750);
      response.end('ok');
    });
    await new Promise(resolve => monitor.listen(0, '127.0.0.1', resolve));
    const edge = async request => {
      if (request.url === 'https://heartbeat.example.test/ping') {
        assert.equal(request.method, 'GET'); assert.equal(await request.text(), '', 'the monitor receives no product data');
        return fetch(`http://127.0.0.1:${monitor.address().port}/ping`);
      }
    };
    j = await openStatusJourney({ providerEdge: edge }); await j.tick(Date.now());
    assert.equal(pings, 0, 'an unconfigured installation sends no heartbeat');
    await j.close(); j = await openStatusJourney({ providerEdge: edge, extraBindings: { LAMP_HEARTBEAT_URL: 'https://heartbeat.example.test/ping', LAMP_HEARTBEAT_INTERVAL_MINUTES: '1' } });
    const component = await j.component('Customer API during dependency outage');
    const incident = await j.incident('Known API degradation', [component]);
    await j.save(incident.id); await j.publish(incident.id); await j.visible('/', incident.title);
    await j.tick(Date.now()); assert.ok(pings > 0 && receipt);
    await j.raw('/test/effects', { method: 'PUT', body: JSON.stringify({ paused: true }) });
    const beforePause = pings; await j.tick(Date.now()); assert.equal(pings, beforePause, 'a transferring host stops external effects');
    await j.raw('/test/effects', { method: 'PUT', body: JSON.stringify({ paused: false }) });
    const expected = new Map();
    for (const path of ['/', '/feed.atom', '/widget.js', '/badge.json']) expected.set(path, await j.publicText(path));
    await j.raw('/test/queue', { method: 'PUT', body: JSON.stringify({ outage: true }) });
    const beforeOutage = pings;
    await (await j.runtime.getWorker()).scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
    assert.equal(pings, beforeOutage, 'a running Cron cannot certify a failed Queue dependency');
    assert.equal((await j.request('/health')).status, 503);
    for (const [path, body] of expected) assert.equal(await j.publicText(path), body, `${path} retains its published state`);
    await eventually(() => alarm, Boolean, 'the separate monitor reports missed receipts');
    await j.raw('/test/queue', { method: 'PUT', body: JSON.stringify({ outage: false }) });
    await j.tick(Date.now()); assert.ok(pings > beforeOutage); assert.equal((await j.request('/health')).status, 200);
    await j.close(); j = null;

    // Real public routes, R2 and durable replica. Its repository throws on every
    // read; only the provider edges are replaced to inject failure.
    const built = await build({ entryPoints: ['tests/e2e/snapshot-retained.worker.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers'], plugins: [{ name: 'vite-assets', setup(builder) {
      builder.onResolve({ filter: /\?(inline|raw)$/ }, args => ({ path: resolve(args.resolveDir, args.path.split('?')[0]), namespace: args.path.endsWith('?raw') ? 'raw' : 'inline' }));
      builder.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`, loader: 'js' }));
      builder.onLoad({ filter: /.*/, namespace: 'inline' }, async args => ({ contents: `export default ${JSON.stringify('data:application/octet-stream;base64,' + (await readFile(args.path)).toString('base64'))}`, loader: 'js' }));
    } }] });
    const options = { bindings: { LAMP_APP_HOST: 'app.example' }, name: 'lamp-retained-journey', resourcePersistencePath: join(directory, 'storage'), modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'], durableObjects: { SNAPSHOT_CACHE: { className: 'SnapshotCache', useSQLite: true } }, r2Buckets: ['SNAPSHOTS'] };
    runtime = new Miniflare(convertV4MiniflareOptions(options));
    const read = (path, init) => runtime.dispatchFetch(`https://page.example${path}`, init);
    const publishedAt = new Date().toISOString();
    const source = {
      settings: { pageName: 'Known service status', tagline: 'Current customer facts', accentColor: '#16794C', timezone: 'UTC', hostname: 'page.example', footerCreditEnabled: false, logoKey: null, logoContentType: null, widgetAllowedOrigins: '[]', feedId: 'synthetic-lamp-resilience' },
      components: [{ id: 'customer-api', name: 'Customer API', groupName: null, groupOrder: null, displayOrder: 0, note: '' }],
      claims: [{ componentId: 'customer-api', state: 'Major outage' }], history: [], corrections: [],
      incidents: [{ id: 'incident', reference: 'INC-1', title: 'Known API outage', lifecycle: 'Identified', openedAt: publishedAt, resolvedAt: null }],
      incidentComponents: [{ incidentId: 'incident', componentId: 'customer-api', componentName: 'Customer API', state: 'Major outage', relationship: 'Primary', publishedAt }],
      updates: [{ id: 'outage-update', incidentId: 'incident', lifecycle: 'Identified', affectedAudience: 'API customers', customerImpact: 'Major outage affects customer requests.', whatStillWorks: 'Status information remains available.', details: 'The operator is restoring service.', nextUpdateAt: new Date(Date.parse(publishedAt) + 3600000).toISOString(), publishedAt }],
      maintenance: [], maintenanceComponents: [], reports: [], maintenanceNotices: [],
    };
    const image = themeHeaderImage();
    const font = await readFile('src/core/features/public-snapshot/fonts/inter-latin.woff2');
    const themeAssets = { header: { key: 'branding/theme-image', contentType: 'image/png' }, font: { key: 'branding/theme-font', contentType: 'font/woff2' } };
    const bucket = await runtime.getR2Bucket('SNAPSHOTS');
    await bucket.put(themeAssets.header.key, image);
    await bucket.put(themeAssets.font.key, font);
    source.settings.themeAssets = JSON.stringify(themeAssets);
    source.settings.theme = JSON.stringify({ headerImage: true, font: 'uploaded' });
    const rebuild = async input => (await read('/test/rebuild', { method: 'POST', body: JSON.stringify({ source, ...input }) })).json();
    assert.equal((await read('/?storage=down')).status, 503, 'a fresh installation never invents an all-clear');
    const generation = await rebuild({ generation: 1 }); assert.equal(generation.failure, null);
    const paths = ['/', '/feed.atom', '/widget.js', '/api/public/status', '/badge.svg', '/badge.json'];
    for (const path of paths) { const response = await read(path); assert.equal(response.status, 200); await response.arrayBuffer(); }
    const failed = await rebuild({ generation: 2, replicaFailure: 'always' });
    assert.ok(failed.failure); assert.equal(failed.completed, false);
    for (const path of paths) {
      const response = await read(path + '?storage=down'); assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('x-lamp-snapshot-state'), 'stale');
      assert.ok(response.headers.get('x-lamp-snapshot-generated-at'));
      const text = await response.text();
      assert.ok(text.includes('Major outage') || text.includes('major-outage'), `${path} keeps the known outage`);
      // Badge protocols retain their consumer schema; every surface carries
      // the stale/generated-at HTTP headers checked above. Human and status
      // representations also expose staleness in their body.
      if (!path.startsWith('/badge.')) assert.ok(text.includes('Last known state') || text.includes('"snapshotState":"stale"'), path);
    }
    await runtime.dispose(); runtime = new Miniflare(convertV4MiniflareOptions(options));
    for (const path of paths) assert.equal((await read(path + '?storage=down&cold=1')).status, 200, `cold retained read ${path}`);
    for (const [kind, bytes, type] of [['header', image, 'image/png'], ['font', font, 'font/woff2']]) {
      const response = await read(`/assets/theme-${kind}?storage=down&cold=1`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), type);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes, 'the cold retained snapshot preserves uploaded theme bytes');
    }
    assert.equal((await read('/health?storage=down')).status, 503);
    const restored = await rebuild({ generation: 3 }); assert.equal(restored.failure, null); assert.equal(restored.completed, true);
    for (const path of paths) { const response = await read(path); assert.equal(response.status, 200); assert.equal(response.headers.get('x-lamp-snapshot-state'), null); }
  } finally {
    await j?.close(); await runtime?.dispose(); clearTimeout(alarmTimer);
    monitor?.closeAllConnections(); if (monitor) await new Promise(resolve => monitor.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
