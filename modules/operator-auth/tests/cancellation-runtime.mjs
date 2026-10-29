import { installD1Preflight } from '../../container/adapters/d1-workerd-setup.mjs';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySql } from './apply-sql.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const packages = await readdir(join(root, 'node_modules/.pnpm'));
const wrangler = packages.find((name) => name.startsWith('wrangler@4.129.1_'));
if (!wrangler) throw new Error('Install the frozen workspace dependencies before running auth workerd tests.');
const require = createRequire(join(root, 'node_modules/.pnpm', wrangler, 'node_modules/wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions, D1_PLUGIN } = require('miniflare');
installD1Preflight(D1_PLUGIN);
const { build } = require('esbuild');
const output = await build({ entryPoints: [fileURLToPath(new URL('./cancellation-worker.mjs', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const schema = await readFile(new URL('../accounts/schema/operator-auth.sql', import.meta.url), 'utf8');
export const SETUP = 'regression-only-setup-token-at-least-32-characters';
export const cookie = (response) => response.headers.get('set-cookie')?.split(';')[0];
export const post = (input, sessionCookie, headers) => ({ method: 'POST', input, cookie: sessionCookie, headers });

export async function runtime({ existingStore = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'operator-auth-cancellation-'));
  const config = { origin: 'https://auth.test', OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: 'test-regression-session-secret-at-least-32-characters', SETUP_TOKEN: SETUP,
    MAIL_FROM: 'auth@example.com', ipLimit: 1000, emailLimit: 1000 };
  const options = {};
  const init = () => new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: output.outputFiles[0].text,
    compatibilityDate: '2026-09-01', d1Databases: { DB: 'auth-db' },
    bindings: { TEST_CONFIG: JSON.stringify(config), TEST_OPTIONS: JSON.stringify(options) },
  }), resourcePersistencePath: join(directory, 'state') });
  let mf = init();
  try {
    const db = await mf.getD1Database('DB');
    const installedSchema = existingStore ? await readFile(new URL('../../../default-seed/migrations/core/0002_operator_auth.sql', import.meta.url), 'utf8') : schema;
    await applySql(db, installedSchema);
    // The fixture withholds the cancellation ledger while installing the other current prerequisites.
    if (existingStore) for (const name of ['domain-rules-step-up.sql', 'provider-control.sql', 'provider-pins.sql']) {
      await applySql(db, await readFile(new URL('../accounts/schema/' + name, import.meta.url), 'utf8'));
    }
    await db.exec('CREATE TABLE test_mail(id INTEGER PRIMARY KEY AUTOINCREMENT,message TEXT NOT NULL);\nCREATE TABLE test_barriers(id TEXT PRIMARY KEY,released INTEGER NOT NULL);');
    const call = (path, { method = 'GET', input, body, cookie: c, headers = {} } = {}) => {
      const url = new URL(path, config.origin);
      const h = { Host: url.host, Origin: config.origin, ...headers };
      if (c) h.Cookie = c;
      if (input !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(input); }
      return mf.dispatchFetch('http://localhost/__test_dispatch', { method: 'POST', redirect: 'manual',
        body: JSON.stringify({ url: url.href, method, headers: h, ...(body === undefined ? {} : { body }) }) });
    };
    return { config, options, call, get db() { return mf.getD1Database('DB'); },
      async bootstrap() {
        const response = await call('/auth/bootstrap', post({ token: SETUP, displayName: 'Owner' }));
        if (response.status !== 303) throw new Error(`Bootstrap status ${response.status}`);
        return cookie(response);
      },
      async link() {
        const row = await (await mf.getD1Database('DB')).prepare('SELECT message FROM test_mail ORDER BY id DESC LIMIT 1').first();
        return new URL(JSON.parse(row.message).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
      },
      async restart() { await mf.dispose(); mf = init(); await mf.ready; },
      async close() { await mf.dispose(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) { await mf.dispose(); await rm(directory, { recursive: true, force: true }); throw error; }
}
