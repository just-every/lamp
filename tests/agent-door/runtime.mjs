import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { database, load } from '../operator-readiness/runtime.mjs';
import { authFixture, secret, setupToken } from '../auth-adoption/runtime.mjs';

const adapter = load('tests/auth-adoption/adapter.ts');
export const linkToken = message => new URL(message.text.match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');

/** Real native accounts and sessions for the adopted agent-door assertions.
 * Only mail delivery is captured; no fixture SQL creates person authority. */
export async function lampRuntime(t) {
  const dir = await mkdtemp(join(process.cwd(), '.lamp-agent-identity-'));
  const { runtime, db, bucket } = await database(dir);
  t.after(async () => { await runtime.dispose(); await rm(dir, { recursive: true, force: true }); });
  const origin = 'https://app.example.test';
  const base = authFixture(db, { origin });
  const modules = await adapter;
  const messages = [];
  const bindings = { DB: db, LAMP_APP_HOST: new URL(origin).host, AUTH_ORIGIN: origin,
    AUTH_LOCAL: 'false', SETUP_OPERATOR_EMAIL: 'owner@example.test', SESSION_SECRET: secret,
    SETUP_TOKEN: setupToken, MAIL_FROM_ADDRESS: 'lamp@example.test', RER_DEV_KEY: 'test-only-local-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  const auth = modules.createLampAuth(bindings, { configured: true, async send(message) { messages.push(message); } });
  const authHandle = modules.createAuthHandler(auth);
  const app = new Hono();
  app.use('/api/app/*', modules.requireOperator(() => auth));
  modules.registerOperatorRoutes(app, () => auth, 'page.example.test');
  const request = (path, options = {}) => {
    const req = base.request(path, options);
    req.headers.set('CF-Connecting-IP', '192.0.2.10');
    for (const [name, value] of Object.entries(options.headers ?? {})) req.headers.set(name, value);
    return req;
  };
  const call = (path, options = {}) => app.fetch(request(path, options), bindings);
  const bootstrap = await base.handle(request('/auth/bootstrap', { method: 'POST', body: { token: setupToken, displayName: 'Owner' } }));
  assert.equal(bootstrap.status, 303);
  const cookie = await base.signIn();
  const owner = (await (await call('/api/app/session', { cookie })).json()).operator;
  async function invite(email, accept = false) {
    assert.equal((await call('/api/app/operators/invite', { method: 'POST', cookie, body: { email, displayName: 'Invited Person' } })).status, 202);
    const token = linkToken(messages.at(-1));
    const target = await db.prepare('SELECT id FROM oa_operators WHERE email=?').bind(email).first();
    if (!accept) return { id: target.id, token };
    const accepted = await base.handle(request('/auth/confirm', { method: 'POST', body: { token } }));
    assert.equal(accepted.status, 303);
    return { id: target.id, token, cookie: accepted.headers.get('set-cookie').split(';')[0] };
  }
  return { db, bucket, bindings, auth, authHandle, request, cookie, owner, messages, invite };
}
