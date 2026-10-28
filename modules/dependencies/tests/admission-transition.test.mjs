import { dependencyStore } from '../store.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperatorAuth, createAuthHandler } from '../../operator-auth/index.mjs';
import { runtime, ORIGIN, ISSUER } from './runtime.mjs';
import { createDependencies } from '../index.mjs';
import { provider, network, keys, sign } from '../../operator-auth/identity/oidc/tests/idp.mjs';
import { parseIdToken, verifySignature } from '../../operator-auth/identity/oidc/jwt.mjs';

async function flow(r, claims = {}) {
  const start = await r.call('/auth/oidc/auth/start', { body: {} });
  assert.equal(start.status, 303);
  const grant = await r.idp.authorize(start.headers.get('location'), claims);
  return () => r.call(`/auth/oidc/auth/callback?code=${grant.code}&state=${grant.state}`, { cookie: start.headers.get('set-cookie') });
}
async function move(r, proof) {
  const issuer = 'https://next.example', document = await r.dependencies().document();
  const jwks = await (await r.call('/.well-known/rer-link/jwks')).json();
  const next = await provider({ now: r.now, issuer, clientId: 'next-client', redirectUri: ORIGIN + '/auth/oidc/auth/callback', alg: 'ES256', method: 'private_key_jwt', clientKey: jwks.keys[0], rerInterfaces: ['oidc-provider@1.0.0'] });
  // Different issuers may use the same key id. Their key material is distinct.
  next.key.public.kid = next.key.private.kid = r.idp.options.signingKey.public.kid;
  const transport = network([next]), code = crypto.randomUUID();
  assert.equal((await r.call('/auth/dependencies/relink', { cookie: proof, body: { issuer } })).status, 200);
  const fetcher = async (url, init = {}) => {
    if (url === issuer + '/.well-known/rer-provider') return Response.json({ issuer, interface: 'oidc-provider@1', version: 1, initiate: issuer + '/link', redeem: issuer + '/redeem', deregister: issuer + '/remove' });
    if (url === issuer + '/redeem') {
      const body = JSON.parse(init.body), parsed = parseIdToken(body.client_assertion, { algorithms: ['ES256'] });
      await verifySignature(parsed, jwks);
      assert.equal(body.code, code); assert.equal(parsed.claims.code, code); assert.equal(parsed.claims.aud, url);
      assert.equal(parsed.claims.iss, ORIGIN); assert.equal(parsed.claims.sector_id, document.sector_id);
      return Response.json({ issuer, interface: 'oidc-provider@1', origin: ORIGIN, callback: document.callback, sector_id: document.sector_id, client_id: 'next-client' });
    }
    return transport(url, init);
  };
  const dependencies = createDependencies({ db: r.db, INSTALLATION_KEY:r.config.INSTALLATION_KEY, origin: ORIGIN, name: 'App', provider: issuer, auth: r.auth(), clock: r.now, fetch: fetcher });
  return { response: await dependencies.handle(r.request('/.well-known/rer-link/callback', { body: { issuer, code } })), next, fetcher };
}

test('link transitions fence paused callbacks and sessions without consuming invitations or unrelated credentials', async t => {
  for (const scenario of ['first-unlink', 'bound-unlink', 'invite-unlink', 'metadata-relink', 'same-relink', 'move', 'other-interface']) {
    const cleanups = [], r = await runtime({ after(fn) { cleanups.push(fn); } });
    try {
      const native = await r.bootstrap(); assert.equal((await r.link()).status, 200);
      r.config.externalIssuers = [ISSUER, 'https://other.example']; r.restart();
      const unrelated = await r.auth().createIdentityAdmission({ issuer: 'https://other.example', subjectEmails: { other: 'owner@example.com' } })(r.request('/association', { body: {} }), { issuer: 'https://other.example', subject: 'other' });
      const proof = await r.proof(), invited = scenario === 'invite-unlink';
      const claims = invited ? { email: 'staff@example.com', sub: 'staff-subject' } : {};
      if (invited) assert.equal((await r.call('/auth/invite', { cookie: native, body: { email: claims.email, displayName: 'Staff', role: 'member' } })).status, 202);
      let previous, external;
      if (['bound-unlink', 'metadata-relink', 'same-relink', 'move', 'other-interface'].includes(scenario)) {
        previous = (await (await flow(r))()).headers.get('set-cookie');
        external = (await r.auth().createIdentityAdmission({ issuer: ISSUER, subjectEmails: { 'operator-subject': 'owner@example.com' } })(r.request('/association', { body: {} }), { issuer: ISSUER, subject: 'operator-subject' })).cookie;
      }
      const subject = claims.sub ?? 'operator-subject';
      const bindingCount = () => r.sqlite.prepare('SELECT count(*) n FROM oa_external_identities WHERE issuer=? AND subject=?').get(ISSUER, subject).n;
      const countBefore = bindingCount();
      if (scenario === 'move') {
        r.idp.options.signingKey = await keys('ES256');
        r.idp.options.jwks = [r.idp.options.signingKey.public];
      }
      const finish = await flow(r, claims), gate = r.pauseToken(), pending = finish();
      await gate.ready;
      let changed, moved;
      try {
        if (scenario === 'metadata-relink' || scenario === 'same-relink') {
          if (scenario === 'metadata-relink') r.metadata.deregister = ISSUER + '/new-remove';
          assert.equal((await r.call('/auth/dependencies/relink', { cookie: proof, body: { issuer: ISSUER } })).status, 200);
          changed = await r.link();
        } else if (scenario === 'move') { moved = await move(r, proof); changed = moved.response; }
        else if (scenario === 'other-interface') changed = await r.link('error-sink@1');
        else changed = await r.call('/auth/dependencies/unlink', { cookie: proof, body: { interface: 'oidc-provider@1' } });
      } finally { gate.release(); }
      assert.equal(changed.status, 200, scenario);
      const result = await pending, expected = scenario === 'other-interface' ? 303 : 403;
      assert.equal(result.status, expected, scenario);
      assert.equal((await r.call('/auth/session', { cookie: result.headers.get('set-cookie') })).status, expected === 303 ? 200 : 401, scenario);
      assert.equal(bindingCount(), countBefore, scenario);
      if (invited) {
        assert.equal(r.sqlite.prepare('SELECT status FROM oa_operators WHERE email=?').get(claims.email).status, 'invited');
        assert.equal(r.sqlite.prepare("SELECT consumed_at FROM oa_tokens WHERE kind='invite'").get().consumed_at, null);
      }
      for (const cookie of [native, unrelated.cookie]) assert.equal((await r.call('/auth/session', { cookie })).status, 200, scenario);
      for (const cookie of [previous, external].filter(Boolean)) assert.equal((await r.call('/auth/session', { cookie })).status, scenario === 'other-interface' ? 200 : 401, scenario);
      if (moved) {
        const auth = createOperatorAuth({ db: r.db, config: r.config, clock: r.now, clientIp: () => '192.0.2.1', fetch: moved.fetcher });
        const handler = createAuthHandler(auth);
        const start = await handler(r.request('/auth/oidc/auth/start', { body: {} })); assert.equal(start.status, 303);
        const grant = await moved.next.authorize(start.headers.get('location'), { email_verified_at: r.now() / 1000 });
        const response = await handler(r.request(`/auth/oidc/auth/callback?code=${grant.code}&state=${grant.state}`, { cookie: start.headers.get('set-cookie') }));
        assert.equal(response.status, 303, 'the new issuer retains its own JWKS after an old response arrives');
        assert.equal((await handler(r.request('/auth/session', { cookie: response.headers.get('set-cookie') }))).status, 200);
      }
    } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
  }
});


