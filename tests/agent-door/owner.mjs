import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const IDENTITY_ORIGIN = 'https://lamp-agent-idp.example.invalid';
const states = new Map();
export const ownerFixtureState = origin => states.get(origin);
const cookies = response => response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');

async function expectStatus(response, expected, label) {
  if (response.status !== expected) console.error(`Native owner fixture: ${label}: HTTP ${response.status}, expected ${expected}`);
  assert.equal(response.status, expected, `${label}: HTTP ${response.status}`);
  return response;
}

export default async function owner(context) {
  // The same contained module supplies the fixed disposable issuer binding.
  // No key, real environment setting or external credential is read.
  if (!context.request) return IDENTITY_ORIGIN;
  const { request, origin, email, sub, displayName, token, claim, fixtures, returnTo = '/app', owner } = context;
  const call = (path, { method = 'GET', body, cookie } = {}) => request(new URL(path, origin).href, {
    method, redirect: 'manual', headers: { Host: new URL(origin).host, Origin: origin, 'CF-Connecting-IP': '192.0.2.77',
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let state;
  if (!owner) {
    state = {}; states.set(origin, state);
    await (await expectStatus(await call('/auth/dependencies/setup', { method: 'POST', body: { issuer: IDENTITY_ORIGIN, token } }), 200, 'Native dependency setup')).body?.cancel();
    const bootstrap = await expectStatus(await call(claim?.mode === 'signed' ? claim.path : '/auth/bootstrap', {
      method: 'POST', body: { token: claim?.mode === 'signed' ? claim.token : token, displayName, returnTo },
    }), 303, 'Native owner bootstrap');
    state.bootstrapCookie = cookies(bootstrap);
    assert.ok(state.bootstrapCookie, 'Native owner bootstrap must create a session');
    await bootstrap.body?.cancel();
    const discovery = await expectStatus(await call('/.well-known/rer-dependencies'), 200, 'Native dependency discovery');
    const document = await discovery.json();
    const dependency = document.dependencies.find(item => item.interface === 'oidc-provider@1');
    assert.ok(dependency, 'Lamp must advertise its native identity dependency');
    const jwks = await expectStatus(await request(dependency.jwks_uri, { redirect: 'manual', headers: { Host: new URL(origin).host } }), 200, 'Native dependency public key');
    state.link = { code: randomUUID(), sector: document.sector_id, publicKey: (await jwks.json()).keys[0], origin, callback: document.callback };
    fixtures.set(IDENTITY_ORIGIN, { link: state.link });
    await (await expectStatus(await call('/.well-known/rer-link/callback', { method: 'POST', body: { issuer: IDENTITY_ORIGIN, code: state.link.code } }), 200, 'Native dependency link')).body?.cancel();
  } else {
    state = states.get(origin);
    assert.ok(state?.link, 'Additional sponsors require the native owner-linked provider');
  }

  const start = await expectStatus(await call('/auth/oidc/auth/start', { method: 'POST', body: { returnTo } }), 303, 'Native provider sign-in start');
  const location = new URL(start.headers.get('Location'));
  assert.equal(location.origin, IDENTITY_ORIGIN, 'Native provider sign-in must use its linked issuer');
  assert.equal(location.pathname, '/authorize');
  const bindingCookie = cookies(start);
  await start.body?.cancel();
  const code = randomUUID();
  fixtures.set(IDENTITY_ORIGIN, { link: state.link, authorization: { ...Object.fromEntries(location.searchParams), code, email, subject: `native-${sub}` } });
  const callback = new URL(location.searchParams.get('redirect_uri'));
  assert.equal(callback.origin, origin, 'Native provider callback must stay in this disposable installation');
  callback.searchParams.set('code', code); callback.searchParams.set('state', location.searchParams.get('state')); callback.searchParams.set('iss', IDENTITY_ORIGIN);
  const session = await expectStatus(await request(callback.href, { redirect: 'manual', headers: { Host: new URL(origin).host, Cookie: bindingCookie, 'CF-Connecting-IP': '192.0.2.77' } }), 303, 'Native provider sign-in callback');
  const cookie = cookies(session);
  assert.ok(cookie, 'Native provider admission must create a real session');
  const identity = await expectStatus(await call('/auth/session', { cookie }), 200, 'Native provider session');
  const person = (await identity.json()).operator;
  assert.equal(person.email, email, 'Native provider session must belong to the requested synthetic person');
  if (owner) state.inactive = { sub, email, id: person.id, suspended: false };
  else state.ownerCookie = cookie;
  return session;
}
