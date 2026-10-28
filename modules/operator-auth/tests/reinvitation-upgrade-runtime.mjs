import { installD1Preflight } from '../../container/adapters/d1-workerd-setup.mjs';
// Explicit upgrade probe: point OA_BASELINE_SOURCE at an independently copied
// old module plus its pre-cancellation.sql migration, never the live source.
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const packages = await readdir(join(root, 'node_modules/.pnpm'));
const wrangler = packages.find(name => name.startsWith('wrangler@4.129.1_'));
const require = createRequire(join(root, 'node_modules/.pnpm', wrangler, 'node_modules/wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions, D1_PLUGIN } = require('miniflare');
installD1Preflight(D1_PLUGIN);
const { build } = require('esbuild');
const setup = 'upgrade-only-setup-token-at-least-32-characters';
export const post = (input, cookie) => ({ method: 'POST', input, cookie });

export async function runtime() {
  const source = process.env.OA_BASELINE_SOURCE;
  if (!source) throw new Error('Set OA_BASELINE_SOURCE to the independent baseline source snapshot');
  const compile = async path => (await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })).outputFiles[0].text;
  const oldScript = await compile(join(source, 'operator-auth/tests/worker.mjs'));
  const newScript = await compile(fileURLToPath(new URL('./worker.mjs', import.meta.url)));
  const directory = await mkdtemp(join(tmpdir(), 'operator-auth-upgrade-'));
  const config = { origin: 'https://auth.test', OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: 'test-upgrade-session-secret-at-least-32-characters', SETUP_TOKEN: setup,
    MAIL_FROM: 'auth@example.com', ipLimit: 1000, emailLimit: 1000, limitWindowSeconds: 86400 };
  const init = script => new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script, compatibilityDate: '2026-09-01',
    d1Databases: { DB: 'auth-db' }, bindings: { TEST_CONFIG: JSON.stringify(config), TEST_OPTIONS: '{}' },
  }), resourcePersistencePath: join(directory, 'state') });
  let mf = init(oldScript);
  const migrate = async sql => {
    const db = await mf.getD1Database('DB');
    for (const statement of sql.replace(/^--.*$/gm, '').match(/CREATE TRIGGER[\s\S]*?END;|CREATE (?:TABLE|INDEX)[\s\S]*?;/g)) await db.prepare(statement).run();
  };
  try {
    await migrate(await readFile(join(source, 'pre-cancellation.sql'), 'utf8'));
    await (await mf.getD1Database('DB')).prepare('CREATE TABLE test_mail(id INTEGER PRIMARY KEY AUTOINCREMENT,message TEXT NOT NULL)').run();
    const call = (path, { method = 'GET', input, cookie } = {}) => {
      const url = new URL(path, config.origin);
      const headers = { Host: url.host, Origin: config.origin, 'X-Test-IP': '192.0.2.1', ...(cookie ? { Cookie: cookie } : {}) };
      if (input !== undefined) headers['Content-Type'] = 'application/json';
      return mf.dispatchFetch('http://localhost/__test_dispatch', { method: 'POST', redirect: 'manual',
        body: JSON.stringify({ url: url.href, method, headers, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }) });
    };
    return { call, get db() { return mf.getD1Database('DB'); },
      async bootstrap() {
        const response = await call('/auth/bootstrap', post({ token: setup, displayName: 'Owner' }));
        if (response.status !== 303) throw new Error(`Bootstrap status ${response.status}`);
        return response.headers.get('set-cookie').split(';')[0];
      },
      async link() {
        const row = await (await mf.getD1Database('DB')).prepare('SELECT message FROM test_mail ORDER BY id DESC LIMIT 1').first();
        return new URL(JSON.parse(row.message).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
      },
      async installCancellation() { await migrate(await readFile(join(source, 'operator-auth/accounts/schema/invitation-cancellation.sql'), 'utf8')); },
      async restart() { await mf.dispose(); mf = init(newScript); await mf.ready; },
      async close() { await mf.dispose(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) { await mf.dispose(); await rm(directory, { recursive: true, force: true }); throw error; }
}