test('pending approval retains the approving session pin through provider redemption', async t => {
  const r = await runtime(t); await r.bootstrap(); await r.link();
  const signed = await (await flow(r))(), cookie = signed.headers.get('set-cookie');
  assert.equal((await r.call('/auth/step-up', { cookie, body: { action: 'providers:relink' } })).status, 202);
  const token = new URL(r.mails.at(-1).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
  assert.equal((await r.call('/auth/confirm', { cookie, body: { token } })).status, 303);
  assert.equal((await r.call('/auth/dependencies/relink', { cookie, body: { interface: 'error-sink@1', issuer: ISSUER } })).status, 200);
  const proof = await r.proof(), gate = r.pauseLink(), pending = r.link('error-sink@1');
  await gate.ready;
  try {
    const privateKey = (await dependencyStore(r.db,r.config).readKey()).key;
    const auth = createOperatorAuth({ db: r.db, clock: r.now, fetch: r.fetch, clientIp: () => '192.0.2.1', config: {
      ...r.config, dependencies: false, OIDC_TRANSACTION_SECRET: 'static-fixture-transaction-secret-thirty-two-bytes',
      providers: [{ id: 'auth', preset: 'auth', issuer: ISSUER, clientId: 'app-client', privateKey }],
    } });
    assert.equal((await createAuthHandler(auth)(r.request('/auth/providers/relink', { cookie: proof, body: { provider: 'auth' } }))).status, 200);
  } finally { gate.release(); }
  const response = await pending;
  assert.equal(response.status, 503);
  assert.equal(r.sqlite.prepare("SELECT count(*) n FROM rer_dependency_link WHERE interface='error-sink@1'").get().n, 0);
  assert.equal((await r.call('/auth/session', { cookie })).status, 401);
  assert.equal((await r.call('/auth/session', { cookie: proof })).status, 200);
});


test('owner claim retains its captured pin through token and signing-key network waits', async () => {
  for (const door of ['oidc', 'claim']) {
    const cleanups = [], r = await runtime({ after(fn) { cleanups.push(fn); } });
    try {
      assert.equal((await r.link()).status, 200);
      const document = await r.dependencies().document(), subject = 'claim-subject';
      const claims = { iss: ISSUER, aud: 'app-client', sub: subject, iat: r.now() / 1000, exp: r.now() / 1000 + 300,
        jti: crypto.randomUUID(), email: 'owner@example.com', email_verified: true, email_verified_at: r.now() / 1000,
        install_owner: { client_id: 'app-client', sector_id: document.sector_id, subject, email: 'owner@example.com' } };
      const finish = door === 'oidc' ? await flow(r, claims) : async () => r.call('/auth/owner-claim', { body: { token: await sign(r.idp.key, claims) } });
      const gate = door === 'oidc' ? r.pauseToken() : r.pauseKeys(), pending = finish();
      await gate.ready;
      try { assert.equal((await r.link()).status, 200); } finally { gate.release(); }
      const response = await pending;
      assert.equal(response.status, door === 'oidc' ? 403 : 409, door);
      assert.equal((await r.call('/auth/session', { cookie: response.headers.get('set-cookie') })).status, 401);
      for (const table of ['oa_operators', 'oa_sessions', 'oa_external_identities', 'oc_idp_grants', 'oc_owner_claims'])
        assert.equal(r.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0, door + ': ' + table);
      const fresh = await r.call('/auth/owner-claim', { body: { token: await sign(r.idp.key, { ...claims, jti: crypto.randomUUID() }) } });
      assert.equal(fresh.status, 303);
      assert.equal((await r.call('/auth/session', { cookie: fresh.headers.get('set-cookie') })).status, 200);
    } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
  }
});
