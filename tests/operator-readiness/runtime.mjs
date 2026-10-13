import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { unstable_splitSqlQuery } from 'wrangler';
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const { build } = wranglerRequire('esbuild');
export async function load(path) {
  const { outputFiles } = await build({
    entryPoints: [path], bundle: true, format: 'esm', platform: 'node', write: false,
    define: { 'import.meta.env': JSON.stringify({ DEV: true }) },
    // Preserve the real renderer assets imported through Vite's ?inline form.
    // esbuild retains the query suffix while selecting the file's loader.
    loader: { '.png': 'dataurl', '.woff2': 'dataurl' },
    plugins: [{ name: 'raw-text', setup(build) {
      build.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw-text' }));
      build.onLoad({ filter: /.*/, namespace: 'raw-text' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`, loader: 'js' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}
export async function database(directory) {
  const runtime = new Miniflare(convertV4MiniflareOptions({ name: 'lamp-readiness', modules: true, port: 0, inspectorPort: 0, script: 'export default { fetch() { return new Response("test storage"); } }', compatibilityDate: '2026-09-08', d1Databases: ['DB', 'BASE_MAIL'], r2Buckets: ['OUTBOX'], resourcePersistencePath: join(directory, 'storage') }));
  const db = await runtime.getD1Database('DB');
  const execute = async sql => (await db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)))).flatMap(result => result.results ?? []);
  for (const name of (await readdir('migrations/core')).sort()) await execute(await readFile(join('migrations/core', name), 'utf8'));
  return { runtime, db, execute, baseMail: await runtime.getD1Database('BASE_MAIL'), bucket: await runtime.getR2Bucket('OUTBOX') };
}
