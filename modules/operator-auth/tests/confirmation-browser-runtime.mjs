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
if (!wrangler) throw new Error('Install the frozen workspace dependencies before running browser auth tests.');
const require = createRequire(join(root, 'node_modules/.pnpm', wrangler, 'node_modules/wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions, D1_PLUGIN } = require('miniflare');
installD1Preflight(D1_PLUGIN);
const { build } = require('esbuild');
const browserRequire = createRequire(join(root, 'default-seed/package.json'));
export const { chromium } = browserRequire('@playwright/test');
const output = await build({
  entryPoints: [fileURLToPath(new URL('./confirmation-browser-worker.mjs', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
});
const schema = await readFile(new URL('../accounts/schema/operator-auth.sql', import.meta.url), 'utf8');

export async function browserRuntime(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'operator-auth-browser-'));
  const config = {
    origin: 'http://127.0.0.1', local: true, OWNER_EMAIL: 'owner@example.com',
    SESSION_SECRET: 'browser-test-only-session-secret-at-least-32-characters',
    SETUP_TOKEN: 'browser-test-only-setup-token-at-least-32-characters',
    MAIL_FROM: 'auth@example.com', ipLimit: 1000, emailLimit: 1000, ...overrides,
  };
  const options = {
    ...convertV4MiniflareOptions({
      host: '127.0.0.1', port: 0, modules: true, script: output.outputFiles[0].text,
      compatibilityDate: '2026-09-01', d1Databases: { DB: 'browser-auth' },
      bindings: { TEST_CONFIG: JSON.stringify(config) },
    }),
    resourcePersistencePath: join(directory, 'state'),
  };
  const mf = new Miniflare(options);
  try {
    const address = await mf.ready;
    config.origin = address.origin;
    // Publish trusted fixture configuration without restarting the listener.
    const db = await mf.getD1Database('DB');
    await db.exec('CREATE TABLE browser_config (value TEXT NOT NULL);');
    await db.prepare('INSERT INTO browser_config(value) VALUES(?)').bind(JSON.stringify(config)).run();
    await applySql(db, schema);
    await db.exec('CREATE TABLE browser_mail (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL);');
    const post = (path, input, headers = {}) => fetch(new URL(path, config.origin), {
      method: 'POST', redirect: 'manual',
      headers: { Origin: config.origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(input),
    });
    const setup = await post('/auth/bootstrap', { token: config.SETUP_TOKEN, displayName: 'Owner' });
    if (setup.status !== 303) throw new Error(`Browser fixture bootstrap failed: ${setup.status}`);
    return {
      origin: config.origin, db, post,
      async issue({ invite = false, returnTo = '/app?source=confirmation#ready' } = {}) {
        const response = invite
          ? await post('/auth/invite', { email: 'invitee@example.com', displayName: 'Invitee', returnTo }, { Cookie: setup.headers.get('set-cookie').split(';')[0] })
          : await post('/auth/magic-link', { email: config.OWNER_EMAIL, returnTo });
        if (response.status !== 202) throw new Error(`Browser fixture link issuance failed: ${response.status}`);
        const row = await db.prepare('SELECT message FROM browser_mail ORDER BY id DESC LIMIT 1').first();
        return new URL(JSON.parse(row.message).text.match(/https?:\/\/\S+/)[0]);
      },
      async close() { await mf.dispose(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
