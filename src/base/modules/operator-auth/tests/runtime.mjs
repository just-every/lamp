import { installD1Preflight } from '../../container/adapters/d1-workerd-setup.mjs';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
// Use the repository's frozen Wrangler dependency graph, including pnpm's
// physical layout when a broader offline install lacks unrelated frontend tarballs.
const packages = await readdir(join(root, 'node_modules/.pnpm'));
const wrangler = packages.find((name) => name.startsWith('wrangler@4.129.1_'));
if (!wrangler) throw new Error('Install the frozen workspace dependencies before running auth workerd tests.');
const require = createRequire(join(root, 'node_modules/.pnpm', wrangler, 'node_modules/wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions, D1_PLUGIN } = require('miniflare');
installD1Preflight(D1_PLUGIN);
const { build } = require('esbuild');
const source = new URL('./worker.mjs', import.meta.url);
const output = await build({ entryPoints: [fileURLToPath(source)], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const schema = await readFile(new URL('../accounts/schema/operator-auth.sql', import.meta.url), 'utf8');
export const SETUP = 'test-only-setup-token-with-32-bytes-of-entropy';
export const SECRET = 'test-only-session-secret-with-32-bytes-of-entropy';
export async function runtime(overrides = {}, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'operator-auth-'));
  const config = { origin: 'https://auth.test', OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: SECRET, SETUP_TOKEN: SETUP,
    MAIL_FROM: 'auth@example.com', ipLimit: 1000, emailLimit: 1000, ...overrides };
  const init = () => new Miniflare({ ...convertV4MiniflareOptions({
    modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-09-01',
    d1Databases: { DB: 'auth-db' },
    bindings: { TEST_CONFIG: JSON.stringify(config), TEST_OPTIONS: JSON.stringify(options) },
  }), resourcePersistencePath: resolve(directory, 'state') });
  let mf = init();
  try {
    const db = await mf.getD1Database('DB');
    // D1 exec treats each input line as a statement; preserve trigger bodies by
    // applying the complete migration as one prepared SQL script through exec.
    const statements = schema.replace(/^--.*$/gm, '').match(/CREATE TRIGGER[\s\S]*?END;|CREATE (?:TABLE|INDEX)[\s\S]*?;/g);
    for (const statement of statements) await db.prepare(statement).run();
    await db.exec('CREATE TABLE test_mail (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL);');
    const call = async (path, { method = 'GET', input, cookie, headers = {}, host, origin, ip = '192.0.2.1' } = {}) => {
      const url = new URL(path, config.origin);
      const h = { Host: host ?? url.host, Origin: origin ?? config.origin, 'X-Test-IP': ip, ...headers };
      if (cookie) h.Cookie = cookie;
      if (input !== undefined) h['Content-Type'] = 'application/json';
      // Miniflare's HTTP proxy rewrites Host. Carry the exact Request through a
      // test-only envelope so adversarial Host/Origin reach the real handler.
      return mf.dispatchFetch('http://localhost/__test_dispatch', { method: 'POST', redirect: 'manual', body: JSON.stringify({ url: url.href, method, headers: h, ...(input !== undefined ? { body: JSON.stringify(input) } : {}) }) });
    };
    return {
      config, call, get db() { return mf.getD1Database('DB'); },
      async bootstrap() { const response = await call('/auth/bootstrap', { method: 'POST', input: { token: SETUP, displayName: 'Owner' } }); if (response.status !== 303) throw new Error(`Bootstrap ${response.status}: ${await response.text()}`); return response.headers.get('set-cookie').split(';')[0]; },
      async mails() { const db = await mf.getD1Database('DB'); const rows = await db.prepare('SELECT message FROM test_mail ORDER BY id').all(); return rows.results.map((row) => JSON.parse(row.message)); },
      async link() { const messages = await this.mails(); return new URL(messages.at(-1).text.match(/https?:\/\/\S+/)[0]); },
      async restart() { await mf.dispose(); mf = init(); await mf.ready; },
      async close() { await mf.dispose(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) { await mf.dispose(); await rm(directory, { recursive: true, force: true }); throw error; }
}
