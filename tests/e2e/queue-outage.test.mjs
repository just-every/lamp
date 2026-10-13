import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { getPlatformProxy } from 'wrangler';
import { contract } from '../contract.mjs';
import { legacyApiFixtureSql } from './fixtures/legacy-api-fixture.mjs';
import { openSnapshotCacheRuntime } from './snapshot-cache-runtime.mjs';
import { reservePort } from './worker-startup.mjs';

contract('PAGE-006', 'an injected Queue transport outage leaves all real R2 snapshots readable while health reports the Queue failure and recovery', async () => {
  const state = await mkdtemp(join(tmpdir(), 'lamp-queue-outage-'));
  const configPath = 'wrangler.jsonc';
  let platform, vite, snapshotCache;
  const previousCaches = globalThis.caches;
  try {
    for (const args of [['migrations', 'apply', 'DB'], ['execute', 'DB', '--command', legacyApiFixtureSql()]]) execFileSync('pnpm', ['exec', 'wrangler', 'd1', ...args, '--local', '--config', configPath, '--persist-to', state], { stdio: 'pipe' });
    platform = await getPlatformProxy({ configPath, remoteBindings: false, persist: { path: join(state, 'v3') } });
    globalThis.caches = platform.caches;
    vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: { port: await reservePort({ label: 'Queue outage Vite' }) } } });
    const { createApp } = await vite.ssrLoadModule('/src/core/app/server.ts');
    snapshotCache = await openSnapshotCacheRuntime(state);
    const bindings = { ...platform.env, SNAPSHOT_CACHE: snapshotCache.namespace };
    const healthy = createApp(bindings);
    await healthy.services.publicSnapshots.rebuild();
    const expected = new Map();
    for (const path of ['/', '/feed.atom', '/widget.js']) {
      const response = await healthy.app.request(`https://status.example.test${path}`);
      assert.equal(response.status, 200);
      expected.set(path, await response.text());
    }
    let attempts = 0;
    const failed = createApp({ ...bindings, JOBS: { async send() { attempts++; throw new Error('Test-injected Queue transport outage'); } } });
    const health = await failed.app.request('https://app.example.test/health');
    assert.equal(health.status, 503);
    assert.equal((await health.json()).dependency, 'queue');
    assert.equal(attempts, 1, 'the health path must actually exercise the failing queue boundary');
    for (const [path, body] of expected) {
      const response = await failed.app.request(`https://status.example.test${path}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), body, `${path} must retain its exact rendered R2 snapshot`);
      assert.ok(response.headers.get('x-lamp-snapshot-generated-at'));
    }
    assert.equal(attempts, 1, 'public reads must not depend on queue transport');
    assert.equal((await healthy.app.request('https://app.example.test/health')).status, 200);
  } finally {
    globalThis.caches = previousCaches;
    await vite?.close();
    await snapshotCache?.dispose();
    await platform?.dispose();
    await rm(state, { recursive: true, force: true });
  }
});
