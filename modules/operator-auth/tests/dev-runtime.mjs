import { installD1Preflight } from '../../container/adapters/d1-workerd-setup.mjs';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySql } from './apply-sql.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packages = await readdir(join(root, 'node_modules/.pnpm'));
const wrangler = packages.find(name => name.startsWith('wrangler@4.129.1_'));
if (!wrangler) throw new Error('Install the frozen workspace dependencies before running auth workerd tests.');
const require = createRequire(join(root, 'node_modules/.pnpm', wrangler, 'node_modules/wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions, D1_PLUGIN } = require('miniflare');
installD1Preflight(D1_PLUGIN);
const { build } = require('esbuild');

// Public, test-only values. A loopback origin with local mode and review
// enabled lets every session kind be admitted the way production admits it.
export const ORIGIN = 'http://127.0.0.1:8787';
export const SECRET = ['dev', 'sessions', 'fixture', 'only', 'session', 'secret', 'never', 'use'].join('-');
export const DEV_KEY = ['dev', 'sessions', 'fixture', 'only', 'key', 'never', 'use', 'in', 'any', 'checkout', '0000'].join('-');
export const OWNER = 'owner@example.com';
export const sessionHash = token => createHmac('sha256', SECRET).update(`session\0${token}`).digest('hex');
export const cookieFor = token => `operator_session_local_8787=${token}`;
export const read = path => readFile(new URL(path, import.meta.url), 'utf8');

export async function runtime(schemas, extraConfig = {}, worker = 'dev-worker.mjs') {
  const output = await build({ entryPoints: [fileURLToPath(new URL(`./${worker}`, import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const directory = await mkdtemp(join(tmpdir(), 'operator-auth-dev-'));
  const config = { origin: ORIGIN, local: true, OWNER_EMAIL: OWNER, SESSION_SECRET: SECRET, MAIL_FROM: 'auth@example.com',
    ipLimit: 1000, emailLimit: 1000, review: { enabled: true, operatorEmail: OWNER }, ...extraConfig };
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-09-01',
    d1Databases: { DB: 'auth-db' }, bindings: { TEST_CONFIG: JSON.stringify(config), RER_DEV_KEY: DEV_KEY, AUTH_ORIGIN: ORIGIN, AUTH_LOCAL: 'true' } }),
  resourcePersistencePath: join(directory, 'state') });
  try {
    const db = await mf.getD1Database('DB');
    for (const sql of schemas) await applySql(db, sql);
    await db.prepare('CREATE TABLE test_mail(id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL)').run();
    return {
      db,
      call(path, { method = 'GET', cookie, key, input, headers: extraHeaders = {} } = {}) {
        const url = new URL(path, ORIGIN), headers = { Host: url.host, Origin: ORIGIN, ...extraHeaders };
        if (cookie) headers.Cookie = cookie;
        if (key) headers['x-rer-dev-key'] = key;
        if (input !== undefined) headers['Content-Type'] = 'application/json';
        return mf.dispatchFetch('http://localhost/__test_dispatch', { method: 'POST', redirect: 'manual',
          body: JSON.stringify({ url: url.href, method, headers, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }) });
      },
      async latestLink() {
        const row = await db.prepare('SELECT message FROM test_mail ORDER BY id DESC LIMIT 1').first();
        return new URL(JSON.parse(row.message).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
      },
      async close() { await mf.dispose(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) { await mf.dispose(); await rm(directory, { recursive: true, force: true }); throw error; }
}
// The Set-Cookie pairs of a response, joined as a request Cookie header.
export const cookies = response => response.headers.getSetCookie().map(line => line.split(';')[0]).filter(pair => !pair.endsWith('=')).join('; ');
