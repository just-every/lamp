import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, authProvider, sessionCookie } from './runtime.mjs';
async function fixture(t, entries, core) { const r = await runtime(entries, core); t.after(() => r.close()); return r; }

test('inactive membership, reactivation fences and revoke use the core store', async t => {
  const r = await fixture(t, [authProvider({}, { claims: { email: 'member@example.com' } })]); const owner = await r.bootstrap();
  r.sqlite.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) VALUES('member','member@example.com','Member','member','active',1,?)").run(Date.now());
  const ownerRequest = r.request('/auth/operator/status', { method: 'POST', cookie: owner.cookie.split(';')[0] });
  const ok = await r.finish(await r.flow()); assert.equal(ok.status, 303);
  const sessionRequest = r.request('/auth/session', { cookie: sessionCookie(ok) });
  const session = await r.auth.getSession(sessionRequest); assert.equal(session.operator.id, 'member');
  await r.auth.setOperatorStatus(ownerRequest, 'member', 'inactive');
  assert.equal(await r.auth.getSession(sessionRequest), null);
  assert.equal((await r.finish(await r.flow())).status, 403);
  await r.auth.setOperatorStatus(ownerRequest, 'member', 'active');
  assert.equal(await r.auth.getSession(sessionRequest), null);
  const fresh = await r.finish(await r.flow());
  const freshSession = await r.auth.getSession(r.request('/auth/session', { cookie: sessionCookie(fresh) }));
  await r.auth.revokeSession(ownerRequest, freshSession.id);
  assert.equal(await r.auth.getSession(r.request('/auth/session', { cookie: sessionCookie(fresh) })), null);
});

test('issuer/subject binding cannot migrate to a different admitted email', async t => {
  const r = await fixture(t); await r.bootstrap(); assert.equal((await r.finish(await r.flow())).status, 303);
  r.sqlite.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) VALUES('member','member@example.com','Member','member','active',1,?)").run(Date.now());
  r.provider.options.claims = { ...r.provider.options.claims, email: 'member@example.com' };
  assert.equal((await r.finish(await r.flow())).status, 403);
});

test('code exchange failure consumes once; provider error descriptions are never reflected', async t => {
  const r = await fixture(t); await r.bootstrap();
  const failed = await r.flow(); await r.provider.grants.take(failed.code);
  assert.equal((await r.finish(failed)).status, 400);
  assert.equal((await r.finish(failed)).status, 400);
  const declined = await r.flow();
  const response = await r.finish({ ...declined, path: `/auth/oidc/auth/callback?state=${declined.state}&error=access_denied&error_description=private-idp-message&error_uri=https://evil.example` });
  assert.equal(response.status, 401); assert.equal(await response.text(), '{"error":"oidc_provider_denied"}'); assert.equal(response.headers.get('location'), null);
});

test('slow body and redirecting token exchange are bounded and fail closed', async t => {
  for (const behavior of ['body', 'redirect']) {
    const transport = async uri => uri.endsWith('/token') ? behavior === 'redirect' ? Response.redirect('https://evil.example', 307) : new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } }) : null;
    const r = await fixture(t, [authProvider({}, { transport })], { identityTimeoutMs: 100 });
    await r.bootstrap(); const f = await r.flow(); const start = Date.now();
    const response = await r.finish(f); assert.equal(response.status, 502); assert.ok(Date.now() - start < 2000);
    assert.equal((await r.finish(f)).status, 400);
  }
});
