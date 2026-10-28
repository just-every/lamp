import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOidcHandler } from '../index.mjs';
import { runtime, authProvider, sessionCookie, clientKey, ORIGIN } from './runtime.mjs';

async function fixture(t, entries, core) {
  const r = await runtime(entries, core);
  t.after(() => r.close());
  return r;
}

// Health is an operational claim, independent of whether the accounts layer
// admits this particular person. Exercise both public provider views over SQL.
test('connection health survives rejected visitor codes but requires fresh proof after provider faults or relinking', async t => {
  const r = await fixture(t, undefined, { identityTimeoutMs: 100 });
  const owner = await r.bootstrap();
  const health = async expected => {
    assert.equal((await r.auth.providers.list())[0].linked, expected);
    const response = await r.call('/auth/providers', { cookie: owner.cookie.split(';')[0] });
    assert.equal(response.status, 200);
    const [link] = await response.json();
    assert.equal(link.healthy, expected);
    assert.equal(link.status, 'linked', 'operational health does not rewrite the admission pin');
  };
  const first = await r.flow();
  await health(false); // Discovery alone pins the registration, not a working exchange.
  assert.equal((await r.finish(first)).status, 303);
  await health(true);
  r.restart();
  await health(true);
  // An unauthenticated visitor needs only the public start and its own binding
  // cookie. Neither an invented code nor a code from an earlier sign-in is proof
  // that the provider is broken; neither callback may admit that visitor.
  const rejectCode = async code => {
    const start = await r.begin();
    assert.equal(start.status, 303);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const flow = { path: `/auth/oidc/auth/callback?code=${code}&state=${state}`, cookie: start.headers.get('set-cookie').split(';')[0] };
    const before = r.provider.requests.filter(x => x.uri.endsWith('/token')).length;
    const response = await r.finish(flow);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'oidc_invalid_response' });
    assert.equal(sessionCookie(response), undefined);
    assert.equal(r.provider.requests.filter(x => x.uri.endsWith('/token')).length, before + 1);
    await health(true);
    const replay = await r.finish(flow);
    assert.equal(replay.status, 400);
    assert.deepEqual(await replay.json(), { error: 'oidc_invalid_correlation' });
    assert.equal(sessionCookie(replay), undefined);
    assert.equal(r.provider.requests.filter(x => x.uri.endsWith('/token')).length, before + 1, 'consumed state never retries the exchange');
    await health(true);
  };
  await rejectCode('invented-code');
  await rejectCode(first.code);
  const grantError = { error: 'invalid_grant', error_description: 'private-provider-detail', error_uri: 'https://private.example' };
  r.provider.options.transport = async uri => uri.endsWith('/token') ? Response.json(grantError, { status: 400 }) : null;
  await rejectCode('another-invented-code'); // Only the sanitized error reaches the visitor.
  r.provider.options.transport = undefined;

  // Each genuine provider fault starts with a healthy connection. Discovery
  // cannot clear it; a new verified exchange does, including after restart.
  let cancelled = false;
  const streamError = oversized => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(oversized ? { ...grantError, padding: 'x'.repeat(65536) } : grantError))); },
    cancel() { cancelled = true; },
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  for (const [name, fault, status = 502, error = 'oidc_provider_unavailable'] of [
    ['invalid_client 401', { transport: async () => Response.json({ error: 'invalid_client' }, { status: 401 }) }],
    ['invalid_client 400', { transport: async () => Response.json({ error: 'invalid_client', error_description: 'private-client-detail' }, { status: 400 }) }],
    ['server failure even with invalid_grant body', { transport: async () => Response.json(grantError, { status: 503 }) }],
    ['network failure', { transport: async () => { throw new Error('private-network-detail'); } }],
    ['DNS failure', { transport: async () => { throw new Error('getaddrinfo ENOTFOUND private-host'); } }],
    ['invalid signature', { corruptSignature: true }, 400, 'oidc_invalid_response'],
    ['invalid JWKS', { header: { kid: 'unknown-key' }, jwks: [] }, 400, 'oidc_unknown_key'],
    ['oversized error body', { transport: async () => streamError(true) }],
    ['stalled error body', { transport: async () => streamError(false) }],
    ['wrong response URL', { transport: async () => {
      const response = Response.json(grantError, { status: 400 });
      Object.defineProperty(response, 'url', { value: 'https://another.example/token' });
      return response;
    } }],
    ['malformed error body', { transport: async () => new Response('{"error":"invalid_grant",', { status: 400, headers: { 'Content-Type': 'application/json' } }) }],
  ]) {
    cancelled = false;
    const flow = await r.flow();
    Object.assign(r.provider.options, fault, { transport: fault.transport && (async uri => uri.endsWith('/token') ? fault.transport() : null) });
    const response = await r.finish(flow);
    assert.equal(response.status, status, name);
    assert.deepEqual(await response.json(), { error }, name);
    assert.equal(sessionCookie(response), undefined, name);
    if (name === 'oversized error body' || name === 'stalled error body') assert.equal(cancelled, true, name);
    await health(false);
    if (name === 'invalid_client 401') {
      r.restart();
      assert.equal((await r.begin()).status, 303);
      await health(false);
    }
    Object.assign(r.provider.options, { transport: undefined, corruptSignature: false, header: undefined, jwks: undefined });
    const recovery = await r.flow();
    await health(false); // Successful discovery is not exchange proof.
    assert.equal((await r.finish(recovery)).status, 303, name);
    await health(true);
  }
  // A valid exchange remains proof even if application membership denies admission.
  assert.equal((await r.finish(await r.flow(undefined, 0, { sub: 'unknown', email: 'unknown@example.com' }))).status, 403);
  await health(true);
  await r.auth.providers.relink('auth');
  await health(false);
  r.restart();
  await health(false);
  assert.equal((await r.finish(await r.flow())).status, 303);
  await health(true);
});

