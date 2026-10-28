import assert from 'node:assert/strict';
import { load } from '../operator-readiness/runtime.mjs';
import { lampRuntime, linkToken } from '../auth-adoption/lamp-runtime.mjs';

const loaded = Promise.all([
  load('src/core/features/agent-door/people.ts'),
  load('src/core/features/agent-door/settings.ts'),
  load('src/core/features/agent-door/native-proof.ts'),
]);

/** Additional assertions within the single shared-door registration. Native
 * accounts, sessions, signed settings and persistence are real; only mail is
 * captured at the transport edge. No fixture SQL creates authority. */
export async function runNativeIdentityProofFlow(t) {
  const r = await lampRuntime(t), [peopleModule, settingsModule, proofModule] = await loaded;
  const mail = {configured: true, async send(message) { r.messages.push(message); return {providerMessageId: `identity-edge-${r.messages.length}`}; }};
  const services = {auth: () => r.auth, mail};
  const keyPair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const origin = new URL(r.bindings.AUTH_ORIGIN).origin;
  const trust = {v: 1, issuer: 'https://identity-proof-business.example.test', audience: origin,
    subject: 'lamp-identity-proof', email: r.owner.email, keys: {'per-run': publicKey}};
  const settings = settingsModule.createBusinessSettings(services, {...r.bindings, RER_BUSINESS_TRUST: JSON.stringify(trust)});
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const sign = async document => {
    const payload = `${encode({alg: 'ES256', typ: 'rer-business-settings+jwt', kid: 'per-run'})}.${encode(document)}`;
    const signature = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, keyPair.privateKey, new TextEncoder().encode(payload));
    return `${payload}.${Buffer.from(signature).toString('base64url')}`;
  };
  let revision = 0;
  const apply = async team => {
    const now = Math.floor(Date.now() / 1000);
    const document = {v: 1, iss: trust.issuer, aud: trust.audience, sub: trust.subject, business: 'lamp-identity-proof',
      email: r.owner.email, jti: crypto.randomUUID(), iat: now, exp: now + 300, rev: ++revision,
      values: {display_name: 'Lamp identity proof'}, logo: null, owner_id: 'business-owner', team};
    const response = await settings.handle(r.request('/api/rer/business-settings', {method: 'POST', body: {settings: await sign(document)}}));
    assert.equal(response.status, 200, 'Normal signed Business settings must bind the native team');
    return response.json();
  };
  await apply([{id: 'business-teammate', email: 'mapped-teammate@example.test', name: 'Mapped teammate', role: 'admin', invite: 1}]);
  const invitation = linkToken(r.messages.at(-1));
  const accepted = await r.authHandle(r.request('/auth/confirm', {method: 'POST', body: {token: invitation}}));
  assert.equal(accepted.status, 303, 'The normal native invitation must create the teammate session');
  const teammateCookie = accepted.headers.get('set-cookie').split(';', 1)[0];
  const people = peopleModule.createPeopleAdapter(services, r.bindings);
  const mapped = await people.sponsor({sub: 'business-teammate'});
  assert.ok(mapped?.active);
  assert.equal((await people.businessMember(mapped)).role, 'editor');
  assert.equal((await people.sponsor({sub: 'business-owner'})).id, r.owner.id);
  const ownerPerson = await people.sponsor({sub: 'business-owner'});
  const mutable = peopleModule.createLocalCredentials(services, r.bindings);
  const scoped = {person: ownerPerson, agent: {id: 'business-agent', name: 'Business agent'}, clientId: 'business-oauth-client', scopes: ['lamp.status.read']};
  assert.deepEqual(await mutable.currentScopes(scoped), ['lamp.status.read'], 'Business OAuth client IDs are not native API credential IDs');
  assert.deepEqual(await mutable.currentScopes({...scoped, agent: {id: 'management:missing', name: 'Retired key'}, clientId: 'missing'}), [], 'Unknown native management credentials remain refused');

  assert.equal(await people.sponsor({sub: 'unmapped-owner-email-token'}), null);
  await r.auth.changeEmail(r.request('/auth/email', {method: 'POST', cookie: teammateCookie}), {email: 'moved-teammate@example.test'});
  const replacement = await r.invite('mapped-teammate@example.test', true);
  assert.notEqual(replacement.id, mapped.id);
  await apply([{id: 'business-teammate', email: 'mapped-teammate@example.test', name: 'Mapped teammate', role: 'admin', invite: 1}]);
  assert.equal((await people.sponsor({sub: 'business-teammate'})).id, mapped.id, 'Address reassignment cannot transfer the Business binding');
  assert.equal((await people.sponsor({sub: 'business-teammate'})).email, 'moved-teammate@example.test');
  const excluded = peopleModule.createPeopleAdapter(services, {...r.bindings, AUTH_ALLOW_LIST: r.owner.email});
  assert.equal(await excluded.sponsor({sub: 'business-teammate'}), null, 'Current native allow-list excludes a mapped person');
  const proofs = proofModule.createNativeProof(services, r.bindings);
  const args = {enabled: false};
  const requested = await proofs.handle(r.request('/api/rer/agent-native-proof', {method: 'POST', cookie: r.cookie,
    body: {agent_id: 'identity-proof-agent', tool: 'lamp.importgrants.update', arguments: args}}));
  assert.equal(requested.status, 201, 'A real recently email-authenticated person can issue a bound proof reference');
  const {reference} = await requested.json();
  const principal = {person: await people.person(r.owner.id), agent: {id: 'identity-proof-agent', name: 'Identity proof agent'}, scopes: ['lamp.importgrants.update']};
  const verify = (changes = {}) => proofs.hooks.verify({kind: 'step_up', tool: 'lamp.importgrants.update', args, principal, reference, ...changes});
  assert.equal(await verify(), true);
  assert.equal(await verify({args: {enabled: true}}), false, 'The proof cannot authorize changed arguments');
  assert.equal(await verify({principal: {...principal, agent: {id: 'other-agent', name: 'Other agent'}}}), false, 'Another agent cannot reuse native proof');
  assert.equal(await verify({principal: {...principal, person: mapped}}), false, 'Another native person cannot reuse proof');
  const crossSite = r.request('/api/rer/agent-native-proof', {method: 'POST', cookie: r.cookie,
    body: {agent_id: 'identity-proof-agent', tool: 'lamp.importgrants.update', arguments: args}});
  crossSite.headers.set('Origin', 'https://outside.example.test');
  assert.equal((await proofs.handle(crossSite)).status, 403);
  await r.auth.setOperatorStatus(r.request('/auth/operator/status', {method: 'POST', cookie: r.cookie}), mapped.id, 'inactive');
  assert.equal(await people.sponsor({sub: 'business-teammate'}), null, 'Revoked native admission immediately stops sponsorship');
  await r.auth.signOut(r.request('/auth/signout', {method: 'POST', cookie: r.cookie}));
  assert.equal(await verify(), false, 'Revoking the real native proof session stops held execution');
}
