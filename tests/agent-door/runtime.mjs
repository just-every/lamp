import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { unstable_splitSqlQuery } from 'wrangler';
import { signJws, seconds } from '../../src/base/modules/agent-door/conformance/crypto.mjs';
import initializeOwner from './initialize-owner.mjs';
import providerEdge from './provider-edge.mjs';

const require = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const types = { '.js': 'ESModule', '.mjs': 'ESModule', '.cjs': 'CommonJS', '.wasm': 'CompiledWasm', '.bin': 'Data', '.txt': 'Text', '.html': 'Text', '.sql': 'Text' };
async function files(directory) {
  const all = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) all.push(...await files(path)); else if (entry.isFile()) all.push(path);
  }
  return all;
}

/** Disposable production artifact with ordinary claim/settings and network-only edges. */
export async function openAgentRuntime() {
  const root = process.cwd(), origin = 'https://rer-hosted-check.invalid', email = 'communicator@example.test';
  const build = resolve('dist/server'), config = JSON.parse(await readFile(join(build, 'wrangler.json'), 'utf8'));
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const kid = randomUUID(), installationId = randomUUID(), sub = randomUUID(), token = randomBytes(32).toString('hex');
  const issuer = 'https://agent-company.example.invalid', business = 'harbour-proof';
  const { kty, crv, x, y } = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const publicKeys = { [kid]: { kty, crv, x, y, alg: 'ES256', use: 'sig' } };
  const entry = resolve(build, config.main);
  const modules = [entry, ...(await files(build)).filter(path => path !== entry && types[extname(path)])].map(path => ({ type: types[extname(path)], path }));
  const mail = [];
  const runtime = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, cf: false, workers: [
    { name: 'ingress', modules: true, script: `export default {fetch(request,env){const url=new URL(request.headers.get('x-lamp-original-url'));const headers=new Headers(request.headers);headers.delete('x-lamp-original-url');headers.set('host',url.host);return env.APP.fetch(new Request(url,{method:request.method,headers,redirect:'manual',...(!['GET','HEAD'].includes(request.method)?{body:request.body}:{})}));}}`, serviceBindings: { APP: 'app' } },
    { name: 'app', modules, modulesRoot: build,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    bindings: { ...config.vars, LAMP_APP_HOST: 'rer-hosted-check.invalid', LAMP_PAGE_HOST: 'status.rer-hosted-check.invalid',
      AUTH_ORIGIN: origin, AUTH_LOCAL: 'false', LAMP_LOCAL_ORIGIN: '', RER_DEV_ORIGIN: '', SETUP_OPERATOR_EMAIL: email, OWNER_EMAIL: email,
      SETUP_TOKEN: token, SESSION_SECRET: randomBytes(32).toString('hex'), SUBSCRIBER_TOKEN_SECRET: randomBytes(32).toString('hex'), WEBHOOK_SIGNING_SECRET: randomBytes(32).toString('hex'),
      RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId, RER_OWNER_CLAIM_APP_ORIGIN: origin, RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys),
      RER_BUSINESS_TRUST: JSON.stringify({ v: 1, issuer, audience: origin, subject: installationId, email, keys: publicKeys }),
      MAIL_PROVIDER: 'resend', MAIL_PROVIDER_API_KEY: 'synthetic-network-edge-only', MAIL_FROM_ADDRESS: 'status@rer-hosted-check.invalid',
      AI_PROVIDER_URL: 'https://agent-model.example.invalid/v1/chat/completions', AI_PROVIDER_API_KEY: 'synthetic-network-edge-only', AI_PROVIDER_MODEL: 'synthetic-lamp-incident', SLACK_SIGNING_SECRET: token },
    d1Databases: ['DB'], r2Buckets: ['SNAPSHOTS'], durableObjects: { SNAPSHOT_CACHE: { className: 'SnapshotCache', useSQLite: true } },
    queueProducers: { JOBS: 'lamp-agent-jobs' },
    assets: { directory: resolve('dist/client'), binding: 'ASSETS', routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true } },
    outboundService: async request => {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.origin === 'https://api.resend.com' && url.pathname === '/emails') {
        mail.push(await request.json()); return Response.json({ id: randomUUID() });
      }
      return providerEdge.fetch(request);
    },
  } ] }));
  try {
    await runtime.ready;
    const db = await runtime.getD1Database('DB', 'app');
    for (const name of (await readdir('migrations/core')).filter(name => name.endsWith('.sql')).sort()) {
      const statements = unstable_splitSqlQuery(await readFile(join('migrations/core', name), 'utf8'));
      await db.batch(statements.map(sql => db.prepare(sql)));
    }
    const request = (path, init = {}) => {
      const url = new URL(path, origin);
      if (![origin, 'https://status.rer-hosted-check.invalid'].includes(url.origin)) throw Error('Fixture request outside disposable installation');
      return runtime.dispatchFetch(url.href, { ...init, redirect: 'manual', headers: { ...Object.fromEntries(new Headers(init.headers)), Host: url.host, 'x-lamp-original-url': url.href } });
    };
    const response = await initializeOwner({ request, origin, email, displayName: 'Jordan Harbour', claim: { mode: 'setup-token', path: '/auth/bootstrap', token }, returnTo: '/app' });
    const cookie = response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
    await response.body?.cancel();
    const signer = { issuer, installationId, kid, privateKey: pair.privateKey };
    const iat = seconds();
    const settings = await signJws(pair.privateKey, kid, 'rer-business-settings+jwt', { v: 1, iss: issuer, aud: origin, sub: installationId,
      business, email, owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null, team: null });
    const paired = await request('/api/rer/business-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) });
    if (paired.status !== 200) throw Error(`Signed native Business binding returned ${paired.status}: ${JSON.stringify(await paired.json())}`);
    await paired.body?.cancel();
    return { origin, signer, business, person: { email, cookie, sub }, request, mail, close: () => runtime.dispose() };
  } catch (error) { await runtime.dispose(); throw error; }
}