test('discovery and JWKS probe recovery cannot establish or restore token exchange proof', async t => {
  const r = await fixture(t);
  await r.bootstrap();
  assert.equal((await r.finish(await r.flow())).status, 303);
  r.provider.options.transport = async uri => uri.endsWith('/token')
    ? Response.json({ error: 'invalid_client' }, { status: 401 }) : null;
  assert.equal((await r.finish(await r.flow())).status, 502);
  // An independent discovery failure schedules the ordinary background probe.
  r.provider.options.transport = async () => new Response('gone', { status: 404 });
  assert.equal((await r.begin()).status, 502);
  r.sqlite.prepare('UPDATE oa_identity_provider_health SET checked_at=0 WHERE provider_id=?').run('auth');
  r.provider.options.transport = undefined;
  await r.auth.providers.list();
  const recovered = (await r.auth.providers.list())[0];
  assert.equal(recovered.visible, true, 'reachability recovers and permits a new sign-in attempt');
  assert.equal(recovered.linked, false, 'discovery and JWKS cannot certify token exchange');
  assert.equal((await r.finish(await r.flow())).status, 303);
  assert.equal((await r.auth.providers.list())[0].linked, true);
});

test('a token response from a superseded pin never establishes health for its replacement', async t => {
  const r = await fixture(t);
  await r.bootstrap();
  const flow = await r.flow();
  r.provider.options.transport = async uri => {
    if (uri.endsWith('/token')) {
      r.provider.options.transport = undefined;
      await r.auth.providers.relink('auth');
    }
    return null;
  };
  assert.equal((await r.finish(flow)).status, 403, 'existing admission fence still denies the superseded pin');
  assert.equal((await r.auth.providers.list())[0].linked, false);
  assert.equal((await r.finish(await r.flow())).status, 303);
  assert.equal((await r.auth.providers.list())[0].linked, true);
  const stale = await r.flow();
  r.provider.options.transport = async uri => {
    if (!uri.endsWith('/token')) return null;
    r.provider.options.transport = undefined;
    await r.auth.providers.relink('auth');
    assert.equal((await r.finish(await r.flow())).status, 303);
    return Response.json({ error: 'invalid_client' }, { status: 401 });
  };
  assert.equal((await r.finish(stale)).status, 502);
  assert.equal((await r.auth.providers.list())[0].linked, true, 'a stale failure cannot invalidate the replacement proof');
});

