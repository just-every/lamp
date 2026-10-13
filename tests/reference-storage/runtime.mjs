import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { unstable_splitSqlQuery } from 'wrangler';

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const { build } = wranglerRequire('esbuild');

export function openRuntime(directory) {
  return new Miniflare(convertV4MiniflareOptions({
    name: 'lamp-u0', modules: true, port: 0, inspectorPort: 0,
    script: 'export default { fetch() { return new Response("test database"); } }',
    compatibilityDate: '2026-09-08', d1Databases: ['DB'],
    resourcePersistencePath: join(directory, 'storage'),
  }));
}
export async function executeSql(db, sql) {
  return db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));
}
export async function migrate(db, predicate = () => true) {
  for (const name of (await readdir('migrations/core')).filter(predicate).sort()) {
    await executeSql(db, await readFile(join('migrations/core', name), 'utf8'));
  }
}
export async function loadTypescript(path) {
  const { outputFiles } = await build({entryPoints: [path], bundle: true, format: 'esm', platform: 'node', write: false});
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}
export async function databaseSnapshot(db) {
  const { results: tables } = await db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all();
  const content = {};
  for (const { name } of tables) {
    content[name] = (await db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()).results;
  }
  return content;
}
