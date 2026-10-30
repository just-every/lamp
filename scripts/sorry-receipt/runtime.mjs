import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setupPageSettingsStatement } from '../ops-config.mjs';

const require = createRequire(import.meta.url);
const wrangler = require('wrangler');
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve('wrangler'))('miniflare');

async function modulesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await modulesIn(path));
    else if (/\.(?:js|mjs|txt|html|sql|bin|wasm)$/.test(path)) files.push({
      type: /\.(?:js|mjs)$/.test(path) ? 'ESModule' : /\.(?:txt|html|sql)$/.test(path) ? 'Text' : path.endsWith('.bin') ? 'Data' : 'CompiledWasm', path,
    });
  }
  return files;
}

/** An independent, empty installation of the built production Worker. Only
 * schema and installer page settings use SQL. Every import action and readback
 * uses the same loopback HTTP routes an owner uses. No source/provider is fake. */
export async function openReceiptInstall() {
  const state = await mkdtemp(join(tmpdir(), 'lamp-sorry-receipt-'));
  let runtime;
  try {
    const socket = createServer();
    await new Promise((accept, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', accept); });
    const port = socket.address().port;
    await new Promise((accept, reject) => socket.close(error => error ? reject(error) : accept()));
    const origin = `http://127.0.0.1:${port}`;
    const options = wrangler.unstable_getMiniflareWorkerOptions(resolve('dist/server/wrangler.json'));
    const { modulesRules, ...worker } = options.workerOptions;
    const modules = await modulesIn(dirname(options.main));
    modules.sort((a, b) => a.path === options.main ? -1 : b.path === options.main ? 1 : a.path.localeCompare(b.path));
    const secret = () => randomBytes(32).toString('hex');
    const setupToken = secret();
    const bindings = {
      ...worker.bindings, LAMP_APP_HOST: '127.0.0.1', LAMP_PAGE_HOST: 'localhost',
      LAMP_LOCAL_ORIGIN: origin, AUTH_ORIGIN: origin, AUTH_LOCAL: 'true',
      SETUP_OPERATOR_EMAIL: 'receipt-owner@example.test', SETUP_TOKEN: setupToken,
      SESSION_SECRET: secret(), SUBSCRIBER_TOKEN_SECRET: secret(), WEBHOOK_SIGNING_SECRET: secret(),
      MAIL_PROVIDER: '', MAIL_FROM_ADDRESS: 'lamp@localhost.invalid',
    };
    runtime = new Miniflare(convertV4MiniflareOptions({
      port, inspectorPort: 0, resourcePersistencePath: join(state, 'storage'),
      workers: [{ ...worker, modules, modulesRoot: dirname(options.main), bindings,
        outboundService() { throw new Error('Receipt installation refuses external effects.'); },
      }, ...options.externalWorkers],
    }));
    const env = await runtime.getBindings();
    const execute = async sql => {
      for (const statement of wrangler.unstable_splitSqlQuery(sql)) await env.DB.prepare(statement).run();
    };
    for (const file of (await readdir('migrations/core')).filter(name => name.endsWith('.sql')).sort()) {
      await execute(await readFile(join('migrations/core', file), 'utf8'));
    }
    await execute(setupPageSettingsStatement({ pageName: 'Disposable receipt verification', pageTagline: 'Test installation',
      pageAccentColor: '#2563eb', pageTimezone: 'UTC', pageHost: 'localhost', mailFromAddress: 'lamp@localhost.invalid' }));
    await runtime.ready;
    let cookie;
    const request = async (path, body, method = body === undefined ? 'GET' : 'POST', extraHeaders = {}) => {
      const response = await fetch(new URL(path, origin), { method, redirect: 'manual', signal: AbortSignal.timeout(60_000),
        headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (path === '/auth/bootstrap') {
        if (response.status !== 303) throw new Error(`Disposable owner bootstrap refused (HTTP ${response.status}).`);
        cookie = response.headers.get('set-cookie')?.split(';')[0];
        await response.body?.cancel();
        if (!cookie) throw new Error('Disposable owner bootstrap returned no session.');
        return;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Lamp ${path.split('/').at(-1)} refused (HTTP ${response.status}); no receipt was signed.`); }
      return response.json();
    };
    await request('/auth/bootstrap', { token: setupToken, displayName: 'Receipt verifier', returnTo: '/app' });
    return { request, async close() { try { await runtime.dispose(); } finally { await rm(state, { recursive: true, force: true }); } } };
  } catch (error) {
    try { await runtime?.dispose(); } finally { await rm(state, { recursive: true, force: true }); }
    throw error;
  }
}
