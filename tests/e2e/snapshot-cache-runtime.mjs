import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const { build } = wranglerRequire('esbuild');

/** Wrangler's binding-only proxy does not execute local DO classes. Host the
 * actual exported class in workerd while retaining the caller's real D1/R2. */
export async function openSnapshotCacheRuntime(state) {
  const built = await build({
    entryPoints: ['src/core/platform/blobs/snapshot-cache.ts'],
    bundle: true, format: 'esm', platform: 'browser', write: false,
    external: ['cloudflare:workers'],
  });
  const runtime = new Miniflare(convertV4MiniflareOptions({
    name: 'lamp-queue-outage-cache', modules: true,
    script: built.outputFiles[0].text, compatibilityDate: '2026-09-08',
    durableObjects: { SNAPSHOT_CACHE: { className: 'SnapshotCache', useSQLite: true } },
    resourcePersistencePath: join(state, 'snapshot-cache'),
  }));
  try {
    const namespace = await runtime.getDurableObjectNamespace('SNAPSHOT_CACHE');
    return { namespace, dispose: () => runtime.dispose() };
  } catch (cause) {
    await runtime.dispose();
    throw cause;
  }
}
