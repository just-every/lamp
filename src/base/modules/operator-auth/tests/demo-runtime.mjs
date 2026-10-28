import { installD1Preflight } from '../../container/adapters/d1-workerd-setup.mjs';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySql } from './apply-sql.mjs';
import { signClaim, testKeys } from '../../owner-claim/tests/keys.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packages = await readdir(join(root, 'node_modules/.pnpm'));
const wrangler = packages.find(name => name.startsWith('wrangler@4.129.1_'));
if (!wrangler) throw new Error('Install the frozen workspace dependencies before running auth workerd tests.');
const require = createRequire(join(root, 'node_modules/.pnpm', wrangler, 'node_modules/wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions, D1_PLUGIN } = require('miniflare');
installD1Preflight(D1_PLUGIN);
const { build } = require('esbuild');
const output = await build({ entryPoints: [fileURLToPath(new URL('./demo-worker.mjs', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
const schemas = await Promise.all(['../accounts/schema/operator-auth.sql', '../../owner-claim/schema/owner-claim.sql']
  .map(path => readFile(new URL(path, import.meta.url), 'utf8')));
export const ORIGIN = 'https://demo.example.com';

export async function runtime(t, demo = true) {
  const keys = await testKeys(), installationId = crypto.randomUUID();
  const directory = await mkdtemp(join(tmpdir(), 'operator-auth-demo-'));
  const options = { issuer: ORIGIN, appOrigin: ORIGIN, installationId, expectedEmail: 'owner@demo.invalid',
    publicKeys: { 'test-v1': keys.publicKey },
    authConfig: { origin: ORIGIN, OWNER_EMAIL: 'owner@demo.invalid', SESSION_SECRET: crypto.randomUUID(),
      SETUP_TOKEN: crypto.randomUUID(), MAIL_FROM: 'auth@example.com' },
  };
  const outbound = [];
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: output.outputFiles[0].text,
    compatibilityDate: '2026-09-01', d1Databases: { DB: installationId },
    bindings: { TEST_CONFIG: JSON.stringify(options), ...(demo ? { RER_DEMO: '1' } : {}) },
    outboundService(request) { outbound.push(request.url); return new Response(null, { status: 202 }); },
  }), resourcePersistencePath: join(directory, 'state') });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); });
  const db = await mf.getD1Database('DB');
  for (const schema of schemas) await applySql(db, schema);
  const call = (path, { method = 'GET', input, cookie, headers = {} } = {}) => mf.dispatchFetch('http://localhost/__test_dispatch', {
    method: 'POST', redirect: 'manual', body: JSON.stringify({ url: new URL(path, ORIGIN).href, method,
      headers: { Host: new URL(ORIGIN).host, Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}),
        ...(input ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(input ? { body: JSON.stringify(input) } : {}),
    }),
  });
  return { db, call, outbound,
    async claim() {
      const token = await signClaim(keys.privateKey, { iss: ORIGIN, aud: ORIGIN, installationId, email: options.expectedEmail });
      const response = await call('/auth/owner-claim', { method: 'POST', input: { token, displayName: 'Demo owner' } });
      if (response.status !== 303) throw new Error(`Owner claim answered ${response.status}`);
      return response.headers.get('set-cookie').split(';')[0];
    },
  };
}
