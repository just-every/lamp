import { installD1Preflight } from '../../container/adapters/d1-workerd-setup.mjs';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimConfig } from './keys.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const packages = await readdir(join(root, 'node_modules/.pnpm'));
const wrangler = packages.find(name => name.startsWith('wrangler@4.129.1_'));
if (!wrangler) throw new Error('Install frozen dependencies before owner-claim runtime tests.');
const require = createRequire(join(root, 'node_modules/.pnpm', wrangler, 'node_modules/wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions, D1_PLUGIN } = require('miniflare');
installD1Preflight(D1_PLUGIN);
const { build } = require('esbuild');
const output = await build({ entryPoints: [fileURLToPath(new URL('./worker.mjs', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const schemas = await Promise.all(['../../operator-auth/accounts/schema/operator-auth.sql', '../schema/owner-claim.sql'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
export const setupToken = 'test-only-hidden-setup-token-32-characters';
export async function runtime(publicKey, overrides = {}, claimOverrides = {}, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'owner-claim-'));
  const config = { ...claimConfig(publicKey), ...claimOverrides, authConfig: { origin: 'https://app.test', OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: 'test-only-session-secret-32-characters', SETUP_TOKEN: setupToken, ...overrides } };
  const initialize = () => new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-09-01', d1Databases: { DB: 'claim-db' }, bindings: { TEST_CONFIG: JSON.stringify(config), TEST_OPTIONS: JSON.stringify(options) } }), resourcePersistencePath: join(directory, 'state') });
  let mf = initialize();
  try {
    let db = await mf.getD1Database('DB');
    for (const schema of schemas) {
      const statements = schema.replace(/^--.*$/gm, '').match(/CREATE TRIGGER[\s\S]*?END;|CREATE (?:TABLE|INDEX)[\s\S]*?;/g);
      for (const statement of statements) await db.prepare(statement).run();
    }
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'oa_%' OR name LIKE 'oc_%') ORDER BY name").all()).results.map(row => row.name);
    await db.prepare('CREATE TABLE test_writes (table_name TEXT, action TEXT)').run();
    for (const table of tables) for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
      await db.prepare(`CREATE TRIGGER test_audit_${table}_${action} AFTER ${action} ON ${table} BEGIN INSERT INTO test_writes VALUES('${table}','${action}'); END`).run();
    }
    return {
      get db() { return db; },
      async call(path = '/auth/owner-claim', { method = 'GET', input, origin = config.appOrigin, urlOrigin = config.appOrigin, host = new URL(urlOrigin).host, headers = {}, body, cookie, ip = '192.0.2.1' } = {}) {
        const h = { Host: host, Origin: origin, 'X-Test-IP': ip, ...headers };
        if (input !== undefined) h['Content-Type'] = 'application/json';
        if (cookie) h.Cookie = cookie;
        return mf.dispatchFetch('http://localhost/__test_dispatch', { method: 'POST', redirect: 'manual', body: JSON.stringify({ url: new URL(path, urlOrigin).href, method, headers: h, ...(input !== undefined ? { body: JSON.stringify(input) } : body !== undefined ? { body } : {}) }) });
      },
      async snapshot() {
        const result = {};
        for (const table of [...tables, 'test_writes']) result[table] = (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
        return result;
      },
      async restart() { await mf.dispose(); mf = initialize(); await mf.ready; db = await mf.getD1Database('DB'); },
      async close() { await mf.dispose(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) { await mf.dispose(); await rm(directory, { recursive: true, force: true }); throw error; }
}
