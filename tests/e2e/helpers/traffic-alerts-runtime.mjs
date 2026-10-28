import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { readBuiltWorkerArtifact } from '../../../scripts/build-output.mjs';
import { reservePort } from '../worker-startup.mjs';
import { withDraftVersion } from '../draft-version-helper.mjs';
import { migrate, executeSql } from '../../reference-storage/runtime.mjs';

const require = createRequire(import.meta.url), wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const { unstable_getMiniflareWorkerOptions } = require('wrangler');

/** The built production Worker and real bindings. Only the provider's network
 * response and the fixture clock are controlled; no business service is fake. */
export async function openTrafficAlertsRuntime({ database = true, diagnostic = () => {} } = {}) {
  await readBuiltWorkerArtifact();
  const port = await reservePort({ label: 'traffic alerts production Worker' });
  const origin = `http://127.0.0.1:${port}`, publicOrigin = `http://localhost:${port}`;
  const options = unstable_getMiniflareWorkerOptions(resolve('dist/server/wrangler.json'));
  const { modulesRules, ...workerOptions } = options.workerOptions;
  assert.deepEqual(modulesRules.map(rule => rule.type), ['ESModule', 'Text', 'Data', 'CompiledWasm']);
  async function moduleFiles(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await moduleFiles(path));
      else if (/\.(?:js|mjs|txt|html|sql|bin|wasm)$/.test(path)) files.push({ type: /\.(?:js|mjs)$/.test(path) ? 'ESModule' : /\.(?:txt|html|sql)$/.test(path) ? 'Text' : path.endsWith('.bin') ? 'Data' : 'CompiledWasm', path });
    }
    return files;
  }
  const modules = await moduleFiles(dirname(options.main));
  const wrapper = join(dirname(options.main), '__traffic-clock.mjs');
  modules.sort((a, b) => a.path === options.main ? -1 : b.path === options.main ? 1 : a.path.localeCompare(b.path));
  modules.unshift({ type: 'ESModule', path: wrapper, contents: `
    import worker from './index.js';
    export * from './index.js';
    const RealDate = Date;
    let at;
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [at === undefined ? RealDate.now() : at])); }
      static now() { return at === undefined ? RealDate.now() : at; }
    };
    export default {
      async fetch(request, env, context) {
        if (new URL(request.url).pathname === '/__fixture/clock' && request.method === 'PUT') {
          at = (await request.json()).at;
          return new Response(null, {status:204});
        }
        return worker.fetch(request, env, context);
      },
      queue: (...args) => worker.queue(...args),
      scheduled: (...args) => worker.scheduled(...args),
    };
  ` });
  const messages = [];
  let runtime, cookie;
  const bindings = { ...workerOptions.bindings, LAMP_APP_HOST: '127.0.0.1', LAMP_PAGE_HOST: 'localhost', LAMP_LOCAL_ORIGIN: origin, AUTH_ORIGIN: origin, AUTH_LOCAL: 'true',
    SETUP_OPERATOR_EMAIL: 'synthetic-lamp-owner@example.test', SESSION_SECRET: 'synthetic-lamp-traffic-session-1'.repeat(3), SETUP_TOKEN: 'synthetic-lamp-traffic-setup-1'.repeat(3),
    SUBSCRIBER_TOKEN_SECRET: 'synthetic-lamp-traffic-subscriber-1'.repeat(3), WEBHOOK_SIGNING_SECRET: 'synthetic-lamp-traffic-webhook-1'.repeat(3),
    MAIL_FROM_ADDRESS: 'lamp@example.test', MAIL_PROVIDER: 'resend', MAIL_PROVIDER_API_KEY: 'synthetic-lamp-traffic-resend-1' };
  const outboundService = async request => {
    const url = new URL(request.url);
    if (url.origin === 'https://api.resend.com' && url.pathname === '/emails') {
      const message = await request.json(); messages.push(message);
      return Response.json({ id: `synthetic-lamp-traffic-receipt-${messages.length}` });
    }
    if (url.origin === 'https://api.resend.com' && url.pathname === '/domains') return Response.json({ data: [{ id: 'synthetic-lamp-traffic-domain-1', name: 'example.test', status: 'verified' }], has_more: false });
    if (url.origin === origin || url.origin === publicOrigin) return runtime.dispatchFetch(request);
    throw new Error(`Unexpected traffic fixture provider edge: ${url.origin}${url.pathname}`);
  };
  try {
    const configured = { ...workerOptions, modules, modulesRoot: dirname(options.main), bindings, outboundService };
    if (!database) delete configured.d1Databases;
    diagnostic('HIST-006 starting built Worker');
    runtime = new Miniflare(convertV4MiniflareOptions({ port, inspectorPort: 0, workers: [configured, ...options.externalWorkers] }));
    runtime.ready.then(() => diagnostic('HIST-006 built Worker ready'), error => diagnostic('HIST-006 Worker start failed: ' + error.message));
    const env = await runtime.getBindings();
    diagnostic('HIST-006 real Worker bindings ready');
    if (database) {
      await migrate(env.DB);
      diagnostic('HIST-006 fixture schema migrated');
      await executeSql(env.DB, `INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('01J00000000000000000000091','synthetic-lamp-owner@example.test','Synthetic Lamp owner','owner','active',${Date.now()});
        INSERT INTO oa_bootstrap(singleton,claim_id,claimed_at) VALUES(1,'01J00000000000000000000091',${Date.now()});
        INSERT INTO page_settings(id,page_name,tagline,accent_color,timezone,hostname,feed_id,mail_from_address,created_at,updated_at) VALUES('default','Synthetic Lamp traffic','Aggregate traffic fixture','#16794C','UTC','localhost','synthetic-lamp-traffic-feed-1','lamp@example.test','2026-10-01','2026-10-01');
        INSERT INTO setup_readiness(step,evidence_key,checked_at) VALUES('first-run','complete','2026-10-01');`);
    }
    const raw = (path, init = {}) => {
      const url = new URL(path, origin), headers = new Headers(init.headers);
      // The shared draft client may inherit its caller's AUTH_ORIGIN. This
      // independent installation always sends its own authority, once.
      headers.set('Host', url.host);
      headers.set('Origin', origin);
      if (cookie) headers.set('Cookie', cookie);
      return runtime.dispatchFetch(url.href, { redirect: 'manual', ...init, headers });
    };
    const api = async (path, init = {}) => {
      init = await withDraftVersion(path, init, read => raw(read));
      const response = await raw(path, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null, text };
    };
    const post = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });
    if (database) {
      diagnostic('HIST-006 native owner sign-in starting');
      const login = await post('/auth/magic-link', { email: 'synthetic-lamp-owner@example.test' });
      assert.ok(login.status >= 200 && login.status < 300, login.text);
      const invitation = messages.find(message => message.to.includes('synthetic-lamp-owner@example.test'));
      assert.ok(invitation, 'the actual provider serializer sends owner sign-in');
      const token = new URL(invitation.text.match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');
      const confirmed = await raw('/auth/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      assert.equal(confirmed.status, 303, await confirmed.text());
      cookie = confirmed.headers.get('set-cookie').split(';')[0];
      diagnostic('HIST-006 native owner signed in');
    }
    return { runtime, env, origin, publicOrigin, api, post, raw, messages, get cookie() { return cookie; },
      async clock(at) { assert.equal((await raw('/__fixture/clock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ at }) })).status, 204); },
      async tick(at) { assert.equal((await (await runtime.getWorker()).scheduled({ cron: '* * * * *', scheduledTime: at })).outcome, 'ok'); },
      async close() { await runtime.dispose(); },
    };
  } catch (cause) { await runtime?.dispose(); throw cause; }
}
