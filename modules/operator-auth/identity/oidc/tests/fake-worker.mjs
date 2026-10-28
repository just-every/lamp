// Test-only workerd app: the real composed auth, its HTTP adapter and sign-in
// page, with fake OpenID providers standing only at the network edge. Provider
// behaviour, grants and the test clock live in D1 so they survive a restart.
import { createOperatorAuth, createAuthHandler, createSignInHandler, AuthError } from '../../../index.mjs';
import { withDevIdentity } from '../../../dev/index.mjs';
import { linkEdge } from '../../../tests/native/provider-edge.mjs';
import { openDependencyKey } from '../../../../dependencies/sealing.mjs';
import { publicKey } from '../../../../dependencies/crypto.mjs';
import { fixture as nativeFixture } from '../../../tests/native/accounts.mjs';
import { directEmail } from '../../../tests/native/email.mjs';
import { createDependencies } from '../../../../dependencies/index.mjs';
import { provider as fakeProvider } from './idp.mjs';

async function state(db) {
  const rows = (await db.prepare('SELECT key,value FROM fixture_state').all()).results;
  return Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
}
const put = (db, key, value) => db.prepare('INSERT INTO fixture_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, JSON.stringify(value)).run();
const grants = (db, issuer) => ({
  async put(code, grant) { await db.prepare('INSERT INTO fixture_grants(code,issuer,payload) VALUES(?,?,?)').bind(code, issuer, JSON.stringify(grant)).run(); },
  async take(code) { const row = await db.prepare('DELETE FROM fixture_grants WHERE code=? AND issuer=? RETURNING payload').bind(code, issuer).first(); return row ? JSON.parse(row.payload) : undefined; },
});
// Failure modes at the edge, for discovery and JWKS only.
const failures = {
  down: () => new Response('unavailable', { status: 500 }),
  404: () => new Response('gone', { status: 404 }),
  dns: () => { throw new TypeError('getaddrinfo ENOTFOUND'); },
};

export default {
  async fetch(incoming, env, execution) {
    // Tests carry exact requests in an envelope; a real browser talks to the listener directly.
    let request = incoming;
    if (new URL(incoming.url).pathname === '/__test_dispatch') { const { url, ...init } = await incoming.json(); request = new Request(url, init); }
    const url = request.url;
    const db = env.DB;
    const current = await state(db);
    const setup = current.browserSetup ?? JSON.parse(env.TEST_SETUP);
    const offset = current.clock ?? 0;
    const now = () => Date.now() + offset;
    const patch = current.fakes ?? {};
    const nativeLink = setup.native && setup.dependencyIssuer ? linkEdge(db,setup.dependencyIssuer,'app-at-auth',now,setup.core) : null;
    const nativeKey=setup.native?await db.prepare("SELECT private_key FROM rer_dependency_keys WHERE interface='oidc-provider@1'").first():null;
    const fakes = await Promise.all(setup.fakes.map(async spec => {
      const changes = patch[spec.issuer] ?? {};
      const { keyName, clientKeyName, signingKeyName, jwksNames, failure, ...options } = { ...spec, ...changes };
      return fakeProvider({ ...options, key: setup.keys[keyName], clientKey: nativeKey && spec.issuer===setup.dependencyIssuer ? publicKey((await openDependencyKey(setup.core,'oidc-provider@1',nativeKey.private_key)).key) : clientKeyName ? setup.keys[clientKeyName].public : undefined,
        ...(signingKeyName ? { signingKey: setup.keys[signingKeyName] } : {}), ...(jwksNames ? { jwks: jwksNames.map(name => setup.keys[name].public) } : {}),
        transport: failure ? async uri => uri.endsWith('/token') ? null : failures[failure]() : undefined,
        grants: grants(db, spec.issuer), now });
    }));
    const fetcher = async (uri, init) => {
      const linked=await nativeLink?.fetch(String(uri),init);if(linked)return linked;
      const target = fakes.find(f => String(uri).startsWith(`${f.issuer}/`));
      if (!target) throw new TypeError('getaddrinfo ENOTFOUND');
      await db.prepare('INSERT INTO fixture_requests(issuer,uri) VALUES(?,?)').bind(target.issuer, String(uri)).run();
      return target.fetch(String(uri), init);
    };
    const providers = setup.providers.map(p => ({ ...p, ...(p.privateKeyName ? { privateKey: setup.keys[p.privateKeyName].private } : {}), privateKeyName: undefined, ...current.config?.[p.id] }));
    const hooks = {
      audit: setup.audit ? event => {
        const insert = ['INSERT INTO fixture_admin_audit(payload) VALUES(?)', [JSON.stringify(event)]];
        return current.auditFailure ? [insert, ['INSERT INTO fixture_admin_audit(payload) VALUES(NULL)', []]] : [insert];
      } : undefined,
      beforeMagicLink: setup.hooks?.quietFor ? ({ email }) => email !== setup.hooks.quietFor : undefined,
      afterConfirm: setup.hooks?.reviewFor || setup.hooks?.refuseFor ? async ({ operator, session, method }) => {
        await db.prepare('INSERT INTO fixture_hook_calls(session_id,method) VALUES(?,?)').bind(session.id,method).run();
        if (operator.email === setup.hooks.refuseFor) throw new AuthError('restored_operator_review', 403);
        return operator.email === setup.hooks.reviewFor ? { returnTo: setup.hooks.returnTo ?? '/app/review' } : undefined;
      } : undefined,
    };
    const options = { ...(setup.native ? nativeFixture(db,now,{...setup.native,...current.native}) : {}), db, clock: now, fetch: fetcher, waitUntil: promise => execution.waitUntil(promise), hooks,
      clientIp: () => '192.0.2.1',
      mailSender: setup.noMail ? undefined : { async send(message) { await db.prepare('INSERT INTO test_mail(message) VALUES(?)').bind(JSON.stringify(message)).run(); if(current.mailStatus==='exception')throw new Error('fixture mail failed'); return { provider: 'fixture', status: current.mailStatus??'accepted', providerMessageId: null }; } },
      config: { origin: 'https://app.example', OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: 'test-only-fake-provider-session-secret', SETUP_TOKEN: 'test-only-fake-provider-setup-token-value',
        MAIL_FROM: 'auth@example.com', OIDC_TRANSACTION_SECRET: 'test-only-fake-provider-transaction-secret', ipLimit: 1000, emailLimit: 1000,
        branding: { productName: 'Fixture' }, providers, ...setup.core } };
    const composed = createOperatorAuth(options);
    const auth = setup.native?.standaloneEmail ? { ...composed, ...directEmail(options,composed) } : composed;
    const path = new URL(url).pathname;
    try {
      if (path === '/__fake/link-code') return Response.json({code:await nativeLink.code()});
      if (path === '/__fake/link-pause') {await nativeLink.pause();return Response.json({ok:true});}
      if (path === '/__fake/link-ready') {await nativeLink.ready();return Response.json({ok:true});}
      if (path === '/__fake/link-release') {await nativeLink.release();return Response.json({ok:true});}
      if (path === '/__fake/authorize') {
        const { location, claims } = await request.json();
        const target = fakes.find(f => location.startsWith(`${f.issuer}/`));
        return Response.json(await target.authorize(location, claims));
      }
      if (path === '/__fake/set') {
        const { issuer, changes } = await request.json();
        await put(db, 'fakes', { ...patch, [issuer]: { ...patch[issuer], ...changes } });
        return Response.json({ ok: true });
      }
      if (path === '/__fake/native') {await put(db,'native',await request.json());return Response.json({ok:true});}
      if (path === '/__fake/mail') {await put(db,'mailStatus',(await request.json()).status);return Response.json({ok:true});}
      if (path === '/__fake/config') { const { id, changes } = await request.json(); await put(db, 'config', { ...current.config, [id]: changes }); return Response.json({ ok: true }); }
      if (path === '/__fake/clock') { await put(db, 'clock', (await request.json()).offset); return Response.json({ ok: true }); }
      if (path === '/__fake/requests') return Response.json((await db.prepare('SELECT issuer,uri FROM fixture_requests ORDER BY id').all()).results);
      if (path.startsWith('/test/guard/')) return Response.json(await auth.requireStepUp(request, decodeURIComponent(path.slice('/test/guard/'.length))));
      if (path === '/test/editor') return Response.json(await auth.requireEditorOwner(request));
      if (path === '/test/private') {
        const session = await auth.getSession(request);
        return Response.json(session ? { kind: session.kind, email: session.operator.email, role: session.operator.role, id: session.operator.id } : { error: 'unauthenticated' }, { status: session ? 200 : 401 });
      }
      if (path === '/test/password') {
        const { operatorId } = await request.json();
        const result = await auth.admitVerifiedPassword(request, operatorId);
        return new Response(null, { status: 204, headers: { 'Set-Cookie': result.cookie } });
      }
      if (setup.legacy && path === '/test/association') {
        const principal = await request.json();
        const result = await auth.createIdentityAdmission(setup.legacy)(request, principal);
        return new Response(null, { status: 303, headers: { 'Set-Cookie': result.cookie } });
      }
      if (setup.legacy && path === '/test/verified') {
        const result = await auth.admitVerifiedIdentity(request, await request.json());
        return new Response(null, { status: 303, headers: { 'Set-Cookie': result.cookie } });
      }
    } catch (error) {
      if (error instanceof AuthError) return Response.json({ error: error.code }, { status: error.status });
      throw error;
    }
    if(setup.native && setup.core?.dependencies) {const response=await createDependencies({db,INSTALLATION_KEY:setup.core.INSTALLATION_KEY,origin:setup.core.origin??'https://app.example',name:'Native',provider:setup.dependencyIssuer,auth,fetch:fetcher,clock:now}).handle(request);if(response)return response;}
    const app = { async fetch(request) {
      return await createSignInHandler(auth)(request) ?? await createAuthHandler(auth)(request) ?? new Response('Not found', { status: 404 });
    } };
    return setup.devKey ? withDevIdentity(app, {
      config: () => options.config,
      bindings: env => ({ ...env, RER_DEV_KEY: setup.devKey, AUTH_ORIGIN: options.config.origin, AUTH_LOCAL: 'true' }),
    }).fetch(request, env, execution) : app.fetch(request);
  },
};
