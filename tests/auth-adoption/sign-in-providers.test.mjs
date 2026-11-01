import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { database, load } from '../operator-readiness/runtime.mjs';
import { openSnapshotCacheRuntime } from '../e2e/snapshot-cache-runtime.mjs';
import { authFixture, secret, setupToken } from './runtime.mjs';
import { network, provider } from '../fixtures/base/oidc-idp.mjs';

// Real Lamp Hono routes, Base's OIDC flow and D1 batches; only the providers' network is substituted.
const origin = 'https://app.example.test';
const google = 'https://accounts.google.com';
const okta = 'https://synthetic-lamp-okta.example.com';
const baseEnv = (storage, cache, extra = {}) => ({ DB: storage.db, SNAPSHOT_CACHE: cache.namespace, SNAPSHOTS: storage.bucket,
  LAMP_APP_HOST: 'app.example.test', LAMP_PAGE_HOST: 'page.example.test', AUTH_ORIGIN: origin, SETUP_OPERATOR_EMAIL: 'owner@example.com',
  SESSION_SECRET: secret, SETUP_TOKEN: setupToken, MAIL_FROM_ADDRESS: 'lamp@example.com', WEBHOOK_SIGNING_SECRET: 'synthetic-lamp-3', ...extra });

/** Every response the test reads is kept, so the secret can be searched for in all of them. */
function client(app, env, transcript) {
  return async function call(path, { method = 'GET', json, form, cookie, html = false } = {}) {
    const headers = { Host: new URL(origin).host, Origin: origin, 'CF-Connecting-IP': '192.0.2.41' };
    let body;
    if (cookie) headers.Cookie = cookie;
    if (html) headers.Accept = 'text/html';
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const response = await app.fetch(new Request(origin + path, { method, headers, body }), env);
    transcript.push(`${response.status} ${JSON.stringify([...response.headers])} ${await response.clone().text()}`);
    return response;
  };
}
const cookiePair = response => response.headers.get('set-cookie').split(';')[0];
const sessionCookie = response => response.headers.getSetCookie().map(value => value.split(';')[0]).find(value => !value.includes('oa_oidc') && value.split('=')[1]);
const after = response => new URL(response.headers.get('location'), origin);

/** The real flow: the pane's Test sign-in form, the provider's authorization page, then the provider's redirect back. */
async function testSignIn(call, id, idp, claims, cookie, { cancel = false } = {}) {
  const start = await call(`/auth/oidc/${id}/start`, { method: 'POST', form: { returnTo: `/app/settings?test=${id}#sign-in` }, cookie, html: true });
  if (!start.headers.get('location')?.startsWith('https://')) return { start };
  const binding = start.headers.getSetCookie()[0].split(';')[0];
  const location = start.headers.get('location');
  const params = cancel ? { error: 'access_denied', state: new URL(location).searchParams.get('state') } : await idp.authorize(location, claims);
  return { start, callback: await call(`/auth/oidc/${id}/callback?${new URLSearchParams(params)}`, { cookie: `${cookie}; ${binding}`, html: true }) };
}
const result = response => { const url = after(response); return { test: url.searchParams.get('test'), result: url.searchParams.get('result'), path: url.pathname, hash: url.hash }; };

