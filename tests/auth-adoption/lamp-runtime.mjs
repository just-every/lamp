import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { database, load } from '../operator-readiness/runtime.mjs';
import { authFixture, secret, setupToken } from './runtime.mjs';

const adapter = load('tests/auth-adoption/adapter.ts');
export const linkToken = message => new URL(message.text.match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');
export async function lampRuntime(t, { local = false, ownerClaim = false, registerRoutes } = {}) {
  const dir = await mkdtemp(join(process.cwd(), '.lamp-auth-correctness-'));
  const { runtime, db } = await database(dir);
  t.after(async () => { await runtime.dispose(); await rm(dir, { recursive: true, force: true }); });
  const origin = local ? 'http://127.0.0.1:8912' : 'https://app.example.test';
  const base = authFixture(db, { origin });
  const modules = await adapter;
  const messages = [];
  const bindings = { DB: db, LAMP_APP_HOST: new URL(origin).host, AUTH_ORIGIN: origin, AUTH_LOCAL: String(local), SETUP_OPERATOR_EMAIL: 'owner@example.test', SESSION_SECRET: secret, SETUP_TOKEN: setupToken, MAIL_FROM_ADDRESS: 'lamp@example.test', RER_DEV_KEY: 'test-only-local-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  const auth = modules.createLampAuth(bindings, { configured: true, async send(message) { messages.push(message); } });
  const authHandle = modules.createAuthHandler(auth);
  const app = new Hono();
  app.use('/api/app/*', modules.requireOperator(() => auth));
  modules.registerOperatorRoutes(app, () => auth, 'page.example.test');
  // Mail and publication are the external effect boundaries. Routes, services,
  // identity authority and every import/erasure statement use real D1.
  let publications = 0;
  const subscribers = modules.createSubscribersService(modules.createSubscriberRepository(db), {
    mail: { configured: true, async send(message) { messages.push(message); return { providerMessageId: `captured-${messages.length}` }; } },
    fromAddress: 'lamp@example.test', tokenSecret: secret,
  });
  modules.registerStatuspageImportRoutes(app, modules.createStatuspageImportService(db, { inviteSubscriber: (id, authority) => subscribers.inviteImported(id, 'https://page.example.test', 'Test page', authority), async publicDataChanged() { publications++; } }));
  await registerRoutes?.({ app, db, modules });
  const request = (path, options = {}) => {
    const req = base.request(path, options);
    req.headers.set('CF-Connecting-IP', '192.0.2.10');
    return req;
  };
  const call = (path, options = {}) => app.fetch(request(path, options), bindings);
  if (ownerClaim) {
    // A consumed claim fixture is inserted before the store is initialized, as
    // required by Base's empty-store trigger. Its opaque IDs are attached below.
    await db.prepare("INSERT INTO oc_owner_claims(singleton,jti,installation_id,email,issued_at,expires_at,consumed_at,operator_id,session_id,completed) VALUES(1,'consumed-claim','fixture-installation','owner@example.test',1,10,2,'claim-actor','claim-session',1)").run();
    await db.prepare("INSERT INTO oc_idp_grants(issuer,client_id,jti,subject,sector_id) VALUES('https://idp.example.test','lamp-client','consumed-claim','personal-owner-subject','fixture-installation'),('https://other.example.test','other-client','consumed-claim','other-subject','other-installation')").run();
  }
  const bootstrap = await base.handle(request('/auth/bootstrap', { method: 'POST', body: { token: setupToken, displayName: 'Owner' } }));
  assert.equal(bootstrap.status, 303);
  const cookie = await base.signIn();
  const owner = (await (await call('/api/app/session', { cookie })).json()).operator;
  if (ownerClaim) await db.batch([
    db.prepare('UPDATE oc_owner_claims SET operator_id=?,session_id=(SELECT id FROM oa_sessions WHERE operator_id=? LIMIT 1)').bind(owner.id, owner.id),
    db.prepare("UPDATE oc_idp_grants SET subject=? WHERE issuer='https://idp.example.test'").bind(`provider-person-${owner.id}`),
    db.prepare("INSERT INTO oa_external_identities(issuer,subject,operator_id) VALUES('https://idp.example.test',?,?)").bind(`provider-person-${owner.id}`, owner.id),
  ]);
  async function invite(email, accept = false) {
    assert.equal((await call('/api/app/operators/invite', { method: 'POST', cookie, body: { email, displayName: 'Invited Person' } })).status, 202);
    const token = linkToken(messages.at(-1));
    const target = await db.prepare('SELECT id FROM oa_operators WHERE email=?').bind(email).first();
    if (!accept) return { id: target.id, token };
    const accepted = await base.handle(request('/auth/confirm', { method: 'POST', body: { token } }));
    assert.equal(accepted.status, 303);
    return { id: target.id, token, cookie: accepted.headers.get('set-cookie').split(';')[0] };
  }
  async function providerSession(id) {
    await db.prepare('UPDATE oa_auth_settings SET idp_sign_in=1').run();
    await db.prepare(`INSERT OR IGNORE INTO oa_identity_providers(provider_id,preset,status,issuer,client_id,jwks_uri,authorization_endpoint,token_endpoint,algorithms,token_auth_method,response_iss,linked_at)
      VALUES('auth','auth','linked','https://idp.example.test','lamp-client','https://idp.example.test/jwks','https://idp.example.test/authorize','https://idp.example.test/token','["ES256"]','private_key_jwt',1,1)`).run();
    const pin = await db.prepare('SELECT provider_id AS id,issuer,client_id AS clientId,linked_at AS linkedAt FROM oa_identity_providers').first();
    const person = await db.prepare('SELECT id,version FROM oa_operators WHERE id=?').bind(id).first();
    const generation = (await db.prepare('SELECT generation FROM oa_auth_settings').first()).generation;
    // The server-only admission boundary receives a verified provider principal.
    // Its pin/binding/session transaction is Base's real implementation.
    const issued = await base.auth.accounts.bindAndIssueSession({ person, principal: { issuer: 'https://idp.example.test', subject: `provider-person-${id}`, sid: `provider-session-${id}`, providerGeneration: generation, providerPin: pin }, returnTo: '/app' });
    assert.ok(issued);
    return issued.cookie.split(';')[0];
  }
  async function stepUp(actorCookie) {
    assert.equal((await base.handle(request('/auth/step-up', { method: 'POST', cookie: actorCookie, body: { action: 'delete', returnTo: '/app/settings' } }))).status, 202);
    const response = await base.handle(request('/auth/confirm', { method: 'POST', cookie: actorCookie, body: { token: linkToken(base.messages.at(-1)) } }));
    assert.equal(response.status, 303);
  }
  return { db, app, bindings, auth, authHandle, base, request, call, cookie, owner, messages, invite, providerSession, stepUp, modules, get publications() { return publications; } };
}

export const source = (name = 'imported', count = 1) => [{ name: 'components.json', text: JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: `${name}-${i}`, name: `${name} ${i}`, position: i, status: 'operational', created_at: '2026-01-01T00:00:00Z' }))) }];
export async function preview(r, cookie, files) {
  const response = await r.call('/api/app/statuspage-import/preview', { method: 'POST', cookie, body: { files } });
  assert.equal(response.status, 200);
  const { report } = await response.json();
  return { files, asOf: report.asOf, fingerprint: report.fingerprint, acknowledged: true };
}
export async function suspendedBody(r, path, cookie, body) {
  let release, reading;
  const paused = new Promise(resolve => { reading = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  const stream = new ReadableStream({ async pull(controller) { reading(); await released; controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close(); } }, { highWaterMark: 0 });
  const request = r.request(path, { method: 'POST', cookie });
  const response = r.app.fetch(new Request(request, { body: stream, duplex: 'half', headers: request.headers }), r.bindings);
  await Promise.race([paused, response.then(() => { throw new Error("Request finished before reading the streamed body"); })]);
  return { response, release };
}
