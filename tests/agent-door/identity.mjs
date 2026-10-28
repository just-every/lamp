import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { accessToken, signJws, seconds } from '../../src/base/modules/agent-door/conformance/crypto.mjs';

/** People are created/accepted/revoked through production doors; signed roster
 * reconciliation binds those existing native identities, never token email. */
export async function inspectPeople(fixture, c) {
  for (const override of [{sub:randomUUID()}, {aud:'https://another-installation.invalid/mcp'}]) {
    const answer = await c.mcp('tools/list', {}, {token:await accessToken(c, override)});
    assert.equal(answer.status,401,'Matching token email cannot rescue an unknown person or wrong audience');
  }
  const email = 'teammate@example.test', businessId = randomUUID();
  const invitation = await c.personRequest('/api/app/operators/invite', {method:'POST',body:JSON.stringify({email,displayName:'Morgan Quay'})});
  assert.equal(invitation.status,202,'The ordinary native owner invitation must succeed');
  await invitation.body?.cancel();
  const message = fixture.mail.findLast(item => JSON.stringify(item.to).includes(email));
  const link = String(message?.text ?? '').match(/https?:\/\/[^\s]+/)?.[0];
  assert.ok(link,'Native captured invitation must contain its real one-use confirmation');
  const accepted = await fixture.request('/auth/confirm',{method:'POST',headers:{Origin:fixture.origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(link).searchParams.get('token')})});
  assert.equal(accepted.status,303); await accepted.body?.cancel();
  const native = (await c.personJson('/api/app/operators')).operators.find(person=>person.email===email);
  assert.ok(native?.id && native.id!==businessId);
  const iat = seconds();
  const settings = await signJws(fixture.signer.privateKey,fixture.signer.kid,'rer-business-settings+jwt',{
    v:1,iss:fixture.signer.issuer,aud:fixture.origin,sub:fixture.signer.installationId,business:fixture.business,email:fixture.person.email,
    owner_id:fixture.person.sub,jti:randomUUID(),iat,exp:iat+300,rev:2,values:{},logo:null,
    team:[{id:businessId,email,name:'Morgan Quay',role:'member',invite:0}],
  });
  const applied = await fixture.request('/api/rer/business-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings})});
  assert.equal(applied.status,200); const ack = await applied.json();
  assert.equal(ack.team.find(person=>person.email===email)?.state,'active');
  const token = await accessToken(c,{sub:businessId,email,act:{sub:'quay-assistant',name:'Quay assistant',specialist:c.surface.specialist}});
  assert.equal((await c.mcp('tools/list',{}, {token})).status,200,'Mapped Business teammate retains native equal-owner admission');
  const revoked = await c.personRequest(`/api/app/operators/${native.id}/revoke-access`,{method:'POST',body:'{}'});
  assert.equal(revoked.status,204); await revoked.body?.cancel();
  assert.equal((await c.mcp('tools/list',{}, {token})).status,401,'Native revocation immediately stops the mapped sponsor');
  console.log('PASS native people: signed owner/team Business IDs, real invitation/acceptance, unmapped and wrong-audience refusal, current native revocation; matching email gives no authority.');
}