async function people(native, ownerCookie, db, list) {
  const made = {};
  for (const [name, role, accept] of list) {
    const email = `${name}@example.com`;
    await native.auth.invite(native.request('/auth/invite', { method: 'POST', cookie: ownerCookie }), { email, displayName: name, role });
    made[name] = { id: (await db.prepare('SELECT id FROM oa_operators WHERE email=?').bind(email).first()).id };
    if (accept) {
      const token = new URL(native.messages.at(-1).text.match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');
      made[name].cookie = cookiePair(await native.handle(native.request('/auth/confirm', { method: 'POST', body: { token } })));
    }
  }
  return made;
}

test('ACCESS-002 the owner sets up Google in Settings, tests the real flow, replaces and disconnects it, and the secret is write-only', async () => {
  const dir = await mkdtemp(join(process.cwd(), '.lamp-sign-in-'));
  const storage = await database(dir), cache = await openSnapshotCacheRuntime(dir);
  const originalFetch = globalThis.fetch, logs = [], transcript = [];
  const consoleMethods = ['log', 'info', 'warn', 'error'].map(name => [name, console[name]]);
  for (const [name] of consoleMethods) console[name] = (...args) => logs.push(args.map(String).join(' '));
  try {
    const { createApp } = await load('src/core/app/server.ts');
    const idp = await provider({ issuer: google, clientId: 'synthetic-lamp-1', clientSecret: 'synthetic-lamp-2', method: 'client_secret_basic', redirectUri: origin + '/auth/oidc/google/callback', claims: { email: 'owner@example.com', email_verified: true, hd: 'example.com' } });
    globalThis.fetch = network([idp]);
    const env = baseEnv(storage, cache);
    const { app } = createApp(env);
    const call = client(app, env, transcript);
    const native = authFixture(storage.db, { origin, owner: 'owner@example.com' });
    const stale = cookiePair(await native.handle(native.request('/auth/bootstrap', { method: 'POST', body: { token: setupToken, displayName: 'Owner' } })));
    const owner = await native.signIn();
    const others = await people(native, owner, storage.db, [['admin', 'admin', true], ['second', 'owner', true]]);
    const rows = async () => (await storage.db.prepare('SELECT COUNT(*) n FROM sign_in_providers').first()).n;
    const status = async cookie => (await call('/api/app/sign-in', { cookie })).json();
    const put = (cookie, json) => call('/api/app/sign-in/google', { method: 'PUT', json, cookie });
    const entry = { clientId: 'synthetic-lamp-1', clientSecret: 'synthetic-lamp-2' };

    // R4: only the current owner, freshly confirmed, changes sign-in. Nothing is written otherwise.
    const first = await status(owner);
    assert.deepEqual([first.canEdit, first.confirmed, first.signInEnabled, first.unavailable], [true, true, false, null]);
    assert.deepEqual(first.providers.map(row => [row.id, row.source, row.status]), [['google', 'none', 'not-set-up'], ['okta', 'none', 'not-set-up']]);
    assert.equal(first.providers[0].redirectUri, origin + '/auth/oidc/google/callback');
    assert.equal((await status(others.admin.cookie)).canEdit, false, 'an admin reads but cannot change');
    for (const [name, cookie, error] of [['admin', others.admin.cookie, 'owner_required'], ['another owner', others.second.cookie, 'owner_required'], ['stale owner', stale, 'step_up_required']]) {
      const refused = await put(cookie, entry);
      assert.deepEqual([refused.status, (await refused.json()).error], [403, error], name);
    }
    assert.equal((await call('/api/app/sign-in/google', { method: 'DELETE', cookie: others.admin.cookie })).status, 403);
    assert.equal(await rows(), 0, 'a refused change writes nothing');
    assert.equal((await put(owner, { clientId: 'synthetic-lamp-1' })).status, 400, 'a first save needs the secret');

    // R1, R5: Save is live on the next request, and "saved" is not "working".
    const saved = await put(owner, entry);
    assert.equal(saved.status, 200, await saved.clone().text());
    const afterSave = (await saved.json()).providers[0];
    assert.deepEqual([afterSave.source, afterSave.status, afterSave.secretSaved, afterSave.clientId], ['app', 'not-tested', true, 'synthetic-lamp-1']);
    const stored = await storage.db.prepare('SELECT sealed_secret FROM sign_in_providers').first();
    assert.ok(stored.sealed_secret.startsWith('v1.') && !stored.sealed_secret.includes('synthetic-lamp-2'), 'only sealed ciphertext is stored');
    assert.equal(await (await call('/signin')).text().then(page => page.includes('/auth/oidc/google/start')), false, 'switch off: no Google');
    assert.equal((await call('/auth/settings/identity', { method: 'POST', json: { idpSignIn: true }, cookie: owner })).status, 200);
    assert.ok((await (await call('/signin')).text()).includes('/auth/oidc/google/start'), 'switch on: /signin offers Google on the next request');

    // R6: Test sign-in returns to the pane with one plain result for each outcome.
    let flow = await testSignIn(call, 'google', idp, {}, owner);
    assert.deepEqual(result(flow.callback), { test: 'google', result: null, path: '/app/settings', hash: '#sign-in' });
    const provided = sessionCookie(flow.callback);
    assert.equal((await call('/api/app/session', { cookie: provided })).status, 200);
    assert.equal((await status(owner)).providers[0].status, 'working');
    flow = await testSignIn(call, 'google', idp, { sub: 'synthetic-lamp-stranger', email: 'stranger@example.com', hd: 'example.com' }, owner);
    assert.deepEqual(result(flow.callback), { test: 'google', result: 'oidc_admission_denied', path: '/app/settings', hash: '#sign-in' });
    assert.equal((await status(owner)).providers[0].status, 'working', 'an uninvited account still proves the credentials');
    idp.options.clientSecret = 'synthetic-lamp-wrong';
    flow = await testSignIn(call, 'google', idp, {}, owner);
    assert.equal(result(flow.callback).result, 'oidc_provider_unavailable');
    assert.notEqual((await status(owner)).providers[0].status, 'working', 'a refused exchange is not working');
    idp.options.clientSecret = 'synthetic-lamp-2';
    flow = await testSignIn(call, 'google', idp, {}, owner, { cancel: true });
    assert.equal(result(flow.callback).result, 'oidc_provider_denied');
    await testSignIn(call, 'google', idp, {}, owner);
    assert.equal((await status(owner)).providers[0].status, 'working');
    assert.equal((await call('/auth/settings/identity', { method: 'POST', json: { idpSignIn: false }, cookie: owner })).status, 200);
    flow = await testSignIn(call, 'google', idp, {}, owner);
    assert.deepEqual(result(flow.start), { test: 'google', result: 'oidc_sign_in_disabled', path: '/app/settings', hash: '#sign-in' });
    assert.equal((await call('/auth/settings/identity', { method: 'POST', json: { idpSignIn: true }, cookie: owner })).status, 200);

    // R7: Replace re-pins and signs the old provider sessions out; Disconnect ends the registration.
    const live = sessionCookie((await testSignIn(call, 'google', idp, {}, owner)).callback);
    assert.equal((await call('/api/app/session', { cookie: live })).status, 200);
    assert.equal((await put(owner, { clientId: 'synthetic-lamp-1' })).status, 200, 'unchanged values and no secret change nothing');
    assert.equal((await status(owner)).providers[0].status, 'working');
    idp.options.clientSecret = 'synthetic-lamp-4';
    const replaced = await put(owner, { clientId: 'synthetic-lamp-1', clientSecret: 'synthetic-lamp-4' });
    assert.equal((await replaced.json()).providers[0].status, 'not-tested', 'Replace goes back to not tested');
    assert.equal((await call('/api/app/session', { cookie: live })).status, 401, 'the old provider session is signed out');
    assert.equal((await call('/api/app/session', { cookie: owner })).status, 200, 'email sessions stay');
    const again = sessionCookie((await testSignIn(call, 'google', idp, {}, owner)).callback);
    assert.equal((await status(owner)).providers[0].status, 'working');
    assert.equal((await call('/auth/domain-rules', { method: 'POST', json: { domain: 'rules.example.org', provider: 'google' }, cookie: owner })).status, 200);
    assert.ok((await (await call('/auth/domain-rules', { cookie: owner })).text()).includes('rules.example.org'));
    const refusedByAdmin = await call('/api/app/sign-in/google', { method: 'DELETE', cookie: others.admin.cookie });
    assert.equal(refusedByAdmin.status, 403);
    assert.equal((await call('/api/app/sign-in/google', { method: 'DELETE', cookie: owner })).status, 200);
    assert.equal((await call('/api/app/session', { cookie: again })).status, 401, 'a disconnected provider signs its people out');
    assert.equal((await call('/api/app/session', { cookie: owner })).status, 200);
    assert.equal((await (await call('/signin')).text()).includes('/auth/oidc/google/start'), false, '/signin stops offering the provider');
    assert.equal(await rows(), 0);
    assert.equal((await storage.db.prepare('SELECT COUNT(*) n FROM sign_in_people').first()).n, 0);
    assert.equal((await (await call('/auth/domain-rules', { cookie: owner })).text()).includes('rules.example.org'), false, 'a rule naming the provider is lifted');
    const audit = (await storage.db.prepare("SELECT action,operator_id,payload_json FROM audit_entries WHERE entity_type='sign-in' ORDER BY created_at,id").all()).results;
    assert.deepEqual(audit.map(row => row.action), ['saved', 'saved', 'disconnected']);
    assert.ok(audit.every(row => row.payload_json === '{}' && row.operator_id));

    // R3: the secret appears in no response, page, error, log or audit row.
    for (const value of ['synthetic-lamp-2', 'synthetic-lamp-4', 'synthetic-lamp-wrong']) {
      assert.equal(transcript.some(line => line.includes(value)), false, 'responses');
      assert.equal(logs.some(line => line.includes(value)), false, 'logs');
      assert.equal(JSON.stringify(audit).includes(value), false, 'audit');
    }
  } finally {
    for (const [name, method] of consoleMethods) console[name] = method;
    globalThis.fetch = originalFetch;
    await cache.dispose?.(); await storage.runtime.dispose(); await rm(dir, { recursive: true, force: true });
  }
});

test('ACCESS-002 TEAM-003 Okta signs in only the people paired in Settings, and a deploy entry, an unusable row and Managed hosting keep their boundaries', async () => {
  const dir = await mkdtemp(join(process.cwd(), '.lamp-sign-in-'));
  const storage = await database(dir), cache = await openSnapshotCacheRuntime(dir);
  const originalFetch = globalThis.fetch, transcript = [], mail = [];
  try {
    const { createApp } = await load('src/core/app/server.ts');
    const idp = await provider({ issuer: okta, clientId: 'synthetic-lamp-5', clientSecret: 'synthetic-lamp-6', method: 'client_secret_basic', redirectUri: origin + '/auth/oidc/okta/callback', claims: { sub: 'synthetic-lamp-subject-1' } });
    const deployed = await provider({ issuer: google, clientId: 'synthetic-lamp-8', clientSecret: 'synthetic-lamp-9', method: 'client_secret_basic', redirectUri: origin + '/auth/oidc/google/callback', claims: { email: 'owner@example.com', email_verified: true, hd: 'example.com' } });
    const edge = network([idp, deployed]);
    globalThis.fetch = async (uri, init) => {
      const target = uri instanceof Request ? uri.url : String(uri);
      if (!target.startsWith('https://api.resend.com/')) return edge(target, init);
      mail.push(target);
      return Response.json({ id: 'synthetic-lamp-mail' });
    };
    const env = baseEnv(storage, cache, { MAIL_PROVIDER_API_KEY: 'synthetic-lamp-7' });
    const { app } = createApp(env);
    const call = client(app, env, transcript);
    const native = authFixture(storage.db, { origin, owner: 'owner@example.com' });
    await native.handle(native.request('/auth/bootstrap', { method: 'POST', body: { token: setupToken, displayName: 'Owner' } }));
    const owner = await native.signIn();
    const team = await people(native, owner, storage.db, [['first', 'member', true], ['second', 'member', false]]);
    const status = async () => (await (await call('/api/app/sign-in', { cookie: owner })).json()).providers.find(row => row.id === 'okta');
    const count = async table => (await storage.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n;
    const putOkta = json => call('/api/app/sign-in/okta', { method: 'PUT', json, cookie: owner });
    const registration = { clientId: 'synthetic-lamp-5', clientSecret: 'synthetic-lamp-6', people: [{ operatorId: team.first.id, subject: 'synthetic-lamp-subject-1' }] };

    // R6: an Okta domain that does not resolve is refused at Save and nothing is stored.
    const unreachable = await putOkta({ ...registration, domain: 'synthetic-lamp-1.invalid' });
    assert.deepEqual([unreachable.status, (await unreachable.json()).error], [502, 'provider_unreachable']);
    assert.deepEqual([await count('sign_in_providers'), await count('sign_in_people')], [0, 0]);
    assert.equal((await putOkta({ ...registration, domain: 'http://synthetic-lamp-okta.example.com' })).status, 400, 'only https');
    assert.equal((await putOkta({ ...registration, domain: '' })).status, 400);

    // R2: paired people only; pairings are unique and follow the person.
    const duplicate = await putOkta({ ...registration, domain: 'synthetic-lamp-okta.example.com', people: [...registration.people, { operatorId: team.second.id, subject: 'synthetic-lamp-subject-1' }] });
    assert.deepEqual([duplicate.status, (await duplicate.json()).error], [400, 'duplicate_person']);
    assert.equal((await putOkta({ ...registration, domain: 'synthetic-lamp-okta.example.com', people: [...registration.people, { operatorId: team.first.id, subject: 'synthetic-lamp-subject-2' }] })).status, 400, 'one pairing per person');
    assert.equal(await count('sign_in_providers'), 0);
    const saved = await putOkta({ ...registration, domain: 'https://synthetic-lamp-okta.example.com/' });
    assert.equal(saved.status, 200, await saved.clone().text());
    const row = await status();
    assert.deepEqual([row.source, row.status, row.domain, row.people.length], ['app', 'not-tested', 'synthetic-lamp-okta.example.com', 1]);
    assert.equal((await call('/auth/settings/identity', { method: 'POST', json: { idpSignIn: true }, cookie: owner })).status, 200);
    let flow = await testSignIn(call, 'okta', idp, {}, owner);
    assert.equal((await (await call('/api/app/session', { cookie: sessionCookie(flow.callback) })).json()).operator.email, 'first@example.com', 'a paired subject signs in as its person');
    assert.equal((await status()).status, 'working');
    flow = await testSignIn(call, 'okta', idp, { sub: 'synthetic-lamp-subject-2' }, owner);
    assert.equal(result(flow.callback).result, 'oidc_admission_denied', 'an unpaired subject is refused');
    assert.equal((await status()).status, 'working');
    const changed = await call('/api/app/sign-in/okta/people', { method: 'PUT', json: { people: [...registration.people, { operatorId: team.second.id, subject: 'synthetic-lamp-subject-3' }] }, cookie: owner });
    assert.equal(changed.status, 200, await changed.clone().text());
    assert.equal((await status()).people.length, 2);
    // A pairing follows the person's current email and ends with their erasure.
    assert.equal((await call(`/api/app/operators/${team.first.id}`, { method: 'DELETE', cookie: owner })).status, 204);
    assert.equal((await storage.db.prepare('SELECT COUNT(*) n FROM sign_in_people WHERE operator_id=?').bind(team.first.id).first()).n, 0, 'erasure deletes the pairing in its batch');
    flow = await testSignIn(call, 'okta', idp, {}, owner);
    assert.equal(result(flow.callback).result, 'oidc_admission_denied', 'an erased person cannot sign in');
    assert.deepEqual((await status()).people.map(person => person.subject), ['synthetic-lamp-subject-3']);

    // R8: a deploy-file entry wins, its row says so, Save is refused, and its own sign-in still works.
    const deployEnv = { ...env, AUTH_PROVIDERS: JSON.stringify([{ id: 'google', preset: 'google', clientId: 'synthetic-lamp-8', tokenAuthMethod: 'client_secret_basic', clientSecret: 'synthetic-lamp-9' }]) };
    const withDeploy = createApp(deployEnv);
    const deployCall = client(withDeploy.app, deployEnv, transcript);
    const view = await (await deployCall('/api/app/sign-in', { cookie: owner })).json();
    assert.deepEqual(view.providers.map(provider => [provider.id, provider.source]), [['google', 'deploy'], ['okta', 'app']]);
    const refused = await deployCall('/api/app/sign-in/google', { method: 'PUT', json: { clientId: 'synthetic-lamp-1', clientSecret: 'synthetic-lamp-2' }, cookie: owner });
    assert.deepEqual([refused.status, (await refused.json()).error], [409, 'deploy_configured']);
    assert.equal((await deployCall('/api/app/sign-in/google', { method: 'DELETE', cookie: owner })).status, 409);
    assert.equal(await count('sign_in_providers'), 1);
    assert.equal((await deployCall('/auth/providers/relink', { method: 'POST', json: { provider: 'google' }, cookie: owner })).status, 200);
    flow = await testSignIn(deployCall, 'google', deployed, {}, owner);
    assert.equal(result(flow.callback).result, null);
    assert.equal((await (await deployCall('/api/app/sign-in', { cookie: owner })).json()).providers[0].status, 'working');

    // R3, R8: a ciphertext the current key cannot open is skipped, so /signin and email links never fail.
    const rotatedEnv = { ...env, WEBHOOK_SIGNING_SECRET: 'synthetic-lamp-10' };
    const rotated = createApp(rotatedEnv);
    const rotatedCall = client(rotated.app, rotatedEnv, transcript);
    assert.equal((await rotatedCall('/signin', { html: true })).status, 200);
    const link = await rotatedCall('/auth/magic-link', { method: 'POST', json: { email: 'owner@example.com' } });
    assert.ok(link.status < 300, await link.clone().text());
    assert.equal(mail.length, 1, 'the email sign-in link was sent');
    const rotatedView = (await (await rotatedCall('/api/app/sign-in', { cookie: owner })).json()).providers.find(provider => provider.id === 'okta');
    assert.deepEqual([rotatedView.status, rotatedView.secretSaved], ['needs-secret', false]);
    assert.equal((await (await rotatedCall('/signin')).text()).includes('/auth/oidc/okta/start'), false, 'a row without a usable secret is not offered');
    const needSecret = await rotatedCall('/api/app/sign-in/okta', { method: 'PUT', json: { domain: 'synthetic-lamp-okta.example.com', clientId: 'synthetic-lamp-5', people: [] }, cookie: owner });
    assert.deepEqual([needSecret.status, (await needSecret.json()).error], [400, 'client_secret_required']);

    // R8: Managed hosting has no outbound connection; Save is refused and nothing is stored.
    const managedStorage = await database(await mkdtemp(join(process.cwd(), '.lamp-sign-in-')));
    try {
      const managedEnv = baseEnv(managedStorage, cache, { MAIL_PROVIDER: 'rer', MAIL_FROM: 'lamp@example.com', MAIL_RELAY_URL: 'https://relay.example.test/api/managed-mail/send', MAIL_API_KEY: 'synthetic-lamp-11' });
      const managed = createApp(managedEnv);
      const managedCall = client(managed.app, managedEnv, transcript);
      const managedNative = authFixture(managedStorage.db, { origin, owner: 'owner@example.com' });
      await managedNative.handle(managedNative.request('/auth/bootstrap', { method: 'POST', body: { token: setupToken, displayName: 'Owner' } }));
      const managedOwner = await managedNative.signIn();
      const managedView = await (await managedCall('/api/app/sign-in', { cookie: managedOwner })).json();
      assert.ok(managedView.unavailable); assert.equal(managedView.confirmed, false);
      const blocked = await managedCall('/api/app/sign-in/google', { method: 'PUT', json: { clientId: 'synthetic-lamp-1', clientSecret: 'synthetic-lamp-2' }, cookie: managedOwner });
      assert.deepEqual([blocked.status, (await blocked.json()).error], [409, 'outbound_unavailable']);
      assert.equal((await managedStorage.db.prepare('SELECT COUNT(*) n FROM sign_in_providers').first()).n, 0);
    } finally { await managedStorage.runtime.dispose(); }
    for (const value of ['synthetic-lamp-6', 'synthetic-lamp-9']) assert.equal(transcript.some(line => line.includes(value)), false, 'no response carries a client secret');
  } finally {
    globalThis.fetch = originalFetch;
    await cache.dispose?.(); await storage.runtime.dispose(); await rm(dir, { recursive: true, force: true });
  }
});
