import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { database, load } from '../operator-readiness/runtime.mjs';
import { openSnapshotCacheRuntime } from '../e2e/snapshot-cache-runtime.mjs';
import { authFixture, secret, setupToken } from './runtime.mjs';
import { provider } from '../fixtures/base/oidc-idp.mjs';
import { linkEdge } from '../fixtures/base/provider-edge.mjs';

// Real Lamp Hono routes and D1 transactions; only the external provider's network
// is substituted. The copied Base edge validates signed client assertions.
test('ACCESS-001 dependency linking keeps exact owner approval through setup, unlink and concurrent replacement', async () => {
  const dir = await mkdtemp(join(process.cwd(), '.lamp-dependency-'));
  const storage = await database(dir);
  const cache = await openSnapshotCacheRuntime(dir);
  const originalFetch = globalThis.fetch;
  try {
    const { createApp } = await load('src/core/app/server.ts');
    const origin = 'https://app.example.test', issuer = 'https://identity.example.test';
    const idp = await provider({ issuer, clientId: 'lamp-client', redirectUri: origin + '/auth/oidc/auth/callback', alg: 'ES256', method: 'private_key_jwt', rerInterfaces: ['oidc-provider@1.0.0'], claims: { email: 'owner@example.test' } });
    await storage.db.prepare('CREATE TABLE fixture_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)').run();
    const edge = linkEdge(storage.db, issuer, 'lamp-client', Date.now);
    globalThis.fetch = async (uri, init) => await edge.fetch(String(uri), init) ?? idp.fetch(uri, init);
    const env = { DB: storage.db, SNAPSHOT_CACHE: cache.namespace, SNAPSHOTS: storage.bucket,
      LAMP_APP_HOST: 'app.example.test', LAMP_PAGE_HOST: 'page.example.test', AUTH_ORIGIN: origin,
      SETUP_OPERATOR_EMAIL: 'owner@example.test', SESSION_SECRET: secret, SETUP_TOKEN: setupToken,
      MAIL_FROM_ADDRESS: 'lamp@example.test', IDENTITY_PROVIDER: issuer };
    const native = authFixture(storage.db, { origin });
    const { app } = createApp(env);
    const call = (path, options = {}) => {
      const request = native.request(path, options);
      request.headers.set('CF-Connecting-IP', '192.0.2.31');
      return app.fetch(request, env);
    };
    const post = (path, body = {}, cookie) => call(path, { method: 'POST', body, cookie });
    const discovery = await call('/.well-known/rer-dependencies');
    assert.equal(discovery.status, 200);
    assert.ok((await discovery.json()).dependencies.some(d => d.interface === 'oidc-provider@1' && d.optional));
    const callback = async () => {
      await call('/.well-known/rer-dependencies');
      return post('/.well-known/rer-link/callback', { issuer, code: await edge.code() });
    };
    assert.equal((await callback()).status, 403, 'configuration alone grants no link authority');
    assert.equal((await post('/auth/dependencies/setup', { issuer, token: setupToken })).status, 200);
    const bootstrap = await post('/auth/bootstrap', { token: setupToken, displayName: 'Owner' });
    assert.equal(bootstrap.status, 303);
    const bootstrapCookie = bootstrap.headers.get('set-cookie').split(';')[0];
    const bootstrapSession = await (await call('/auth/session', { cookie: bootstrapCookie })).json();
    const setup = await storage.db.prepare('SELECT owner_id,session_id FROM oa_setup_links').first();
    assert.equal(setup.owner_id, bootstrapSession.operator.id);
    assert.equal(setup.session_id, bootstrapSession.id);
    assert.equal((await callback()).status, 200, 'only the originating setup can complete its approval');
    assert.equal((await (await call('/auth/settings/identity', { cookie: bootstrapCookie })).json()).idpSignIn, true);
    assert.equal((await callback()).status, 403, 'a consumed approval cannot authorize another link');
    const proof = await native.signIn();
    assert.equal((await post('/auth/dependencies/unlink', {}, proof)).status, 200);
    assert.equal((await callback()).status, 403, 'provider continuity cannot restore unlinked trust');
    assert.equal((await post('/auth/oidc/auth/start')).status, 403);
    assert.equal((await post('/auth/settings/identity', { idpSignIn: false }, proof)).status, 200);
    const approve = () => post('/auth/dependencies/relink', { issuer }, proof);
    assert.equal((await approve()).status, 200);
    await edge.pause();
    const pending = callback();
    try {
      await edge.ready();
      assert.equal((await approve()).status, 200, 'owner replaces the pending approval while redemption waits');
    } finally { await edge.release(); }
    assert.equal((await pending).status, 503, 'stale callback fails its atomic exact-attempt fence');
    assert.equal((await storage.db.prepare('SELECT COUNT(*) n FROM rer_dependency_link').first()).n, 0);
    assert.equal((await callback()).status, 200, 'the new owner approval remains usable');
    assert.equal((await (await call('/auth/settings/identity', { cookie: proof })).json()).idpSignIn, false, 'ordinary relinking preserves the owner choice to disable sign-in');
    const disabledPage = await call('/signin');
    assert.equal((await disabledPage.text()).includes('action="/auth/oidc/auth/start"'), false);
    assert.equal((await post('/auth/settings/identity', { idpSignIn: true }, proof)).status, 200);
    const signIn = await call('/signin?returnTo=%2Fapp%2Fsettings');
    assert.equal(signIn.status, 200);
    assert.equal(signIn.headers.get('referrer-policy'), 'strict-origin');
    assert.ok(signIn.headers.get('content-security-policy').includes(issuer));
    const html = await signIn.text();
    const providerForm = /<form method="post" action="([^"]*\/auth\/oidc\/auth\/start)">([\s\S]*?)<\/form>/.exec(html);
    assert.ok(providerForm, 'hosted sign-in exposes the enabled provider start form');
    const returnTo = /name="returnTo" value="([^"]+)"/.exec(providerForm[2])[1];
    assert.equal(returnTo, '/app/settings');
    const start = await app.fetch(new Request(new URL(providerForm[1], origin), {
      method: 'POST', headers: { Host: new URL(origin).host, Origin: origin, 'CF-Connecting-IP': '192.0.2.31', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ returnTo }),
    }), env);
    assert.equal(start.status, 303, 'the form offered by hosted sign-in starts provider authorization');
    assert.equal(new URL(start.headers.get('location')).origin, issuer);
    assert.equal((await call('/api/app/session', { cookie: proof })).status, 200, 'native email access remains usable');
  } finally {
    globalThis.fetch = originalFetch;
    await cache.dispose();
    await storage.runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
