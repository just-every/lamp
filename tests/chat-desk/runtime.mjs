import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { readBuiltWorkerArtifact } from '../../scripts/build-output.mjs';
import { reservePort } from '../e2e/worker-startup.mjs';
import { randomBytes } from 'node:crypto';
import { unstable_splitSqlQuery } from 'wrangler';
import { authFixture, secret as sessionSecret } from '../auth-adoption/runtime.mjs';
const require = createRequire(import.meta.url), wrangler = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare'), { build } = wrangler('esbuild');
export const origin = 'https://app.example.test', page = 'https://status.example.test';
async function browserWorker() {
  await readBuiltWorkerArtifact();
  const options = require('wrangler').unstable_getMiniflareWorkerOptions(resolve('dist/server/wrangler.json'));
  const { modulesRules, ...workerOptions } = options.workerOptions;
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
  modules.sort((a, b) => a.path === options.main ? -1 : b.path === options.main ? 1 : a.path.localeCompare(b.path));
  return { ...options, workerOptions: { ...workerOptions, modules, modulesRoot: dirname(options.main) } };
}

export async function runtime(t, keys, { configured = true, browser = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lamp-chat-'));
  const signingSecret = randomBytes(32).toString('hex'), appId = `synthetic-lamp-${randomBytes(8).toString('hex')}`;
  const production = browser ? await browserWorker() : null;
  const port = browser ? await reservePort({ label: 'chat links production Worker' }) : 0;
  const runtimeOrigin = browser ? `http://127.0.0.1:${port}` : origin;
  const runtimePage = browser ? `http://localhost:${port}` : page;
  const built = production ? null : await build({ entryPoints: ['tests/fixtures/chat-desk/worker.ts'], bundle: true, format: 'esm', platform: 'browser', write: false,
    external: ['cloudflare:workers', 'node:*'], define: { 'import.meta.env.DEV': 'false' },
    plugins: [{ name: 'assets', setup(builder) {
      builder.onResolve({ filter: /\?(inline|raw)$/ }, args => ({ path: resolve(args.resolveDir, args.path.split('?')[0]), namespace: 'asset' }));
      builder.onLoad({ filter: /.*/, namespace: 'asset' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`, loader: 'js' }));
    } }],
  });
  const requests = [], replies = [];
  const workerOptions = { ...(production?.workerOptions ?? { name: 'lamp-chat-proof', modules: true, script: built.outputFiles[0].text }),
    compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
    bindings: { ...production?.workerOptions.bindings, LAMP_APP_HOST: new URL(runtimeOrigin).hostname, LAMP_PAGE_HOST: new URL(runtimePage).hostname, AUTH_ORIGIN: runtimeOrigin,
      ...(browser ? { AUTH_LOCAL: 'true', LAMP_LOCAL_ORIGIN: runtimeOrigin } : {}),
      SESSION_SECRET: sessionSecret, SETUP_OPERATOR_EMAIL: 'operator@example.test', MAIL_FROM_ADDRESS: 'lamp@example.test',
      SUBSCRIBER_TOKEN_SECRET: randomBytes(32).toString('hex'), WEBHOOK_SIGNING_SECRET: randomBytes(32).toString('hex'),
      ...(configured ? { SLACK_SIGNING_SECRET: signingSecret, BOT_FRAMEWORK_APP_ID: appId } : { SLACK_SIGNING_SECRET: '', BOT_FRAMEWORK_APP_ID: '' }) },
    ...(production ? {} : { d1Databases: ['DB'], r2Buckets: ['SNAPSHOTS'], durableObjects: { SNAPSHOT_CACHE: { className: 'SnapshotCache', useSQLite: true } }, queueProducers: { JOBS: 'lamp-chat-jobs' } }),
    outboundService: async request => {
      if (request.url === 'https://hooks.slack.com/actions/synthetic-lamp-1') { assert.equal(request.method, 'POST'); replies.push(await request.json()); return new Response('ok'); }
      if (browser && [runtimeOrigin, runtimePage].includes(new URL(request.url).origin)) return worker.dispatchFetch(request);
      requests.push(request.url); assert.equal(request.method, 'GET'); assert.equal(request.headers.get('authorization'), null);
      if (request.url === 'https://login.botframework.com/v1/.well-known/openidconfiguration') return Response.json({ issuer: 'https://api.botframework.com', jwks_uri: 'https://login.botframework.com/v1/.well-known/keys' });
      if (request.url === 'https://login.botframework.com/v1/.well-known/keys') return Response.json({ keys });
      throw new Error(`Unexpected outbound request to ${new URL(request.url).origin}`);
    },
  };
  const worker = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port, inspectorPort: 0,
    resourcePersistencePath: join(directory, 'state'), workers: [workerOptions, ...(production?.externalWorkers ?? [])] }));
  const close = async () => { await worker.dispose(); await rm(directory, { recursive: true, force: true }); };
  try {
    await worker.ready;
    const db = await worker.getD1Database('DB');
    const names = (await readdir('migrations/core')).filter(name => name.endsWith('.sql')).sort();
    const apply = async name => db.batch(unstable_splitSqlQuery(await readFile(join('migrations/core', name), 'utf8')).map(sql => db.prepare(sql)));
    for (const name of names.filter(name => !name.endsWith('_chat_desk_links.sql'))) await apply(name);
    const operator = '01J00000000000000000000001';
    await db.batch([
      db.prepare("INSERT INTO operators(id,email,display_name,is_setup_operator,created_at,updated_at) VALUES(?,'operator@example.test','Synthetic operator',1,'2026-10-23','2026-10-23')").bind(operator),
      db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES(?,'operator@example.test','Synthetic operator','owner','active',?)").bind(operator, Date.now()),
      db.prepare('INSERT INTO oa_bootstrap(singleton,claim_id,claimed_at) VALUES(1,?,?)').bind(operator, Date.now()),
      db.prepare("INSERT INTO operators(id,email,display_name,is_setup_operator,created_at,updated_at) VALUES('01J00000000000000000000002','second@example.test','Synthetic second operator',0,'2026-10-23','2026-10-23')"),
      db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('01J00000000000000000000002','second@example.test','Synthetic second operator','owner','active',?)").bind(Date.now()),
      db.prepare("INSERT INTO page_settings(id,page_name,tagline,accent_color,timezone,hostname,feed_id,mail_from_address,created_at,updated_at) VALUES('default','Synthetic Lamp','','#16794c','UTC','status.example.test','synthetic-lamp-5','lamp@example.test','2026-10-23','2026-10-23')"),
      db.prepare("INSERT INTO setup_readiness(step,evidence_key,checked_at) VALUES('first-run','complete','2026-10-23')"),
    ]);
    const before = await db.prepare('SELECT * FROM operators').all();
    await apply(names.find(name => name.endsWith('_chat_desk_links.sql')));
    assert.deepEqual((await db.prepare('SELECT * FROM operators').all()).results, before.results, 'populated prior-schema upgrade preserves operator attribution');
    const cookie = await authFixture(db, { origin: runtimeOrigin, owner: 'operator@example.test' }).signIn();
    const call = async (path, body, method = body === undefined ? 'GET' : 'POST', credential = cookie) => {
      const response = await worker.dispatchFetch(runtimeOrigin + path, { method, headers: { Host: new URL(runtimeOrigin).host, Origin: runtimeOrigin, Cookie: credential, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
    };
    return { worker, db, call, close, cookie, origin: runtimeOrigin, signingSecret, appId, operator, requests, replies, signIn: email => authFixture(db,{origin:runtimeOrigin,owner:email}).signIn(email) };
  } catch (error) { await close(); throw error; }
}
