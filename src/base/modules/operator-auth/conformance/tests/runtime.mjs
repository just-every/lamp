import { installD1Preflight } from '../../../container/adapters/d1-workerd-setup.mjs';
import { after } from 'node:test';
import { captureD1Baseline } from '../../../../tests/support/d1-baseline.mjs';
import { runtimeLease } from '../../../../tests/support/runtime-lease.mjs';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const packages = await readdir(join(root, 'node_modules/.pnpm'));
const wrangler = packages.find((name) => name.startsWith('wrangler@4.129.1_'));
if (!wrangler) throw new Error('Install the frozen workspace dependencies before running operator-auth conformance.');
const require = createRequire(join(root, 'node_modules/.pnpm', wrangler, 'node_modules/wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions, D1_PLUGIN } = require('miniflare');
installD1Preflight(D1_PLUGIN);
const { build } = require('esbuild');
const worker = new URL('./harness-worker.mjs', import.meta.url);
const output = await build({ entryPoints: [fileURLToPath(worker)], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const schema = await readFile(new URL('../../accounts/schema/operator-auth.sql', import.meta.url), 'utf8');

const acquire = runtimeLease();
let shared;
async function initializeRuntime() {
  const directory = await mkdtemp(join(tmpdir(), 'operator-auth-conformance-'));
  const init = () => new Miniflare({ ...convertV4MiniflareOptions({
    modules: true,
    script: output.outputFiles[0].text,
    compatibilityDate: '2026-09-01',
    d1Databases: { DB: 'operator-auth-conformance' },
  }), resourcePersistencePath: resolve(directory, 'state') });

  let mf;
  try { mf = init(); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  try {
    const db = await mf.getD1Database('DB');
    const statements = schema.replace(/^--.*$/gm, '').match(/CREATE TRIGGER[\s\S]*?END;|CREATE (?:TABLE|INDEX)[\s\S]*?;/g);
    if (!statements) throw new Error('The operator-auth migration did not contain executable D1 statements.');
    for (const statement of statements) await db.prepare(statement).run();
    await db.exec('CREATE TABLE conformance_mail (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL);');

    return { mf, db, restore: await captureD1Baseline(db), async dispose() {
      try { await mf.dispose(); } finally { await rm(directory, { recursive: true, force: true }); }
    } };
  } catch (error) {
    try { await mf.dispose(); } finally { await rm(directory, { recursive: true, force: true }); }
    throw error;
  }
}
after(async () => { if (shared) await (await shared).dispose(); });

export async function openConformanceRuntime({ config, mailStatus, noMail }) {
  const release = await acquire();
  try {
    const instance = await (shared ??= initializeRuntime());
    await instance.restore();
    const { mf, db } = instance;
    const pending = new Set();
    let closed = false;
    const call = async (path, { method = 'GET', input, cookie, headers = {}, ip = '192.0.2.1' } = {}) => {
      if (closed) throw new Error('Conformance case is closed.');
      const url = new URL(path, config.origin);
      const requestHeaders = {
        Host: url.host,
        ...(method === 'POST' ? { Origin: config.origin, 'Content-Type': 'application/json' } : {}),
        'X-Test-IP': ip,
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      };
      const dispatched = mf.dispatchFetch('http://localhost/__conformance_dispatch', {
        method: 'POST',
        redirect: 'manual',
        body: JSON.stringify({
          harness: { config, options: { mailStatus, noMail } },
          url: url.href,
          method,
          headers: requestHeaders,
          ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
        }),
      });
      pending.add(dispatched);
      try { return await dispatched; } finally { pending.delete(dispatched); }
    };

    return {
      call,
      privateRequest(cookie, options = {}) { return call('/__conformance/private', { ...options, cookie }); },
      async mails() {
        const result = await db.prepare('SELECT message FROM conformance_mail ORDER BY id').all();
        return result.results.map((row) => JSON.parse(row.message));
      },
      async admitVerifiedIdentity(identity, returnTo) {
        const response = await call('/__conformance/oidc-admit', { method: 'POST', input: { identity, returnTo } });
        if (!response.ok) throw new Error(`Verified OIDC admission returned ${response.status}.`);
        const body = await response.json();
        const setCookie = response.headers.get('set-cookie');
        if (!setCookie) throw new Error('Verified OIDC admission returned no session cookie.');
        return { ...body, cookie: setCookie };
      },
      async close() {
        closed = true;
        try { await Promise.allSettled(pending); } finally { release(); }
      },
    };
  } catch (error) { release(); throw error; }
}
