import { installD1Preflight } from '../../container/adapters/d1-workerd-setup.mjs';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET, SETUP } from './fixtures/pre-ledger/owner-state.mjs';
import { applySql } from './apply-sql.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packages = await readdir(join(root, 'node_modules/.pnpm'));
const wrangler = packages.find(name => name.startsWith('wrangler@4.129.1_'));
if (!wrangler) throw new Error('Install the frozen workspace dependencies before running auth workerd tests.');
const require = createRequire(join(root, 'node_modules/.pnpm', wrangler, 'node_modules/wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions, D1_PLUGIN } = require('miniflare');
installD1Preflight(D1_PLUGIN);
const { build } = require('esbuild');
const output = await build({ entryPoints: [fileURLToPath(new URL('./pre-ledger-worker.mjs', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
export const post = (input, cookie) => ({ method: 'POST', input, cookie });

export async function runtime() {
  const directory = await mkdtemp(join(tmpdir(), 'operator-auth-pre-ledger-'));
  const config = { origin: 'https://auth.test', OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: SECRET,
    SETUP_TOKEN: SETUP, MAIL_FROM: 'auth@example.com', ipLimit: 1000, emailLimit: 1000 };
  const init = () => new Miniflare({ ...convertV4MiniflareOptions({
    modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-09-01',
    d1Databases: { DB: 'auth-db' }, bindings: { TEST_CONFIG: JSON.stringify(config) },
  }), resourcePersistencePath: join(directory, 'state') });
  let mf = init();
  try {
    const db = await mf.getD1Database('DB');
    await applySql(db, await read('./fixtures/pre-ledger/schema.sql'));
    await applySql(db, await read('./fixtures/pre-ledger/rows.sql'));
    await db.prepare('CREATE TABLE test_mail(id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL)').run();
    return {
      get db() { return mf.getD1Database('DB'); },
      call(path, { method = 'GET', input, cookie } = {}) {
        const url = new URL(path, config.origin);
        const headers = { Host: url.host, Origin: config.origin };
        if (cookie) headers.Cookie = cookie;
        if (input !== undefined) headers['Content-Type'] = 'application/json';
        return mf.dispatchFetch('http://localhost/__test_dispatch', { method: 'POST', redirect: 'manual',
          body: JSON.stringify({ url: url.href, method, headers, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }) });
      },
      // Upgrading to this runtime also applies the later dev-sessions and
      // domain-rules/step-up migrations.
      async migrate() {
        const db = await mf.getD1Database('DB'), result = await applySql(db, await read('../accounts/schema/invitation-cancellation.sql'));
        await applySql(db, await read('../accounts/schema/dev-sessions.sql'));
        await applySql(db, await read('../accounts/schema/domain-rules-step-up.sql'));
        await applySql(db, await read('../accounts/schema/provider-control.sql'));
        await applySql(db, await read('../accounts/schema/provider-pins.sql'));
        return result;
      },
      async latestLink() {
        const row = await (await mf.getD1Database('DB')).prepare('SELECT message FROM test_mail ORDER BY id DESC LIMIT 1').first();
        return new URL(JSON.parse(row.message).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
      },
      async restart() { await mf.dispose(); mf = init(); await mf.ready; },
      async close() { await mf.dispose(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) { await mf.dispose(); await rm(directory, { recursive: true, force: true }); throw error; }
}
