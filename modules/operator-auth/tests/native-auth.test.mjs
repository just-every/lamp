import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, ORIGIN, KEYS, presets, SETUP } from '../identity/oidc/tests/fake-runtime.mjs';
import { fixture as nativeFixture } from './native/accounts.mjs';
import { hashToken } from '../crypto.mjs';
import { sign } from '../identity/oidc/tests/idp.mjs';
import { createOperatorAuth } from '../index.mjs';
import { createEmailLinkLifecycle } from '../identity/email-link/index.mjs';
import { createOidcProviders, createOidcHandler } from '../identity/oidc/index.mjs';
import { approveLink, rawLink, nativeApprovalJourney, providerApprovalJourney } from './native/dependency-journeys.mjs';
const issuer='https://incumbent.example';
const callback='/api/auth/identity/callback';
const provider={id:'incumbent',preset:'legacy-rs256',issuer,clientId:'native-app',tokenAuthMethod:'client_secret_post',clientSecret:'fixture-only',redirectUri:ORIGIN+callback,endpointPins:{authorization:issuer+'/authorize',token:issuer+'/token',jwks:issuer+'/jwks'}};
const setup=(extra={})=>({native:{},providers:[provider],fakes:[{issuer,clientId:'native-app',keyName:'oktaSigning',method:'client_secret_post',clientSecret:'fixture-only',redirectUri:ORIGIN+callback}],...extra});
const post=(r,path,input={},cookie)=>r.call(path,{method:'POST',input,cookie});
async function email(r,address='owner@example.com',returnTo='/kept') {
  const sent=await post(r,'/auth/magic-link',{email:address,returnTo});assert.equal(sent.status,202,await sent.clone().text());
  return r.link();
}
async function login(r,address='owner@example.com') {
  const response=await post(r,'/auth/confirm',{token:await email(r,address)});assert.equal(response.status,303,await response.clone().text());return r.session(response);
}
const count=async(r,table)=>(await r.db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
async function noOa(r) {const rows=(await r.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'oa_%'").all()).results;for(const name of ['oa_operators','oa_sessions','oa_external_identities','oa_tokens','oa_step_up_challenges','oa_provider_sessions','oa_auth_settings','oa_setup_links'])assert.ok(!rows.some(row=>row.name===name),`${name} must not be installed`);}

test('native email uses native cookie/roles/IDs, inert previews, atomic one-use, restart and signout without OA accounts',async t=>{
  const r=await runtime(t,setup());
  const oldToken='prior-native-session-token';
  await r.db.prepare("INSERT INTO sessions(id,person_id,token_hash,version,kind,created_at,expires_at) VALUES('prior-session','native-owner',?,1,'native',?,?)").bind(await hashToken('fixture-native-session-secret-32-bytes','session',oldToken),Date.now()-86400000,Date.now()+86400000).run();
  const oldCookie='native_staff='+oldToken;
  assert.equal((await r.call('/auth/session',{cookie:oldCookie})).status,200,'pre-existing native session survives composition');
  const unknown=await post(r,'/auth/magic-link',{email:'unknown@example.com'});assert.equal(unknown.status,202);assert.equal(await count(r,'proofs'),0);
  const token=await email(r,'contact@example.com','//foreign.example/steal');
  assert.deepEqual(await unknown.json(),{status:'accepted'});
  for(const method of ['GET','HEAD']) {const p=await r.call('/auth/confirm?token='+token,{method});assert.equal(p.status,200);assert.equal(p.headers.get('set-cookie'),null);}
  assert.equal(await count(r,'sessions'),1);
  const proof=await r.db.prepare('SELECT * FROM proofs').first();assert.notEqual(proof.hash,token);assert.ok(!JSON.stringify(proof).includes(token));
  assert.equal((await r.call('/auth/confirm',{method:'POST',input:{token},headers:{Origin:'https://foreign.example'}})).status,403);
  await r.restart();
  const results=await Promise.all([post(r,'/auth/confirm',{token}),post(r,'/auth/confirm',{token})]);assert.deepEqual(results.map(x=>x.status).sort(),[303,400]);
  const success=results.find(x=>x.status===303);assert.equal(success.headers.get('location'),'/app');const cookie=r.session(success);assert.ok(cookie.startsWith('native_staff='));
  const session=await r.call('/auth/session',{cookie});assert.equal(session.status,200);const value=await session.json();assert.equal(value.hash,undefined);assert.equal(value.operator.id,'native-contact');assert.equal(value.operator.role,'contact');
  await r.restart();assert.equal((await r.call('/auth/session',{cookie})).status,200);
  assert.equal((await post(r,'/auth/signout',{},cookie)).status,204);assert.equal((await r.call('/auth/session',{cookie})).status,401);
  assert.equal((await post(r,'/auth/confirm',{token})).status,400);assert.equal((await r.call('/auth/session',{cookie:oldCookie})).status,200);await noOa(r);
});

test('native proof lifecycle refuses failed mail, stale authority, domain changes and expired links; keeps uniform rate limits',async t=>{
  const r=await runtime(t,setup());
  for(const status of ['rejected','uncertain','exception']) {
    await post(r,'/__fake/mail',{status});assert.equal((await post(r,'/auth/magic-link',{email:'owner@example.com'})).status,503);
    assert.equal((await post(r,'/auth/confirm',{token:await r.link()})).status,400);
  }
  await post(r,'/__fake/mail',{status:'accepted'});
  const token=await email(r);await r.db.prepare("UPDATE people SET version=version+1 WHERE id='native-owner'").run();assert.equal((await post(r,'/auth/confirm',{token})).status,400);
  const removed=await email(r);await r.db.prepare("UPDATE people SET status='inactive' WHERE id='native-owner'").run();assert.equal((await post(r,'/auth/confirm',{token:removed})).status,400);
  const restricted=await email(r,'contact@example.com');await r.db.prepare("INSERT INTO domains VALUES('example.com','incumbent')").run();assert.equal((await post(r,'/auth/confirm',{token:restricted})).status,403);
  await r.db.prepare("UPDATE people SET status='active' WHERE id='native-owner'").run();const owner=await email(r);assert.equal((await post(r,'/auth/confirm',{token:owner})).status,303,'owner exempt');
  const expires=await email(r);await r.clock(3600001);assert.equal((await post(r,'/auth/confirm',{token:expires})).status,400);
  const limited=await runtime(t,setup({core:{ipLimit:2,emailLimit:2}}));
  for(const address of ['unknown@example.com','owner@example.com'])assert.equal((await post(limited,'/auth/magic-link',{email:address})).status,202);
  assert.equal((await post(limited,'/auth/magic-link',{email:'another@example.com'})).status,429);await noOa(r);
});

test('native step-up binds the asking session and current account version, expires and cannot come from provider authentication',async t=>{
  const r=await runtime(t,setup());const first=await login(r),second=await login(r);
  assert.equal((await r.call('/test/guard/export',{cookie:first})).status,200,'ordinary email confirms a local proof');
  await r.clock(601000);
  assert.equal((await r.call('/test/guard/export',{cookie:first})).status,403);
  await post(r,'/auth/step-up',{action:'export',returnTo:'/export'},first);const token=await r.link();
  assert.equal((await post(r,'/auth/confirm',{token},second)).status,400);
  const confirmations=await Promise.all([post(r,'/auth/confirm',{token},first),post(r,'/auth/confirm',{token},first)]);assert.deepEqual(confirmations.map(x=>x.status).sort(),[303,400]);
  assert.equal((await r.call('/test/guard/export',{cookie:first})).status,200);assert.equal((await r.call('/test/guard/export',{cookie:second})).status,403);
  await r.restart();assert.equal((await r.call('/test/guard/export',{cookie:first})).status,200);
  await r.clock(1202000);assert.equal((await r.call('/test/guard/export',{cookie:first})).status,403);await r.clock(601000);
  await post(r,'/auth/step-up',{action:'export'},second);const revoke=await r.link();await post(r,'/auth/signout',{},second);assert.equal((await post(r,'/auth/confirm',{token:revoke},second)).status,400);
  await r.db.prepare("UPDATE people SET version=version+1 WHERE id='native-owner'").run();assert.equal((await r.call('/test/guard/export',{cookie:first})).status,401);
  const providerSession=await r.login('incumbent');assert.equal(providerSession.status,303);const cookie=r.session(providerSession);assert.equal((await r.call('/test/guard/export',{cookie})).status,403);
  await post(r,'/__fake/mail',{status:'uncertain'});assert.equal((await post(r,'/auth/step-up',{action:'export'},cookie)).status,503);
  assert.equal((await post(r,'/auth/confirm',{token:await r.link()},cookie)).status,400);
  await post(r,'/__fake/mail',{status:'accepted'});
  assert.equal((await r.stepUp(cookie,'export')).status,303);assert.equal((await r.call('/test/guard/export',{cookie})).status,200);
  await r.db.prepare("UPDATE people SET status='inactive' WHERE id='native-owner'").run();assert.equal((await r.call('/test/guard/export',{cookie})).status,401);await noOa(r);
});

test('native pinned RS256 incumbent signs in at its selected callback, preserves sessions and binding, revokes passwords and caps provider sessions',async t=>{
  const r=await runtime(t,setup());const contactPassword=await post(r,'/test/password',{operatorId:'native-contact'});assert.equal(contactPassword.status,204,'unbound native password is retained');
  const password=await post(r,'/test/password',{operatorId:'native-owner'});assert.equal(password.status,204);const passwordCookie=r.session(password);
  assert.equal((await r.call('/auth/session',{cookie:passwordCookie})).status,200);
  const old=await login(r);const flow=await r.flow('incumbent',{sub:'incumbent-owner'});
  assert.equal(new URL(flow.location).searchParams.get('redirect_uri'),ORIGIN+callback);await r.restart();
  const response=await r.finish(flow);assert.equal(response.status,303,await response.clone().text());const cookie=r.session(response);
  assert.equal((await r.call('/auth/session',{cookie:old})).status,200);assert.equal((await r.call('/test/editor',{cookie})).status,200);
  assert.equal((await r.call('/auth/session',{cookie:passwordCookie})).status,401,'the previous password session loses authority with the binding');
  assert.equal((await r.call('/auth/session',{cookie:r.session(contactPassword)})).status,200,'another person keeps password authority');
  assert.equal((await r.finish(flow)).status,400);assert.equal((await post(r,'/test/password',{operatorId:'native-owner'})).status,400);
  assert.equal((await r.db.prepare("SELECT password FROM people WHERE id='native-owner'").first()).password,0);
  await r.db.prepare("INSERT INTO bindings VALUES(?,'another','native-owner')").bind(issuer).run();assert.equal((await r.call('/test/editor',{cookie})).status,403);
  await r.clock(86400001);assert.equal((await r.call('/auth/session',{cookie})).status,401);assert.equal((await r.call('/auth/session',{cookie:old})).status,200);await noOa(r);
});

test('direct lifecycle and composed native/OA services run one completion hook and durably revoke a refused session',async t=>{
  for(const mode of ['direct','native','oa']) {
    const native=mode==='oa'?{}:{native:{standaloneEmail:mode==='direct'}};
    const hooks={reviewFor:'owner@example.com',refuseFor:'owner@example.com'};
    const r=await runtime(t,setup({...native,hooks,...(mode==='oa'?{native:undefined}: {})}));
    if(mode==='oa')await r.bootstrap();
    const table=mode==='oa'?'oa_sessions':'sessions';
    for(const method of ['email','oidc']) {
      const response=method==='email'?await post(r,'/auth/confirm',{token:await email(r)}):await r.login('incumbent');
      assert.equal(response.status,403,`${mode} ${method}: ${await response.clone().text()}`);
      assert.notEqual(response.headers.get('set-cookie')?.includes(mode==='oa'?'__Host-operator_session=':'native_staff='),true);
      const calls=(await r.db.prepare('SELECT session_id FROM fixture_hook_calls WHERE method=?').bind(method).all()).results;
      assert.equal(calls.length,1,`${mode} ${method} exactly once`);
      assert.ok((await r.db.prepare(`SELECT revoked_at FROM ${table} WHERE id=?`).bind(calls[0].session_id).first()).revoked_at,`${mode} ${method} persisted revocation`);
    }
  }
  const r=await runtime(t,setup({native:{standaloneEmail:true},hooks:{reviewFor:'owner@example.com',returnTo:'https://foreign.example'}}));
  const response=await post(r,'/auth/confirm',{token:await email(r)});
  assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/app');assert.equal(await count(r,'fixture_hook_calls'),1);
  assert.equal((await r.call('/auth/session',{cookie:r.session(response)})).status,200);
});

test('native server-verified seams preserve association, policy and binding authority without an OIDC transaction pin',async t=>{
  const legacyIssuer='https://legacy.example';
  const r=await runtime(t,setup({providers:[],fakes:[],core:{externalIssuers:[legacyIssuer]},legacy:{issuer:legacyIssuer,subjectEmails:{'legacy-contact':'contact@example.com'}}}));
  const old=await login(r);
  const associated={issuer:legacyIssuer,subject:'legacy-contact',email:'ignored@example.com',emailVerified:false};
  const association=await post(r,'/test/association',associated);assert.equal(association.status,303,await association.clone().text());let cookie=r.session(association);
  let session=await r.call('/auth/session',{cookie});assert.equal(session.status,200);assert.equal((await session.json()).operator.id,'native-contact');
  const verified={issuer:legacyIssuer,subject:'legacy-owner',email:'owner@example.com',emailVerified:true};
  const admitted=await post(r,'/test/verified',verified);assert.equal(admitted.status,303,await admitted.clone().text());let ownerCookie=r.session(admitted);
  const rows=(await r.db.prepare("SELECT provider,linked_at,generation FROM sessions WHERE kind='oidc'").all()).results;
  assert.equal(rows.length,2);for(const row of rows){assert.equal(row.provider,null);assert.equal(row.linked_at,null);assert.equal(row.generation,1);}
  assert.equal((await r.stepUp(cookie,'export')).status,303,'un-pinned server seam sessions still use the native actor fence');
  assert.equal((await r.call('/test/guard/export',{cookie})).status,200);
  await r.restart();assert.equal((await r.call('/auth/session',{cookie})).status,200);
  await r.db.prepare('UPDATE settings SET generation=generation+1').run();
  for(const staleCookie of [cookie,ownerCookie])assert.equal((await r.call('/auth/session',{cookie:staleCookie})).status,401,'policy generation fences server-seam sessions');
  const renewed=await post(r,'/test/association',associated);assert.equal(renewed.status,303);cookie=r.session(renewed);
  const renewedOwner=await post(r,'/test/verified',verified);assert.equal(renewedOwner.status,303);ownerCookie=r.session(renewedOwner);
  assert.equal((await r.call('/auth/session',{cookie})).status,200);
  for(const path of ['/test/association','/test/verified']) {
    const principal=path.endsWith('association')?associated:verified;
    for(const emailVerifiedAt of [Date.now()-31*86400000,Date.now()+600000])assert.equal((await post(r,path,{...principal,emailVerified:true,emailVerifiedAt})).status,403);
  }
  assert.equal((await post(r,'/test/verified',{...verified,email:'contact@example.com'})).status,403,'a changed claim cannot move an existing binding');
  await r.db.prepare("INSERT INTO domains VALUES('example.com','incumbent')").run();
  assert.equal((await post(r,'/test/association',associated)).status,403);
  assert.equal((await post(r,'/test/verified',{...verified,subject:'new-contact',email:'contact@example.com'})).status,403);
  assert.equal((await post(r,'/test/verified',verified)).status,303,'owner remains domain-exempt');
  await r.db.prepare("DELETE FROM domains").run();
  await r.db.prepare("UPDATE people SET version=version+1 WHERE id='native-contact'").run();
  assert.equal((await r.call('/auth/session',{cookie})).status,401,'current native person version fences the old cookie');
  await r.db.prepare("UPDATE people SET status='inactive' WHERE id='native-contact'").run();
  assert.equal((await post(r,'/test/association',associated)).status,403);
  await r.db.prepare("UPDATE people SET status='active' WHERE id='native-contact'").run();
  await r.db.prepare("UPDATE bindings SET person_id='native-owner' WHERE subject='legacy-contact'").run();
  assert.equal((await post(r,'/test/association',associated)).status,403,'association cannot move a binding');
  await r.db.prepare("DELETE FROM bindings WHERE subject='legacy-owner'").run();
  assert.equal((await r.call('/auth/session',{cookie:ownerCookie})).status,401,'stored binding is rechecked');
  assert.equal((await post(r,'/auth/settings/identity',{idpSignIn:false},old)).status,200);
  for(const [path,principal] of [['/test/association',associated],['/test/verified',verified]])assert.equal((await post(r,path,principal)).status,403);
  assert.equal((await r.call('/auth/session',{cookie:old})).status,200);
  await noOa(r);
});

test('native provider proof/mix-up/signature matrix and URI/policy changes fail closed before any session',async t=>{
  const r=await runtime(t,setup());
  for(const claims of [{email_verified:false},{email_verified_at:Math.floor(Date.now()/1000)-31*86400},{email_verified_at:Math.floor(Date.now()/1000)+601},{email_verified_at:'yesterday'},{email_verified_at:null},{iss:'https://wrong.example'},{aud:'wrong'},{nonce:'$other'},{email:'outside@example.com'}]) {
    const response=await r.login('incumbent',claims);assert.equal(response.status,('iss' in claims||'aud' in claims||'nonce' in claims)?400:403,JSON.stringify(claims));
  }
  await r.set(issuer,{corruptSignature:true});assert.equal((await r.login('incumbent')).status,400);await r.set(issuer,{corruptSignature:false});
  for(const alg of ['none','HS256','ES256']) {await r.set(issuer,{header:{alg}});assert.equal((await r.login('incumbent')).status,400);}await r.set(issuer,{header:{}});
  const wrong=await r.flow('incumbent');assert.equal((await r.call('/auth/oidc/incumbent/callback?state='+wrong.state+'&code='+wrong.code,{cookie:wrong.cookie})).status,404);assert.equal((await r.finish(wrong,{cookie:undefined})).status,400);
  const changed=await r.flow('incumbent');await r.configure('incumbent',{redirectUri:ORIGIN+'/another/callback'});assert.equal((await r.finish(changed)).status,404);assert.equal((await r.call('/another/callback?state='+changed.state+'&code='+changed.code,{cookie:changed.cookie})).status,400);
  await r.configure('incumbent',{redirectUri:ORIGIN+callback});const policy=await r.flow('incumbent');await r.db.prepare('UPDATE settings SET generation=generation+1').run();assert.equal((await r.finish(policy)).status,403);
  assert.equal(await count(r,'sessions'),0);
  const fresh=await r.login('incumbent');assert.equal(fresh.status,303);const staleBound=await r.login('incumbent',{email_verified_at:Math.floor(Date.now()/1000)-31*86400});assert.equal(staleBound.status,403);
  const owner=await login(r);assert.equal((await post(r,'/auth/settings/identity',{idpSignIn:false},owner)).status,200);assert.equal((await r.call('/auth/session',{cookie:r.session(fresh)})).status,401);await noOa(r);
});

test('native opt-in and explicit callback configuration refuse partial adapters, unsupported capabilities and conflicting/foreign URLs',async t=>{
  const options={db:{prepare(){throw new Error('No account DB query allowed');}},clientIp:()=> 'test',config:{origin:ORIGIN,OWNER_EMAIL:'owner@example.com',SESSION_SECRET:'test-session-secret-32-bytes-value'}};
  for(const injection of [{accounts:{}},{proofs:{}},{accounts:null,proofs:null},{accounts:undefined},{proofs:undefined}])assert.throws(()=>createOperatorAuth({...options,...injection}),/adapter/);
  const partial=nativeFixture(options.db,Date.now,{noDependencies:true});
  const nativeAuth=createOperatorAuth({...options,...partial});
  await assert.rejects(nativeAuth.authorizeDependencySetup(new Request(ORIGIN),{token:SETUP}),{code:'native_capability_unavailable',status:501});
  assert.throws(()=>createOperatorAuth({...options,...partial,config:{...options.config,dependencies:true}}),/native_dependency_capability_required/);
  assert.throws(()=>createOperatorAuth({...options,...partial,accounts:{...partial.accounts,bootstrap:'invalid'}}),/invalid_native_adapter/);
  assert.throws(()=>createOperatorAuth({...options,...partial,proofs:{...partial.proofs,consumeLink:null}}),/invalid_native_adapter/);
  const persistence={...partial.proofs,authenticate(){},requiredProvider(){},byEmail(){},authorizedLink(){}};
  const direct={...options,persistence,hash:async()=> 'digest',hooks:{afterConfirm(){throw new Error('veto');}}};
  assert.throws(()=>createEmailLinkLifecycle(direct),/invalid_confirmation_hooks/,'a veto without revocation authority refuses construction');
  assert.throws(()=>createEmailLinkLifecycle({...direct,afterConfirm:async(_request,value)=>value}),/invalid_confirmation_hooks/,'a wrapper cannot silently replace a supplied veto');
  for(const redirectUri of ['https://foreign.example/callback','https://user:pass@app.example/callback',ORIGIN+'/callback?q=1',ORIGIN+'/callback#hash',ORIGIN+'/auth/oidc/incumbent/start',ORIGIN+'/auth/owner-claim',ORIGIN+'/auth/dev/enter',ORIGIN+'/__dev/personas',ORIGIN+'/__dev/key']) {
    assert.throws(()=>createOidcProviders({db:options.db,admission:{admit:async()=>{}},clientIp:options.clientIp,config:{origin:ORIGIN,transactionSecret:'fixture-transactions-secret-32-bytes',providers:[{...provider,redirectUri}]}}),/configuration/);
  }
  assert.throws(()=>createOidcProviders({db:options.db,admission:{admit:async()=>{}},clientIp:options.clientIp,config:{origin:ORIGIN,transactionSecret:'fixture-transactions-secret-32-bytes',providers:[provider,{...provider,id:'other'}]}}),/configuration/);
  const oidc=createOidcProviders({db:options.db,admission:{admit:async()=>{}},clientIp:options.clientIp,config:{origin:ORIGIN,transactionSecret:'fixture-transactions-secret-32-bytes',providers:[provider]}});
  assert.equal(await createOidcHandler(oidc)(new Request(ORIGIN+'/unconfigured/callback')),null);
  const r=await runtime(t,setup({native:{noLocal:true,noSettings:true}}));const cookie=await login(r);
  for(const [path,input] of [['/auth/bootstrap',{}],['/auth/invite',{email:'x@example.com',role:'owner'}],['/auth/operator/role',{operatorId:'native-contact',role:'owner'}],['/auth/setup-complete',{}],['/auth/settings/identity',{idpSignIn:true}],['/test/password',{operatorId:'native-contact'}]])assert.equal((await post(r,path,input,cookie)).status,501,path);
  const local=await runtime(t,setup({providers:[],fakes:[],core:{local:true,origin:'http://127.0.0.1:8787',review:{enabled:true,operatorEmail:'contact@example.com'}}}));
  const review=await post(local,'/auth/review-session');assert.equal(review.status,303);assert.equal((await local.call('/auth/session',{cookie:local.session(review)})).status,200);
  await local.db.prepare("INSERT INTO domains VALUES('example.com','incumbent')").run();assert.equal((await post(local,'/auth/review-session')).status,403);
  const custom=await runtime(t,setup({native:{ownerRole:'workspace-owner'},providers:[],fakes:[],hooks:{reviewFor:'owner@example.com',returnTo:'https://foreign.example/steal'}}));
  await custom.db.prepare("UPDATE people SET role='workspace-owner' WHERE id='native-owner'").run();
  await custom.db.prepare("INSERT INTO domains VALUES('example.com','incumbent')").run();
  const customReply=await post(custom,'/auth/confirm',{token:await email(custom)});assert.equal(customReply.headers.get('location'),'/app','hook return remains same-origin');const customCookie=custom.session(customReply);const nativeOwner=await (await custom.call('/auth/session',{cookie:customCookie})).json();assert.equal(nativeOwner.operator.role,'workspace-owner');
  const bootstrap=await runtime(t,setup({native:{bootstrap:true},providers:[],fakes:[]}));await bootstrap.db.prepare('DELETE FROM people').run();await bootstrap.db.prepare('UPDATE settings SET first_setup=1,idp_sign_in=0').run();
  const claims=await Promise.all([post(bootstrap,'/auth/bootstrap',{token:SETUP,displayName:'Owner'}),post(bootstrap,'/auth/bootstrap',{token:SETUP,displayName:'Owner'})]);assert.deepEqual(claims.map(r=>r.status).sort(),[303,409]);assert.equal(await count(bootstrap,'people'),1);assert.equal(await count(bootstrap,'sessions'),1);
  assert.deepEqual(await bootstrap.db.prepare('SELECT first_setup,idp_sign_in FROM settings').first(),{first_setup:0,idp_sign_in:0},'bootstrap without setup provenance closes eligibility');
  await noOa(r);
});

test('native linked Auth uses selected native owner roles and local proof for settings, approval and unlink, and logout/fence reach native sessions',async t=>{
  for(const ownerRole of ['owner','workspace-owner']) await t.test(ownerRole,async t=>{
    const base=presets();const authFake=base.fakes[0];const r=await runtime(t,setup({native:{ownerRole},core:{dependencies:true},dependencyIssuer:authFake.issuer,fakes:[...setup().fakes,authFake]}));
    await r.db.prepare("UPDATE people SET role=? WHERE id='native-owner'").bind(ownerRole).run();
    await r.db.prepare("INSERT INTO people(id,workspace,email,role) VALUES('a-other-owner','workspace-b','other@example.com',?)").bind(ownerRole).run();
    const owner=await login(r),contact=await login(r,'contact@example.com');
    const unsupported=await post(r,'/auth/dependencies/setup',{issuer:authFake.issuer,token:SETUP});
    assert.equal(unsupported.status,501);assert.deepEqual(await unsupported.json(),{error:'native_capability_unavailable'});
    for(const table of ['rer_dependency_keys','rer_dependency_pending','rer_dependency_codes'])assert.equal(await count(r,table),0,'unsupported setup leaves '+table+' untouched');
    assert.equal((await r.call('/.well-known/rer-dependencies')).status,200);
    assert.equal((await rawLink(r,authFake.issuer)).status,403,'configured issuer cannot link without app approval');
    await approveLink(r,authFake.issuer,owner);
    const grant=await (await post(r,'/__fake/link-code')).json();
    await post(r,'/__fake/link-pause');
    const first=post(r,'/.well-known/rer-link/callback',{issuer:authFake.issuer,code:grant.code});
    await post(r,'/__fake/link-ready');
    let second;try {second=await post(r,'/.well-known/rer-link/callback',{issuer:authFake.issuer,code:grant.code});}finally{await post(r,'/__fake/link-release');}
    const links=[await first,second];
    assert.deepEqual(links.map(x=>x.status).sort(),[200,409]);
    const page=await r.call('/signin');const html=await page.text();assert.match(html,/incumbent\/start/);assert.match(html,/auth\/start/);
    assert.equal((await r.call('/.well-known/rer-dependencies')).status,200);
    assert.equal((await rawLink(r,authFake.issuer)).status,403,'unchanged links need a new local approval');
    await nativeApprovalJourney(r,authFake.issuer,owner,ownerRole);
    assert.equal((await r.call('/auth/settings/identity',{cookie:owner})).status,200);
    for(const [path,input] of [['/auth/settings/identity',{idpSignIn:false}],['/auth/dependencies/relink',{issuer:authFake.issuer}],['/auth/dependencies/unlink',{}]]) {
      assert.equal((await post(r,path,{...input,ownerRole:'contact',role:ownerRole,owner:true},contact)).status,403,'HTTP input cannot select an owner');
    }
    for(const idpSignIn of [false,true]) assert.equal((await post(r,'/auth/settings/identity',{idpSignIn,ownerRole:'contact'},owner)).status,200,'the configured current owner can change identity policy');
    assert.equal((await r.stepUp(owner,'providers:relink')).status,303);
    assert.equal((await post(r,'/auth/dependencies/relink',{issuer:authFake.issuer},owner)).status,200);
    const approved=await (await post(r,'/__fake/link-code')).json();
    assert.equal((await post(r,'/.well-known/rer-link/callback',{issuer:authFake.issuer,code:approved.code})).status,200,'the configured owner approval survives redemption');
    assert.equal(await count(r,'rer_dependency_pending'),0);
    const token=await r.login('auth',{sid:'provider-session',role:'contact',ownerRole:'contact',owner:false});assert.equal(token.status,303,await token.clone().text());const providerCookie=r.session(token),emailCookie=await login(r);
    assert.equal((await (await r.call('/auth/session',{cookie:providerCookie})).json()).operator.role,ownerRole,'provider claims cannot select a native role');
    assert.equal((await post(r,'/auth/dependencies/unlink',{},providerCookie)).status,403,'provider sign-in does not supply local proof');
    await providerApprovalJourney(r,authFake.issuer,providerCookie);
    const logout=async(overrides={},fence=false)=>post(r,'/auth/oidc/auth/logout',{logout_token:await sign(KEYS.authSigning,{iss:authFake.issuer,aud:authFake.clientId,sub:'operator-subject',sid:'provider-session',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,jti:crypto.randomUUID(),events:{[fence?'https://runeditrun.com/events/identity-fence':'http://schemas.openid.net/event/backchannel-logout']:{}},...overrides},{typ:'logout+jwt'})});
    assert.equal((await logout({nonce:'bad'})).status,400);
    const jti=crypto.randomUUID();assert.equal((await logout({jti})).status,204);assert.equal((await logout({jti})).status,409);
    assert.equal((await r.call('/auth/session',{cookie:providerCookie})).status,401);assert.equal((await r.call('/auth/session',{cookie:emailCookie})).status,200);
    assert.equal((await logout({},true)).status,204);assert.equal((await r.call('/auth/session',{cookie:emailCookie})).status,401);
    const fresh=await login(r);await r.clock(601000);
    assert.equal((await post(r,'/auth/dependencies/unlink',{},fresh)).status,403,'expired local proof cannot unlink');
    assert.equal((await r.stepUp(fresh,'providers:unlink')).status,303);
    await approveLink(r,authFake.issuer,fresh);
    const sector=(await (await r.call('/.well-known/rer-dependencies')).json()).sector_id;
    await r.db.prepare("INSERT INTO domains VALUES('example.org','auth')").run();
    const unlink=await post(r,'/auth/dependencies/unlink',{},fresh);assert.equal(unlink.status,200,await unlink.clone().text());
    for(const table of ['rer_dependency_keys','rer_dependency_pending','rer_dependency_link','domains'])assert.equal(await count(r,table),0);
    assert.equal((await rawLink(r,authFake.issuer)).status,403,'unlink cannot be bypassed by provider continuity');
    assert.equal((await (await r.call('/.well-known/rer-dependencies')).json()).sector_id,sector);await noOa(r);
    await r.db.prepare('DROP TABLE rer_dependency_link').run();const failure=await post(r,'/auth/oidc/auth/start');assert.equal(failure.status,503);assert.deepEqual(await failure.json(),{error:'auth_unavailable'});
  });
});