test('OIDC browser failures use the configured sign-in URL, including malformed starts; APIs remain JSON', async t => {
  const r = await fixture(t, [authProvider()], { branding: { signInPath: '/sign-in?next=%2Fapp&notice=old#email' } });
  await r.bootstrap();
  const standalone = createOidcHandler(r.auth.providers);
  for (const [path, options, error, status] of [
    ['/auth/oidc/auth/start', {}, 'oidc_method_not_allowed', 405],
    ['/auth/oidc/auth/start', { method: 'POST', body: '{' }, 'oidc_invalid_input', 400],
    ['/auth/oidc/auth/start', { method: 'POST', body: 'x'.repeat(4097) }, 'oidc_input_too_large', 413],
    ['/auth/oidc/auth/start', { method: 'POST', body: {}, headers: { 'Content-Type': 'text/plain' } }, 'oidc_unsupported_media_type', 415],
    ['/auth/oidc/auth/start', { method: 'POST', body: {}, headers: { Origin: 'https://wrong.example' } }, 'oidc_invalid_origin', 403],
    ['/auth/oidc/auth/callback?state=bad', {}, 'oidc_invalid_correlation', 400],
  ]) {
    const browser = await r.call(path, { ...options, headers: { ...options.headers, Accept: 'text/html' } });
    assert.equal(browser.status, 303);
    const location = new URL(browser.headers.get('location'), 'https://app.example');
    assert.equal(location.origin, 'https://app.example');
    assert.equal(location.pathname, '/sign-in');
    assert.equal(location.searchParams.get('next'), '/app');
    assert.deepEqual(location.searchParams.getAll('notice'), [error]);
    assert.equal(location.hash, '#email');
    const direct = await standalone(r.request(path, { ...options, headers: { ...options.headers, Accept: 'text/html' } }));
    assert.equal(direct.headers.get('location'), browser.headers.get('location'));
    const api = await r.call(path, { ...options, headers: { ...options.headers, Accept: 'application/json' } });
    assert.equal(api.status, status);
    assert.deepEqual(await api.json(), { error });
  }
});


test('linked Auth browser failures inherit the configured sign-in URL while APIs retain typed errors', async t => {
  const r = await fixture(t, [authProvider()], { providers: [], dependencies: true,
    branding: { signInPath: '/member/sign-in?next=%2Fapp%3Ftab%3Done%26view%3Dtwo&notice=old#email' } });
  r.sqlite.exec(await readFile(new URL('../../../../dependencies/schema/dependencies.sql', import.meta.url), 'utf8'));
  r.sqlite.exec(await readFile(new URL('../../../../dependencies/schema/keys-sealed.sql', import.meta.url), 'utf8'));
  r.sqlite.prepare('INSERT INTO rer_dependency_link VALUES(?,?,?,?,?,?)').run('oidc-provider@1', 'https://idp.example', 'client', '{}', 0, Date.now());
  r.sqlite.prepare('INSERT INTO rer_dependency_keys VALUES(?,?)').run('oidc-provider@1', JSON.stringify(clientKey.ES256.private));
  await r.bootstrap();
  r.provider.options.transport = async () => new Response('unavailable', { status: 500 });
  const redirect = (response, error) => {
    assert.equal(response.status, 303);
    const location = new URL(response.headers.get('location'), ORIGIN);
    assert.equal(location.origin, ORIGIN);
    assert.equal(location.pathname, '/member/sign-in');
    assert.equal(location.searchParams.get('next'), '/app?tab=one&view=two');
    assert.deepEqual(location.searchParams.getAll('notice'), [error]);
    assert.equal(location.hash, '#email');
  };
  for (const [path, options, error, status] of [
    ['/auth/oidc/auth/start', { method: 'POST', body: '{' }, 'oidc_invalid_input', 400],
    ['/auth/oidc/auth/start', { method: 'POST', body: {}, headers: { Origin: 'https://wrong.example' } }, 'oidc_invalid_origin', 403],
    ['/auth/oidc/auth/start', { method: 'POST', body: {} }, 'oidc_provider_unavailable', 502],
    ['/auth/oidc/auth/callback?state=bad', {}, 'oidc_invalid_correlation', 400],
  ]) {
    redirect(await r.call(path, { ...options, headers: { ...options.headers, Accept: 'text/html' } }), error);
    const api = await r.call(path, { ...options, headers: { ...options.headers, Accept: 'application/json' } });
    assert.equal(api.status, status);
    assert.equal(api.headers.get('location'), null);
    assert.deepEqual(await api.json(), { error });
  }
  const standalone = createOidcHandler(r.auth.providers);
  redirect(await standalone(r.request('/auth/oidc/auth/start', { method: 'POST', body: '{', headers: { Accept: 'text/html' } })), 'oidc_invalid_input');
});
