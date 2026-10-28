// Node SQLite harness for the protocol tests: the real composed operator auth,
// its HTTP adapter and pinned providers, with fake providers at the network edge.
import { DatabaseSync } from '../../../../container/adapters/d1-sqlite.mjs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOperatorAuth, createAuthHandler } from '../../../index.mjs';
import { provider as fakeProvider, network, keys } from './idp.mjs';
const schema = await readFile(new URL('../../../accounts/schema/operator-auth.sql', import.meta.url), 'utf8');
const oidcSchema = await readFile(new URL('../schema/oidc.sql', import.meta.url), 'utf8');
export const ORIGIN = 'https://app.example';
export const SETUP = 'test-only-real-core-setup-secret';
export const clientKey = { ES256: await keys('ES256'), RS256: await keys('RS256') };
export function database(sqlite) {
  function statement(sql, values = []) {
    return { bind: (...bound) => statement(sql, bound),
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values), meta: { changes: 0 } }; },
      async run() { const results = sqlite.prepare(sql).all(...values); return { results, meta: { changes: sqlite.prepare('SELECT changes() AS n').get().n } }; },
    };
  }
  return { prepare: statement, async batch(statements) { sqlite.exec('BEGIN IMMEDIATE'); try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
}

// The default provider is an Auth install: ES256, private_key_jwt, dated email proofs.
export function authProvider(overrides = {}, fake = {}) {
  const { id = 'auth', ...rest } = overrides;
  return { config: { id, preset: 'auth', issuer: 'https://idp.example', clientId: 'client', privateKey: clientKey.ES256.private, ...rest },
    fake: { alg: 'ES256', method: 'private_key_jwt', clientKey: clientKey.ES256.public, rerInterfaces: ['oidc-provider@1.0.0'], ...fake,
      claims: { email_verified_at: Math.floor(Date.now() / 1000) - 86400, amr: ['email'], ...fake.claims } } };
}

export async function runtime(entries = [authProvider()], core = {}) {
  core = { INSTALLATION_KEY: crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),''), ...core };
  const dir = await mkdtemp(join(tmpdir(), 'oidc-test-')); const file = join(dir, 'auth.sqlite');
  let sqlite = new DatabaseSync(file); sqlite.exec(schema + oidcSchema);
  sqlite.exec('INSERT INTO oa_auth_settings(singleton,idp_sign_in) VALUES(1,1)');
  const providers = await Promise.all(entries.map(e => fakeProvider({ issuer: e.config.issuer ?? 'https://accounts.google.com', clientId: e.config.clientId, redirectUri: `${ORIGIN}/auth/oidc/${e.config.id}/callback`, ...e.fake })));
  const mails = [];
  const transport = network(providers);
  let db, auth, handler;
  function init() {
    db = database(sqlite);
    auth = createOperatorAuth({ db, clientIp: () => '192.0.2.1', fetch: (uri, init) => transport(uri, init),
      mailSender: { async send(message) { mails.push(message); return { provider: 'fixture', status: 'accepted', providerMessageId: null }; } },
      config: { origin: ORIGIN, OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: 'test-only-real-core-session-secret', SETUP_TOKEN: SETUP, MAIL_FROM: 'auth@example.com',
        OIDC_TRANSACTION_SECRET: 'test-only-independent-correlation-secret', providers: entries.map(e => e.config), ipLimit: 1000, emailLimit: 1000, ...core } });
    handler = createAuthHandler(auth);
  }
  init();
  const request = (path, { method = 'GET', cookie, body, headers = {} } = {}) => new Request(new URL(path, ORIGIN), { method, headers: { Host: new URL(ORIGIN).host, ...(method === 'POST' ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  const api = {
    providers, request, mails, get sqlite() { return sqlite; }, get auth() { return auth; }, get db() { return db; },
    provider: providers[0],
    call: (path, init) => handler(request(path, init)),
    async bootstrap() { const owner=await auth.bootstrap(request('/auth/bootstrap', { method: 'POST' }), { token: SETUP, displayName: 'Owner' });await auth.setIdentitySettings(request('/auth/settings/identity',{method:'POST',cookie:owner.cookie.split(';')[0]}),{idpSignIn:true});return owner; },
    async begin(returnTo = '/app', id = entries[0].config.id) { return handler(request(`/auth/oidc/${id}/start`, { method: 'POST', body: { returnTo } })); },
    async flow(returnTo, index = 0, claims = {}) {
      const id = entries[index].config.id;
      const start = await api.begin(returnTo, id); if (start.status !== 303) throw new Error(`Start failed: ${await start.text()}`);
      const location = new URL(start.headers.get('location')); const { code, state } = await providers[index].authorize(location, claims);
      const cookie = start.headers.get('set-cookie').split(';')[0];
      return { start, location, code, state, cookie, id, path: `/auth/oidc/${id}/callback?code=${code}&state=${state}` };
    },
    async finish(flow, overrides = {}) { return handler(request(flow.path, { cookie: flow.cookie, ...overrides })); },
    restart() { sqlite.close(); sqlite = new DatabaseSync(file); init(); },
    async close() { sqlite.close(); await rm(dir, { recursive: true, force: true }); },
  };
  return api;
}
export const sessionCookie = response => response.headers.getSetCookie().find(s => s.startsWith('__Host-operator_session='))?.split(';')[0];
