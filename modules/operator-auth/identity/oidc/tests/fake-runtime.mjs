import { installD1Preflight } from '../../../../container/adapters/d1-workerd-setup.mjs';
// Node side of the fake-provider tests: real workerd with D1 through Miniflare,
// requests carried in a test envelope so exact Host and Origin reach the app.
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keys } from './idp.mjs';
import { applySql } from '../../../tests/apply-sql.mjs';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const packages = await readdir(join(root, 'node_modules/.pnpm'));
const wrangler = packages.find(n => n.startsWith('wrangler@4.129.1_'));
if (!wrangler) throw new Error('Install the frozen workspace dependencies (Wrangler 4.129.1).');
const require = createRequire(join(root, 'node_modules/.pnpm', wrangler, 'node_modules/wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions, D1_PLUGIN } = require('miniflare');
installD1Preflight(D1_PLUGIN);
const { build } = require('esbuild');
const output = await build({ entryPoints: [fileURLToPath(new URL('./fake-worker.mjs', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
export const ORIGIN = 'https://app.example';
export const SETUP = 'test-only-fake-provider-setup-token-value';
export const KEYS = { authSigning: await keys('ES256'), authRotated: await keys('ES256'), app: await keys('ES256'), appRsa: await keys('RS256'),
  googleSigning: await keys('RS256'), microsoftSigning: await keys('RS256'), oktaSigning: await keys('RS256'), nextSigning: await keys('ES256') };
const KEY_JSON = JSON.stringify(KEYS);
export const MICROSOFT = 'https://login.microsoftonline.com/contoso.example/v2.0';
const day = 86400;

// One app offering all four presets, each with its own fake at the edge.
export function presets(origin = ORIGIN) {
  const proven = () => Math.floor(Date.now() / 1000) - day;
  return {
    providers: [
      { id: 'auth', preset: 'auth', issuer: 'https://id.example', clientId: 'app-at-auth', privateKeyName: 'app' },
      { id: 'google', preset: 'google', clientId: 'app-at-google', tokenAuthMethod: 'client_secret_basic', clientSecret: 'google-secret' },
      { id: 'microsoft', preset: 'microsoft', tenant: 'contoso.example', clientId: 'app-at-microsoft', privateKeyName: 'appRsa', subjectEmails: { 'ms-member': 'member@example.com' } },
      { id: 'okta', preset: 'okta', issuer: 'https://corp.okta.example', clientId: 'app-at-okta', tokenAuthMethod: 'client_secret_post', clientSecret: 'okta-secret', subjectEmails: { 'okta-member': 'member@example.com', 'okta-owner': 'owner@example.com' } },
    ],
    fakes: [
      { issuer: 'https://id.example', redirectUri: `${origin}/auth/oidc/auth/callback`, clientId: 'app-at-auth', keyName: 'authSigning', method: 'private_key_jwt', clientKeyName: 'app', rerInterfaces: ['oidc-provider@1.0.0'], claims: { email_verified_at: proven(), amr: ['email'] } },
      { issuer: 'https://accounts.google.com', redirectUri: `${origin}/auth/oidc/google/callback`, clientId: 'app-at-google', keyName: 'googleSigning', clientSecret: 'google-secret', claims: { hd: 'example.com' } },
      { issuer: MICROSOFT, redirectUri: `${origin}/auth/oidc/microsoft/callback`, clientId: 'app-at-microsoft', keyName: 'microsoftSigning', method: 'private_key_jwt', clientKeyName: 'appRsa', claims: { sub: 'ms-member', email: 'mutable@contoso.example', email_verified: false } },
      { issuer: 'https://corp.okta.example', redirectUri: `${origin}/auth/oidc/okta/callback`, clientId: 'app-at-okta', keyName: 'oktaSigning', method: 'client_secret_post', clientSecret: 'okta-secret', claims: { sub: 'okta-member', email: 'member@example.com', email_verified: true } },
      { issuer: 'https://id-next.example', redirectUri: `${origin}/auth/oidc/auth/callback`, clientId: 'app-at-next', keyName: 'nextSigning', method: 'private_key_jwt', clientKeyName: 'app', rerInterfaces: ['oidc-provider@1.2.0'], claims: { email_verified_at: proven() } },
    ],
  };
}

// schemas: the SQL a store already has (default: a fresh store from the current schema).
export async function runtime(t, setup = presets(), { schemas } = {}) {
  setup = { ...setup, core: { INSTALLATION_KEY:crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),''), ...setup.core } };
  const directory = await mkdtemp(join(tmpdir(), 'oidc-fake-'));
  const init = () => new Miniflare({ ...convertV4MiniflareOptions({ modules: true, cf: false, script: output.outputFiles[0].text, compatibilityDate: '2026-09-01', d1Databases: { DB: 'fake-provider-db' },
    bindings: { TEST_SETUP: JSON.stringify({ ...setup, keys: JSON.parse(KEY_JSON) }) } }), resourcePersistencePath: join(directory, 'state') });
  let mf = init();
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); });
  let db = await mf.getD1Database('DB');
  for (const sql of schemas ?? [await read(setup.native?'../../../tests/native/schema.sql':'../../../accounts/schema/operator-auth.sql'), await read('../schema/oidc.sql'), ...(setup.native?[await read('../../../../dependencies/schema/dependencies.sql'),await read('../../../../dependencies/schema/approval-attempt.sql'),await read('../../../../dependencies/schema/keys-sealed.sql')]:[])]) await applySql(db, sql);
  if(!schemas && !setup.native) await db.prepare('INSERT INTO oa_auth_settings(singleton,idp_sign_in) VALUES(1,1)').run();
  for (const sql of ['CREATE TABLE fixture_grants(code TEXT PRIMARY KEY, issuer TEXT NOT NULL, payload TEXT NOT NULL)', 'CREATE TABLE fixture_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)', 'CREATE TABLE test_mail(id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL)', 'CREATE TABLE fixture_hook_calls(session_id TEXT NOT NULL, method TEXT NOT NULL)', 'CREATE TABLE fixture_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, issuer TEXT NOT NULL, uri TEXT NOT NULL)']) await db.prepare(sql).run();
  const call = (path, { method = 'GET', input, cookie, headers = {}, form } = {}) => mf.dispatchFetch('http://localhost/__test_dispatch', { method: 'POST', redirect: 'manual', body: JSON.stringify({
    url: `${setup.core?.origin??ORIGIN}${path}`, method, headers: { Host: new URL(setup.core?.origin??ORIGIN).host, ...(method === 'POST' ? { Origin: setup.core?.origin??ORIGIN, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(input !== undefined ? { body: form ? new URLSearchParams(input).toString() : JSON.stringify(input) } : {}) }) });
  const control = async (path, input) => { const response = await call(path, { method: 'POST', input }); if (response.status !== 200) throw new Error(`${path} ${response.status}: ${await response.text()}`); return response.json(); };
  const r = {
    call, get db() { return db; },
    session: response => response.headers.getSetCookie().find(c => c.startsWith(setup.native?'native_staff=':'__Host-operator_session='))?.split(';')[0],
    async bootstrap() { const response = await call('/auth/bootstrap', { method: 'POST', input: { token: SETUP, displayName: 'Owner' } }); if (response.status !== 303) throw new Error(await response.text()); return r.session(response); },
    async operator(email, role = 'member', status = 'active') {
      const id = email.split('@')[0] + (email.endsWith('@example.com') ? '' : `-${email.split('@')[1]}`);
      await db.prepare('INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES(?,?,?,?,?,?)').bind(id, email, id, role, status, Date.now()).run();
      return id;
    },
    /** Start at the app, then act as the browser at the provider: a code and state for this provider's redirect URI. */
    async flow(id, claims = {}, returnTo = '/app') {
      const start = await call(`/auth/oidc/${id}/start`, { method: 'POST', input: { returnTo } });
      if (start.status !== 303) throw new Error(`start ${id} ${start.status}: ${await start.text()}`);
      const location = start.headers.get('location');
      const { code, state } = await control('/__fake/authorize', { location, claims });
      return { id, location, code, state, cookie: start.headers.get('set-cookie').split(';')[0], path: `${new URL(location).searchParams.get('redirect_uri').slice(ORIGIN.length)}?state=${state}&code=${code}` };
    },
    finish: (f, extra = {}) => call(f.path, { cookie: f.cookie, ...extra }),
    async login(id, claims) { return r.finish(await r.flow(id, claims)); },
    set: (issuer, changes) => control('/__fake/set', { issuer, changes }),
    configure: (id, changes) => control('/__fake/config', { id, changes }),
    clock: offset => control('/__fake/clock', { offset }),
    async requests(issuer) { return (await (await call('/__fake/requests', { method: 'POST', input: {} })).json()).filter(row => row.issuer === issuer); },
    async mails() { return (await db.prepare('SELECT message FROM test_mail ORDER BY id').all()).results.map(row => JSON.parse(row.message)); },
    async link() { return new URL((await r.mails()).at(-1).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token'); },
    /** A step-up proof: the email link to the session's own operator, confirmed in that session. */
    async stepUp(cookie, action = 'domains:change') {
      const asked = await call('/auth/step-up', { method: 'POST', input: { action }, cookie });
      if (asked.status !== 202) throw new Error(`step-up ${asked.status}: ${await asked.text()}`);
      return call('/auth/confirm', { method: 'POST', input: { token: await r.link() }, cookie });
    },
    async apply(sql) { return applySql(db, sql); },
    async restart() { await mf.dispose(); mf = init(); db = await mf.getD1Database('DB'); },
  };
  return r;
}
export const json = async response => ({ status: response.status, body: await response.json() });

// A real HTTP listener for browser journeys: the same app on a loopback origin.
export async function browserRuntime(t, makeSetup) {
  const directory = await mkdtemp(join(tmpdir(), 'oidc-browser-'));
  const options = setup => ({ ...convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, modules: true, cf: false, script: output.outputFiles[0].text, compatibilityDate: '2026-09-01',
    d1Databases: { DB: 'fake-provider-browser-db' }, bindings: { TEST_SETUP: JSON.stringify({ ...setup, keys: JSON.parse(KEY_JSON) }) } }), resourcePersistencePath: join(directory, 'state') });
  const mf = new Miniflare(options(makeSetup('http://127.0.0.1')));
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); });
  const address = await mf.ready;
  const origin = address.origin;
  const db = await mf.getD1Database('DB');
  await applySql(db, await read('../../../accounts/schema/operator-auth.sql'));
  await applySql(db, await read('../schema/oidc.sql'));
  await db.prepare('INSERT INTO oa_auth_settings(singleton,idp_sign_in) VALUES(1,1)').run();
  for (const sql of ['CREATE TABLE fixture_grants(code TEXT PRIMARY KEY, issuer TEXT NOT NULL, payload TEXT NOT NULL)', 'CREATE TABLE fixture_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)', 'CREATE TABLE test_mail(id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL)', 'CREATE TABLE fixture_hook_calls(session_id TEXT NOT NULL, method TEXT NOT NULL)', 'CREATE TABLE fixture_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, issuer TEXT NOT NULL, uri TEXT NOT NULL)']) await db.prepare(sql).run();
  // Store the explicitly chosen fixture origin after ingress binds, without a restart.
  await db.prepare('INSERT INTO fixture_state(key,value) VALUES(?,?)').bind('browserSetup', JSON.stringify({ ...makeSetup(origin), keys: JSON.parse(KEY_JSON) })).run();
  const post = async (path, input) => { const response = await fetch(`${origin}${path}`, { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); return response; };
  return { origin, db, post,
    async link() { const row = await db.prepare('SELECT message FROM test_mail ORDER BY id DESC LIMIT 1').first(); return new URL(JSON.parse(row.message).text.match(/https?:\/\/\S+/)[0]); },
    set: async (issuer, changes) => (await post('/__fake/set', { issuer, changes })).json(),
    clock: async offset => (await post('/__fake/clock', { offset })).json(),
  };
}
