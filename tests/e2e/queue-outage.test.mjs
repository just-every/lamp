import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unstable_splitSqlQuery } from 'wrangler';
import { contract } from '../contract.mjs';
import { legacyApiFixtureSql } from './fixtures/legacy-api-fixture.mjs';

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const { build } = wranglerRequire('esbuild');

contract('PAGE-006', 'an injected Queue transport outage leaves all real R2 snapshots readable while health reports the Queue failure and recovery', async () => {
  const state = await mkdtemp(join(tmpdir(), 'lamp-queue-outage-'));
  let runtime;
  try {
    // The same native runtime supplies HTMLRewriter, Cache API and all storage
    // bindings. A Node SSR module is not a Worker request execution context.
    const built = await build({
      entryPoints: ['tests/e2e/queue-outage.worker.ts'], bundle: true,
      format: 'esm', platform: 'browser', write: false,
      external: ['cloudflare:workers', 'node:*'],
      define: { 'import.meta.env.DEV': 'false' },
      plugins: [{ name: 'vite-assets', setup(builder) {
        builder.onResolve({ filter: /\?(inline|raw)$/ }, args => ({ path: resolve(args.resolveDir, args.path.split('?')[0]), namespace: args.path.endsWith('?raw') ? 'raw' : 'inline' }));
        builder.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`, loader: 'js' }));
        builder.onLoad({ filter: /.*/, namespace: 'inline' }, async args => ({ contents: `export default ${JSON.stringify('data:application/octet-stream;base64,' + (await readFile(args.path)).toString('base64'))}`, loader: 'js' }));
      } }],
    });
    runtime = new Miniflare(convertV4MiniflareOptions({
      name: 'lamp-queue-outage-test', modules: true, script: built.outputFiles[0].text,
      port: 0, inspectorPort: 0, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
      bindings: { LAMP_PAGE_HOST: 'status.example.test', LAMP_APP_HOST: 'app.example.test', MAIL_FROM_ADDRESS: 'lamp@localhost.invalid' },
      d1Databases: ['DB'], r2Buckets: ['SNAPSHOTS'],
      durableObjects: { SNAPSHOT_CACHE: { className: 'SnapshotCache', useSQLite: true } },
      queueProducers: { JOBS: 'lamp-queue-outage-jobs' },
      resourcePersistencePath: join(state, 'storage'),
      outboundService: async () => { throw new Error('Queue outage test must not call a provider'); },
    }));
    const db = await runtime.getD1Database('DB');
    const execute = sql => db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));
    for (const migration of (await readdir('migrations/core')).filter(name => name.endsWith('.sql')).sort()) await execute(await readFile(join('migrations/core', migration), 'utf8'));
    await execute(legacyApiFixtureSql());
    const control = (path, init) => runtime.dispatchFetch(`https://app.example.test/test/${path}`, init);
    const queueAttempts = async () => (await (await control('queue')).json()).attempts;
    assert.equal((await control('rebuild', { method: 'POST' })).status, 204);
    const expected = new Map();
    for (const path of ['/', '/feed.atom', '/widget.js']) {
      const response = await runtime.dispatchFetch(`https://status.example.test${path}`);
      assert.equal(response.status, 200);
      expected.set(path, await response.text());
    }
    assert.equal((await control('queue', { method: 'PUT', body: JSON.stringify({ outage: true }) })).status, 204);
    const health = await runtime.dispatchFetch('https://app.example.test/health');
    assert.equal(health.status, 503);
    assert.equal((await health.json()).dependency, 'queue');
    assert.equal(await queueAttempts(), 1, 'the health path must actually exercise the failing queue boundary');
    for (const [path, body] of expected) {
      const response = await runtime.dispatchFetch(`https://status.example.test${path}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), body, `${path} must retain its exact rendered R2 snapshot`);
      assert.ok(response.headers.get('x-lamp-snapshot-generated-at'));
    }
    assert.equal(await queueAttempts(), 1, 'public reads must not depend on queue transport');
    assert.equal((await control('queue', { method: 'PUT', body: JSON.stringify({ outage: false }) })).status, 204);
    assert.equal((await runtime.dispatchFetch('https://app.example.test/health')).status, 200);
  } finally {
    await runtime?.dispose();
    await rm(state, { recursive: true, force: true });
  }
});
