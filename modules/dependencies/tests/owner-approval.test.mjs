import { dependencyStore } from '../store.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {runtime,ORIGIN,ISSUER} from './runtime.mjs';
import {createOwnerClaimHandler} from '../../owner-claim/index.mjs';
import {testKeys,signClaim,claimConfig} from '../../owner-claim/tests/keys.mjs';
import {createOperatorAuth,createAuthHandler} from '../../operator-auth/index.mjs';
import {sign,provider,network} from '../../operator-auth/identity/oidc/tests/idp.mjs';

const setting=r=>({...r.sqlite.prepare('SELECT idp_sign_in,first_setup,generation FROM oa_auth_settings').get()});
const audit=r=>r.sqlite.prepare("SELECT actor_id,value FROM oa_auth_audit WHERE action='idpSignIn'").all();
async function login(r) {
 const start=await r.call('/auth/oidc/auth/start',{body:{}});assert.equal(start.status,303);
 const grant=await r.idp.authorize(start.headers.get('location'));
 const result=await r.call(`/auth/oidc/auth/callback?code=${grant.code}&state=${grant.state}`,{cookie:start.headers.get('set-cookie')});assert.equal(result.status,303);return result.headers.get('set-cookie');
}
const approve=(r,cookie)=>r.call('/auth/dependencies/relink',{cookie,body:{issuer:ISSUER}});
async function anotherOwner(r,proof) {
 assert.equal((await r.call('/auth/invite',{cookie:proof,body:{email:'other@example.com',displayName:'Other',role:'owner'}})).status,202);
 const token=new URL(r.mails.at(-1).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
 const accepted=await r.call('/auth/confirm',{body:{token}});assert.equal(accepted.status,303);
 return accepted.headers.get('set-cookie');
}
async function idpSetup(r,timing) {
 for(const contract of ['oidc-provider@1','error-sink@1'])assert.equal((await r.approveSetup(contract)).status,200);
 assert.equal((await r.rawLink()).status,200);
 let gate=timing==='before claim'?r.pauseLink():null,pending=gate?r.rawLink('error-sink@1'):null;
 if(gate)await gate.ready;
 try {
  const document=await r.dependencies().document(),subject='claim-subject';
  const token=await sign(r.idp.key,{iss:ISSUER,aud:'app-client',sub:subject,iat:r.now()/1000,exp:r.now()/1000+300,jti:crypto.randomUUID(),email:'owner@example.com',email_verified:true,email_verified_at:r.now()/1000,install_owner:{client_id:'app-client',sector_id:document.sector_id,subject,email:'owner@example.com'}});
  const claim=await r.call('/auth/owner-claim',{body:{token}});assert.equal(claim.status,303);
  const cookie=claim.headers.get('set-cookie'),session=await r.call('/auth/session',{cookie});assert.equal(session.status,200);
  const actor=await session.json();assert.equal(actor.kind,'oidc');
  assert.equal(r.sqlite.prepare("SELECT session_id FROM oa_setup_links WHERE interface='error-sink@1'").get().session_id,actor.id);
  if(timing==='during redemption'){gate=r.pauseLink();pending=r.rawLink('error-sink@1');await gate.ready;}
  return {cookie,actor,gate,pending};
 }catch(error){gate?.release();if(pending)await pending;throw error;}
}
async function changePin(r,proof,change) {
 // Exercise the ordinary provider controls without the dependency route's
 // extra revocation, so a stale pin alone must defeat setup-session authority.
 const issuer=change==='moved pin'?'https://next.example':ISSUER;
 const next=await provider({issuer,alg:'ES256',method:'private_key_jwt',rerInterfaces:['oidc-provider@1.0.0']});
 const privateKey=(await dependencyStore(r.db,r.config).readKey()).key;
 const auth=createOperatorAuth({db:r.db,clock:r.now,fetch:issuer===ISSUER?r.fetch:network([next]),clientIp:()=> '192.0.2.1',config:{...r.config,dependencies:false,OIDC_TRANSACTION_SECRET:'static-fixture-transaction-secret-thirty-two-bytes',providers:[{id:'auth',preset:'auth',issuer,clientId:'app-client',privateKey}]}});
 const path=change==='unlinked pin'?'/auth/providers/unlink':'/auth/providers/relink';
 assert.equal((await createAuthHandler(auth)(r.request(path,{cookie:proof,body:{provider:'auth'}}))).status,200,change);
}

test('every dependency callback needs its own live app approval; unlink and in-flight authority changes cannot restore provider access',async t=>{
 const r=await runtime(t);
 assert.equal((await r.rawLink()).status,403,'configured issuer alone never authorizes initial link');
 const native=await r.bootstrap();assert.equal((await r.rawLink()).status,200);
 const session=await login(r),bindings=r.sqlite.prepare('SELECT * FROM oa_external_identities').all(),sector=(await r.dependencies().document()).sector_id;
 assert.equal((await r.rawLink()).status,403,'unchanged link still needs a new app approval');
 const owner=await r.proof();
 assert.equal((await r.call('/auth/domain-rules',{cookie:owner,body:{domain:'example.org',provider:'auth'}})).status,200);
 assert.equal(r.sqlite.prepare('SELECT count(*) n FROM oa_domain_rules').get().n,1);
 assert.equal((await r.call('/auth/dependencies/unlink',{cookie:owner,body:{}})).status,200);
 assert.equal((await r.call('/auth/session',{cookie:session})).status,401);
 assert.equal(r.sqlite.prepare('SELECT count(*) n FROM oa_domain_rules').get().n,0);
 assert.equal((await r.call('/auth/oidc/auth/start',{body:{}})).status,403);
 assert.equal((await r.rawLink()).status,403,'provider-owner continuity cannot resurrect removed trust');
 assert.equal(r.sqlite.prepare('SELECT count(*) n FROM rer_dependency_pending').get().n,0);
 assert.equal((await approve(r,owner)).status,200);assert.equal((await r.rawLink()).status,200);
 assert.equal((await r.dependencies().document()).sector_id,sector);assert.deepEqual(r.sqlite.prepare('SELECT * FROM oa_external_identities').all(),bindings);
 assert.equal((await r.call('/auth/session',{cookie:session})).status,401);await login(r);
 assert.equal((await r.call('/auth/session',{cookie:native})).status,200);
 for(const change of ['replacement','unlink','revocation']) {
  const proof=await r.proof();assert.equal((await approve(r,proof)).status,200);
  const gate=r.pauseLink(),pending=r.rawLink();await gate.ready;
  const before=r.sqlite.prepare('SELECT * FROM rer_dependency_link').get();
  try {
   if(change==='replacement')assert.equal((await approve(r,proof)).status,200);
   if(change==='unlink')assert.equal((await r.call('/auth/dependencies/unlink',{cookie:proof,body:{}})).status,200);
   if(change==='revocation')assert.equal((await r.call('/auth/signout',{cookie:proof,body:{}})).status,204);
  }finally{gate.release();}
  assert.notEqual((await pending).status,200,change+' must defeat in-flight callback');
  if(change==='unlink')assert.equal(r.sqlite.prepare('SELECT * FROM rer_dependency_link').get(),undefined);
  else assert.deepEqual(r.sqlite.prepare('SELECT * FROM rer_dependency_link').get(),before);
 }
 // Setup-secret approval becomes authority of the exact native claim session.
 // Another valid session for that owner cannot keep the original approval alive.
 for(const timing of ['before callback','during redemption'])for(const change of ['signout','session revocation','owner inactive','owner version','session expiry']) {
  const setup=await runtime(t);
  if(change==='session expiry'){setup.config.sessionSeconds=1;setup.restart();}
  const cookie=await setup.bootstrap(),proof=await setup.proof();
  const actor=await (await setup.call('/auth/session',{cookie})).json();
  const other=change.startsWith('owner ')?await anotherOwner(setup,proof):null;
  const before=setting(setup),beforeAudit=audit(setup);
  const gate=timing==='during redemption'?setup.pauseLink():null,pending=gate?setup.rawLink():null;
  if(gate)await gate.ready;
  try {
   if(change==='signout')assert.equal((await setup.call('/auth/signout',{cookie,body:{}})).status,204);
   if(change==='session revocation')assert.equal((await setup.call('/auth/session/revoke',{cookie:proof,body:{sessionId:actor.id}})).status,204);
   if(other) {
    assert.equal((await setup.call('/auth/operator/status',{cookie:other,body:{operatorId:actor.operator.id,status:'inactive'}})).status,200);
    if(change==='owner version')assert.equal((await setup.call('/auth/operator/status',{cookie:other,body:{operatorId:actor.operator.id,status:'active'}})).status,200);
   }
   if(change==='session expiry')setup.advance(1000);
   assert.equal((await setup.call('/auth/session',{cookie})).status,401);
   if(!other && change!=='session expiry')assert.equal((await setup.call('/auth/session',{cookie:proof})).status,200);
  }finally{gate?.release();}
  const response=await (pending??setup.rawLink());
  assert.ok(response.status>=400,change+' '+timing+' refuses setup callback');
  assert.deepEqual(setting(setup),before);assert.deepEqual(audit(setup),beforeAudit);
  assert.equal((await (await setup.call('/auth/dependencies/status')).json()).linked,false);
  assert.equal((await setup.call('/auth/oidc/auth/start',{body:{}})).status,403);
 }
 // A real signed IdP grant keeps the same originating session, including when
 // bootstrap binds the pending attempt while its callback awaits redemption.
 for(const timing of ['before callback','during redemption','before claim'])for(const change of ['signout','session revocation','owner inactive','owner version','session expiry','identity off','off then on','stale generation','missing provenance','missing pin','relinked pin','moved pin','unlinked pin']) {
  const setup=await runtime(t);
  if(change==='session expiry'){setup.config.sessionSeconds=1;setup.restart();}
  const {cookie,actor,gate,pending}=await idpSetup(setup,timing);
  let before,beforeAudit,links,approval;
  try {
   const proof=await setup.proof();
   if(change==='signout')assert.equal((await setup.call('/auth/signout',{cookie,body:{}})).status,204);
   if(change==='session revocation')assert.equal((await setup.call('/auth/session/revoke',{cookie:proof,body:{sessionId:actor.id}})).status,204);
   if(change.startsWith('owner ')) {
    const other=await anotherOwner(setup,proof);
    assert.equal((await setup.call('/auth/operator/status',{cookie:other,body:{operatorId:actor.operator.id,status:'inactive'}})).status,200);
    if(change==='owner version')assert.equal((await setup.call('/auth/operator/status',{cookie:other,body:{operatorId:actor.operator.id,status:'active'}})).status,200);
   }
   if(change==='session expiry')setup.advance(1000);
   if(change==='identity off' || change==='off then on') {
    assert.equal((await setup.call('/auth/settings/identity',{cookie:proof,body:{idpSignIn:false}})).status,200);
    if(change==='off then on')assert.equal((await setup.call('/auth/settings/identity',{cookie:proof,body:{idpSignIn:true}})).status,200);
   }
   // Invalid persisted provenance must fail closed even without revocation.
   if(change==='stale generation')setup.sqlite.exec('UPDATE oa_auth_settings SET generation=generation+1');
   if(change==='missing provenance')setup.sqlite.prepare('DELETE FROM oa_provider_sessions WHERE session_id=?').run(actor.id);
   if(change==='missing pin')setup.sqlite.prepare('DELETE FROM oa_provider_session_pins WHERE session_id=?').run(actor.id);
   if(['relinked pin','moved pin','unlinked pin'].includes(change)) {
    await changePin(setup,proof,change);
    assert.equal(setup.sqlite.prepare('SELECT revoked_at FROM oa_sessions WHERE id=?').get(actor.id).revoked_at,null);
   }
   if(change!=='missing pin')assert.equal((await setup.call('/auth/session',{cookie})).status,401,change);
   if(!change.startsWith('owner ') && change!=='session expiry')assert.equal((await setup.call('/auth/session',{cookie:proof})).status,200);
   before=setting(setup);beforeAudit=audit(setup);
   links=setup.sqlite.prepare('SELECT * FROM rer_dependency_link ORDER BY interface').all();
   approval=setup.sqlite.prepare("SELECT * FROM rer_dependency_pending WHERE interface='error-sink@1'").get();
  }finally{gate?.release();}
  const response=await (pending??setup.rawLink('error-sink@1'));
  assert.equal(response.status,gate?503:403,change+' '+timing);
  assert.deepEqual(setting(setup),before);assert.deepEqual(audit(setup),beforeAudit);
  assert.deepEqual(setup.sqlite.prepare('SELECT * FROM rer_dependency_link ORDER BY interface').all(),links);
  assert.deepEqual(setup.sqlite.prepare("SELECT * FROM rer_dependency_pending WHERE interface='error-sink@1'").get(),approval);
  assert.equal(setup.sqlite.prepare("SELECT completed FROM oa_setup_links WHERE interface='error-sink@1'").get().completed,0);
 }
});

test('only the originating first setup can enable provider sign-in; settings and native claims close eligibility transactionally',async t=>{
 const active=await runtime(t);
 assert.equal((await active.approveSetup()).status,200);
 const original=await active.bootstrap({approve:false}),unrelated=await active.proof();
 const originalActor=await (await active.call('/auth/session',{cookie:original})).json();
 const activeGate=active.pauseLink(),activeCallback=active.rawLink();await activeGate.ready;
 try{assert.equal((await active.call('/auth/signout',{cookie:unrelated,body:{}})).status,204);}finally{activeGate.release();}
 assert.equal((await activeCallback).status,200);
 assert.equal((await active.call('/auth/session',{cookie:original})).status,200);
 assert.equal(setting(active).idp_sign_in,1);assert.equal(setting(active).first_setup,0);
 assert.deepEqual(audit(active).map(row=>({...row})),[{actor_id:originalActor.operator.id,value:'true'}]);
 await login(active);assert.equal((await active.rawLink()).status,403,'completed setup cannot be replayed');
 for(const timing of ['before callback','during redemption','before claim']) {
  const r=await runtime(t),{cookie,actor,gate,pending}=await idpSetup(r,timing);
  const before=setting(r),beforeAudit=audit(r);
  let native;
  try {
   native=await r.proof();const unrelated=await r.proof();
   assert.equal((await r.call('/auth/signout',{cookie:unrelated,body:{}})).status,204);
  }finally{gate?.release();}
  assert.equal((await (pending??r.rawLink('error-sink@1'))).status,200,timing);
  for(const session of [cookie,native])assert.equal((await r.call('/auth/session',{cookie:session})).status,200);
  assert.deepEqual(setting(r),before);assert.deepEqual(audit(r),beforeAudit);
  assert.deepEqual(beforeAudit.map(row=>({...row})),[{actor_id:actor.operator.id,value:'true'}]);
  assert.equal(r.sqlite.prepare('SELECT count(*) n FROM rer_dependency_link').get().n,2);
  assert.equal(r.sqlite.prepare('SELECT count(*) n FROM rer_dependency_pending').get().n,0);
  assert.equal((await r.rawLink('error-sink@1')).status,403,'completed sibling setup cannot be replayed');
 }
 // Both unchanged off and unchanged on finish setup without generation/audit churn.
 for(const enabled of [false,true]) {
  const r=await runtime(t),owner=await r.bootstrap();
  if(enabled)assert.equal((await r.rawLink()).status,200);
  const before=setting(r),beforeAudit=audit(r);
  assert.equal((await r.call('/auth/settings/identity',{cookie:owner,body:{idpSignIn:enabled}})).status,200);
  assert.deepEqual(setting(r),{...before,first_setup:0});assert.deepEqual(audit(r),beforeAudit);
  assert.equal((await r.link()).status,200);assert.equal(setting(r).idp_sign_in,Number(enabled));assert.deepEqual(audit(r),beforeAudit);
 }
 const paused=await runtime(t),owner=await paused.bootstrap(),gate=paused.pauseLink(),callback=paused.rawLink();await gate.ready;
 try{assert.equal((await paused.call('/auth/settings/identity',{cookie:owner,body:{idpSignIn:false}})).status,200);}finally{gate.release();}
 assert.equal((await callback).status,200);assert.equal(setting(paused).idp_sign_in,0);assert.deepEqual(audit(paused),[]);
 const providerOwner=await runtime(t),nativeOwner=await providerOwner.bootstrap();await providerOwner.rawLink();const providerSession=await login(providerOwner);
 assert.equal((await providerOwner.call('/auth/settings/identity',{cookie:providerSession,body:{idpSignIn:false}})).status,200);
 assert.equal(providerOwner.sqlite.prepare("SELECT count(*) n FROM oa_sessions WHERE kind='oidc' AND revoked_at IS NULL").get().n,0);
 assert.equal((await providerOwner.call('/auth/settings/identity',{cookie:nativeOwner,body:{idpSignIn:true}})).status,200);
 assert.equal((await providerOwner.call('/auth/session',{cookie:providerSession})).status,401);
 // Native claim with no initiating link, then a valid owner-approved late link.
 const native=await runtime(t);await native.bootstrap({approve:false});assert.equal(setting(native).first_setup,0);
 assert.equal((await native.rawLink()).status,403);
 native.sqlite.exec('UPDATE oa_auth_settings SET first_setup=1'); // Legacy stale flag has no originating attempt.
 assert.equal((await native.link()).status,200);assert.equal(setting(native).idp_sign_in,0);assert.deepEqual(audit(native),[]);
 // A preclaim link cannot leave a global eligibility bit for a later relink.
 const ordered=await runtime(t);assert.equal((await ordered.link()).status,200);await ordered.bootstrap({approve:false});
 assert.equal(setting(ordered).first_setup,0);assert.equal((await ordered.link()).status,200);assert.equal(setting(ordered).idp_sign_in,0);
 // Signed native owner claim uses the exact bootstrap SQL adapter as production.
 const signed=await runtime(t),key=await testKeys();
 const handler=createOwnerClaimHandler({db:signed.db,authConfig:signed.config,clientIp:()=> '192.0.2.1',clock:signed.now,...claimConfig(key.publicKey),appOrigin:ORIGIN});
 const token=await signClaim(key.privateKey,{aud:ORIGIN,iat:signed.now()/1000,exp:signed.now()/1000+300});
 assert.equal((await handler(signed.request('/auth/owner-claim',{body:{token}}))).status,303);assert.equal(setting(signed).first_setup,0);
 assert.equal((await signed.link()).status,200);assert.equal(setting(signed).idp_sign_in,0);assert.deepEqual(audit(signed),[]);
 const local=await runtime(t,{local:true}),localProof=createHmac('sha256',local.config.SESSION_SECRET).update('local-cli\0sign-in').digest('hex');
 assert.equal((await local.call('/auth/dependencies/setup',{headers:{'x-rer-local-cli':localProof},body:{issuer:ISSUER}})).status,200);
 await local.bootstrap({approve:false});assert.equal((await local.rawLink()).status,200);assert.equal(setting(local).idp_sign_in,1);
 // Production does not accept the local CLI HMAC as setup authority.
 const unclaimed=await runtime(t),proof=createHmac('sha256',unclaimed.config.SESSION_SECRET).update('local-cli\0sign-in').digest('hex');
 const request=unclaimed.request('/auth/dependencies/setup',{body:{issuer:ISSUER}});request.headers.set('x-rer-local-cli',proof);
 assert.equal((await unclaimed.dependencies().handle(request)).status,403);
});
