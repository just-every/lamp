import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, ORIGIN, ISSUER } from './runtime.mjs';
import { sign, keys } from '../../operator-auth/identity/oidc/tests/idp.mjs';
import { LOGOUT_EVENT, FENCE_EVENT } from '../logout.mjs';
import { createEditorConfigHandler } from '../../editor/server/config-response.mjs';
import { dependencyStore, resealDependencyKeys } from '../store.mjs';
import { createDependencies } from '../index.mjs';
import { assertion } from '../crypto.mjs';
import { createPortability } from '../../portability/index.mjs';
import { readFile } from 'node:fs/promises';

async function login(r,claims={}) {
 const start=await r.call('/auth/oidc/auth/start',{body:{}});assert.equal(start.status,303,await start.clone().text());
 const grant=await r.idp.authorize(start.headers.get('location'),claims);
 const result=await r.call(`/auth/oidc/auth/callback?code=${grant.code}&state=${grant.state}`,{cookie:start.headers.get('set-cookie')});
 return result;
}
test('pull linking uses public keys, fixed origin and pinned issuer; concurrent code has one winner; a second interface shares the protocol',async t=>{
 const r=await runtime(t);
 r.sqlite.exec(await readFile(new URL('./fixtures/trigger-writes.sql',import.meta.url),'utf8'));
 await r.bootstrap();
 const doc=await (await r.call('/.well-known/rer-dependencies')).json();
 const jwks=await (await r.call(new URL(doc.jwks_uri).pathname)).json();assert.equal(jwks.keys[0].d,undefined);
 assert.equal((await r.call('/.well-known/rer-link/callback',{origin:'https://other.example',body:{issuer:ISSUER,code:await r.code()}})).status,403);
 assert.equal((await r.call('/.well-known/rer-link/callback',{body:{issuer:'https://other.example',code:await r.code()}})).status,403);
 const code=await r.code(),body={issuer:ISSUER,code};
 const outcomes=await Promise.all([r.call('/.well-known/rer-link/callback',{body}),r.call('/.well-known/rer-link/callback',{body})]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
 const signedIn=await login(r);assert.equal(signedIn.status,303,await signedIn.clone().text());
 const binding=r.sqlite.prepare('SELECT * FROM oa_external_identities').all();
 assert.equal((await r.link()).status,200);
 assert.equal((await r.dependencies().document()).sector_id,doc.sector_id);assert.deepEqual(r.sqlite.prepare('SELECT * FROM oa_external_identities').all(),binding);
 assert.ok(r.sqlite.prepare("SELECT 1 FROM test_dependency_writes WHERE table_name='rer_dependency_pending'").get(), 'owner approval ran its product trigger');
 assert.ok(r.sqlite.prepare("SELECT 1 FROM test_dependency_writes WHERE table_name='rer_dependency_codes'").get(), 'code consumption ran its product trigger');
 assert.equal((await r.link('error-sink@1')).status,200);assert.equal(r.sqlite.prepare('SELECT count(*) n FROM rer_dependency_link').get().n,2);
 r.metadata.deregister=ISSUER+'/new-remove';assert.equal((await r.rawLink()).status,403);
 const owner=await r.proof();assert.equal((await r.call('/auth/dependencies/relink',{cookie:owner,body:{interface:'oidc-provider@1',issuer:ISSUER}})).status,200);r.identityPaths.push('/new-callback');r.restart();assert.equal((await r.link()).status,403);r.identityPaths.pop();r.restart();assert.equal((await r.link()).status,200);
 assert.equal((await r.call('/auth/dependencies/unlink',{cookie:owner,body:{interface:'oidc-provider@1'}})).status,200);
 assert.equal(r.sqlite.prepare("SELECT count(*) n FROM rer_dependency_keys WHERE interface='oidc-provider@1'").get().n,0);
 assert.equal(r.sqlite.prepare("SELECT needs_relink FROM rer_dependency_link WHERE interface='error-sink@1'").get().needs_relink,0);
});
test('redemption requires the app private key and exact code, origin and callback',async t=>{
 const r=await runtime(t);await r.bootstrap();const code=await r.code(),entry=r.codes.get(code);
 const base={code,origin:ORIGIN,callback:entry.callback};
 for(const proof of [undefined,'unsigned',await assertion((await keys('ES256')).private,{iss:ORIGIN,sub:ORIGIN,aud:ISSUER+'/redeem',exp:r.now()/1000+60})]) {
  const res=await r.fetch(ISSUER+'/redeem',{method:'POST',body:JSON.stringify({...base,client_assertion:proof})});assert.equal(res.status,403);
 }
 assert.equal((await r.call('/.well-known/rer-link/callback',{body:{issuer:ISSUER,code,callback:'https://other.example/callback'}})).status,400);
 assert.equal((await r.call('/.well-known/rer-link/callback',{body:{issuer:ISSUER,code}})).status,200);
});
test('prior install stays off; owner enable/off is durable, idempotent, revokes only provider sessions and never restores them',async t=>{
 const r=await runtime(t,{existing:true}),owner=await r.bootstrap();
 assert.equal((await r.link()).status,200);assert.equal((await r.call('/auth/oidc/auth/start',{body:{}})).status,403);
 assert.equal((await r.call('/auth/settings/identity',{body:{idpSignIn:true}})).status,401);
 assert.equal((await r.call('/auth/settings/identity',{cookie:owner,body:{idpSignIn:true}})).status,200);
 const signed=await login(r);assert.equal(signed.status,303);const cookie=signed.headers.get('set-cookie');
 assert.equal((await r.call('/auth/settings/identity',{cookie:owner,body:{idpSignIn:true}})).status,200);
 assert.equal((await r.call('/auth/session',{cookie})).status,200);
 await r.call('/auth/settings/identity',{cookie:owner,body:{idpSignIn:false}});r.restart();
 assert.equal((await r.call('/auth/session',{cookie})).status,401);assert.equal((await r.call('/auth/session',{cookie:owner})).status,200);
 await r.call('/auth/settings/identity',{cookie:owner,body:{idpSignIn:true}});
 assert.equal((await r.call('/auth/session',{cookie})).status,401);
 const nativeBefore=r.sqlite.prepare('SELECT * FROM oa_sessions WHERE kind=\'native\'').all();
 assert.equal((await login(r,{email_verified_at:r.now()/1000-30*86400})).status,303);
 assert.equal((await login(r,{email_verified_at:r.now()/1000-30*86400-1})).status,403);
 assert.equal((await login(r,{email_verified_at:undefined})).status,403);
 assert.deepEqual(r.sqlite.prepare('SELECT * FROM oa_sessions WHERE kind=\'native\'').all(),nativeBefore);
 const waiting=r.pauseToken(),pending=login(r);await waiting.ready;
 await r.call('/auth/settings/identity',{cookie:owner,body:{idpSignIn:false}});await r.call('/auth/settings/identity',{cookie:owner,body:{idpSignIn:true}});waiting.release();assert.equal((await pending).status,403);
 const fresh=await login(r);r.advance(86400000-1);assert.equal((await r.call('/auth/session',{cookie:fresh.headers.get('set-cookie')})).status,200);
 r.advance(1);assert.equal((await r.call('/auth/session',{cookie:fresh.headers.get('set-cookie')})).status,401);
});
test('strict backchannel logout, durable replay, ID-token events refusal and credential fence affect the intended person',async t=>{
 const r=await runtime(t);const owner=await r.bootstrap();await r.link();const signed=await login(r);const cookie=signed.headers.get('set-cookie');
 const proved=await r.proof();
 const mint=await r.call('/test/credentials',{cookie:proved,body:{}});assert.equal(mint.status,201);const credential=(await mint.json()).token;
 await r.call('/auth/invite',{cookie:owner,body:{email:'other@example.com',displayName:'Other',role:'member'}});
 const invitation=new URL(r.mails.at(-1).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
 const other=await r.call('/auth/confirm',{body:{token:invitation}});assert.equal(other.status,303);
 const otherCookie=other.headers.get('set-cookie'),otherMint=await r.call('/test/credentials',{cookie:otherCookie,body:{}});assert.equal(otherMint.status,201);const otherCredential=(await otherMint.json()).token;
 const legacy=await (await r.call('/test/credentials',{cookie:proved,body:{}})).json();r.sqlite.prepare('UPDATE oa_credentials SET operator_version=NULL WHERE id=?').run(legacy.id);assert.equal((await r.call('/test/credential-use',{bearer:legacy.token})).status,401);
 const nativeFence=await r.auth().credentialFence(r.request('/x',{cookie:proved}));
 const claims={iss:ISSUER,aud:'app-client',sub:'operator-subject',sid:'owner-sid',iat:r.now()/1000,exp:r.now()/1000+300,jti:'logout-1',events:{[LOGOUT_EVENT]:{}}};
 for(const edit of [{events:{wrong:{}}},{events:{}},{events:{[FENCE_EVENT.slice(0,-1)]:{}}},{events:{[LOGOUT_EVENT]:{},[`${FENCE_EVENT}/x`]:{}}},{nonce:null},{jti:''},{sub:'different'},{aud:'wrong'},{sid:'wrong'},{sub:undefined,sid:undefined},{exp:undefined},{iss:'https://other.example'}]) {
  const token=await sign(r.idp.key,{...claims,...edit},{typ:'logout+jwt'});assert.equal((await r.call('/auth/oidc/auth/logout',{body:{logout_token:token}})).status,400);
 }
 const wrong=await sign(await keys('ES256'),claims,{typ:'logout+jwt'});assert.equal((await r.call('/auth/oidc/auth/logout',{body:{logout_token:wrong}})).status,400);
 assert.equal((await login(r,{events:{[LOGOUT_EVENT]:{}}})).status,400);
 const token=await sign(r.idp.key,claims,{typ:'logout+jwt'}),responses=await Promise.all([r.call('/auth/oidc/auth/logout',{body:{logout_token:token}}),r.call('/auth/oidc/auth/logout',{body:{logout_token:token}})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[204,409]);r.restart();assert.equal((await r.call('/auth/oidc/auth/logout',{body:{logout_token:token}})).status,409);
 assert.equal((await r.call('/auth/session',{cookie})).status,401);assert.equal((await r.call('/test/credential-use',{bearer:credential})).status,200);
 assert.equal(await r.auth().checkCredentialFence(nativeFence),true);
 const fence=await sign(r.idp.key,{...claims,jti:'fence-1',events:{[FENCE_EVENT]:{}}},{typ:'logout+jwt'});assert.equal((await r.call('/auth/oidc/auth/logout',{body:{logout_token:fence}})).status,204);
 assert.equal((await r.call('/test/credential-use',{bearer:credential})).status,401);
 assert.equal((await r.call('/test/credential-use',{bearer:otherCredential})).status,200);assert.equal((await r.call('/auth/session',{cookie:otherCookie})).status,200);
 assert.equal(await r.auth().checkCredentialFence(nativeFence),false);assert.equal(await r.auth().checkCredentialFence({personId:nativeFence.personId}),false);assert.equal((await r.call('/auth/session',{cookie:owner})).status,401);
});
test('a preclaim link asks claim scope; install_owner is atomic once per client across race and restart',async t=>{
 const r=await runtime(t);await r.link();const doc=await r.dependencies().document();
 const start=await r.call('/auth/oidc/auth/start',{body:{}});assert.equal(start.status,303);assert.match(new URL(start.headers.get('location')).searchParams.get('scope'),/claim/);
 const token=await sign(r.idp.key,{iss:ISSUER,aud:'app-client',sub:'claim-subject',iat:r.now()/1000,exp:r.now()/1000+300,jti:'claim-1',email:'owner@example.com',email_verified:true,email_verified_at:r.now()/1000,install_owner:{client_id:'app-client',sector_id:doc.sector_id,subject:'claim-subject',email:'owner@example.com'}});
 const results=await Promise.all([r.call('/auth/owner-claim',{body:{token}}),r.call('/auth/owner-claim',{body:{token}})]);assert.deepEqual(results.map(r=>r.status).sort(),[303,409]);
 r.restart();assert.equal((await r.call('/auth/owner-claim',{body:{token}})).status,409);
 assert.equal(r.sqlite.prepare('SELECT count(*) n FROM oa_operators').get().n,1);assert.equal(r.sqlite.prepare('SELECT count(*) n FROM oa_sessions').get().n,1);assert.equal(r.sqlite.prepare('SELECT count(*) n FROM oc_idp_grants').get().n,1);
});

test('archive drops private link keys and sessions; import retains sector and bindings and requires explicit re-link',async t=>{
 const source=await runtime(t);await source.bootstrap();await source.link();await login(source);
 const destination=await runtime(t);
 const policy={product:'test/app',includeTables:['oa_provider_session_pins','oa_operators','oa_bootstrap','oa_external_identities','oa_tokens','oa_invitation_cancellations','oa_auth_settings','oa_auth_audit','oa_domain_rules','oa_logout_events','oc_owner_claims','oc_idp_grants']};
 const migration=await readFile(new URL('../../portability/schema/portability.sql',import.meta.url),'utf8');
 source.sqlite.exec(migration);destination.sqlite.exec(migration);
 const exporter=await createPortability({db:source.db,policy}),importer=await createPortability({db:destination.db,policy});
 const id=await exporter.exports.create();while((await exporter.exports.advance(id,{maxParts:16})).phase==='building'){}
 const text=await new Response(await exporter.exports.download(id)).text(),records=text.trim().split('\n').map(s=>JSON.parse(s));
 const privateKey=source.sqlite.prepare('SELECT private_key FROM rer_dependency_keys').get().private_key;
 assert.equal(text.includes((await dependencyStore(source.db,source.config).readKey()).key.d),false);
 assert.equal(text.includes(privateKey),false);assert.equal(text.includes(source.config.INSTALLATION_KEY),false);
 assert.equal(records[0].tables.some(table=>table.name==='rer_dependency_keys'),false);
 const manifest=records.find(r=>r.kind==='manifest');const restore=await importer.imports.create(manifest);
 for(const part of records.filter(r=>r.kind==='part'))await importer.imports.uploadPart(restore,part.index,part);
 await importer.imports.finalize(restore,{contentHash:records.at(-1).contentHash,archiveHash:records.at(-1).archiveHash});
 assert.equal(destination.sqlite.prepare('SELECT sector_id FROM rer_dependency_installation').get().sector_id,source.sqlite.prepare('SELECT sector_id FROM rer_dependency_installation').get().sector_id);
 assert.equal(destination.sqlite.prepare('SELECT count(*) n FROM rer_dependency_keys').get().n,0);
 assert.equal(destination.sqlite.prepare('SELECT count(*) n FROM oa_sessions').get().n,0);
 assert.equal(destination.sqlite.prepare('SELECT count(*) n FROM oa_provider_session_pins').get().n,0);
 assert.deepEqual(destination.sqlite.prepare('SELECT * FROM oa_external_identities').all(),source.sqlite.prepare('SELECT * FROM oa_external_identities').all());
 assert.equal((await destination.call('/auth/oidc/auth/start',{body:{}})).status,403);
 assert.equal((await destination.link()).status,200);
 assert.equal(destination.sqlite.prepare('SELECT needs_relink FROM rer_dependency_link').get().needs_relink,0);
 assert.equal((await destination.call('/auth/oidc/auth/start',{body:{}})).status,403);
});

test('editor public authorization grants only the current owner and current issuer subject',async t=>{
 const r=await runtime(t),owner=await r.bootstrap();await r.link();
 const endpoint=createEditorConfigHandler({requireOwner:req=>r.auth().requireEditorOwner(req),readConfig:async()=>({enabled:true})});
 const editor=cookie=>endpoint(r.request('/api/editor/config',{cookie}));
 assert.equal((await editor(owner)).status,200);
 const signed=await login(r),cookie=signed.headers.get('set-cookie');assert.equal((await editor(cookie)).status,200);
 const person=r.sqlite.prepare('SELECT id FROM oa_operators').get().id;
 r.sqlite.prepare('UPDATE oa_external_identities SET subject=? WHERE operator_id=?').run('new-subject',person);
 assert.equal((await editor(cookie)).status,403);
 r.sqlite.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('new-owner','next@example.com','Next','owner','active',?)").run(r.now());
 r.sqlite.prepare("UPDATE oa_operators SET role='member' WHERE id=?").run(person);
 assert.equal((await editor(owner)).status,403);
});


test('dependency signing keys are sealed, upgraded once and rotated without losing sign-in; missing keys refuse',async t=>{
 const r=await runtime(t);await r.bootstrap();await r.link();await r.link('error-sink@1');
 const store=()=>dependencyStore(r.db,r.config);
 const key=(await store().installation()).key;
 const raw=()=>r.sqlite.prepare("SELECT private_key FROM rer_dependency_keys WHERE interface='oidc-provider@1'").get().private_key;
 const original=raw(),envelope=JSON.parse(original);
 assert.equal(envelope.version,1);assert.equal(Object.hasOwn(envelope,'d'),false);assert.equal(original.includes(key.d),false);
 assert.equal((await login(r)).status,303);
 // Simulate an existing installation before its sealing migration.
 r.sqlite.exec("UPDATE rer_dependency_installation SET keys_sealed=0,key_ids='[]'");
 // Preserve its registered signing key.
 const sibling=(await store().installation('error-sink@1')).key;
 r.sqlite.prepare('UPDATE rer_dependency_keys SET private_key=? WHERE interface=?').run(JSON.stringify(key),'oidc-provider@1');
 r.sqlite.prepare('UPDATE rer_dependency_keys SET private_key=? WHERE interface=?').run(JSON.stringify(sibling),'error-sink@1');
 assert.equal((await login(r)).status,303);
 const upgraded=raw();assert.equal(JSON.parse(upgraded).version,1);assert.equal(upgraded.includes(key.d),false);
 assert.equal(r.sqlite.prepare("SELECT private_key FROM rer_dependency_keys WHERE interface='error-sink@1'").get().private_key,JSON.stringify(sibling),'a read upgrades only its interface');
 await resealDependencyKeys(r.db,r.config);
 assert.equal(r.sqlite.prepare('SELECT keys_sealed FROM rer_dependency_installation').get().keys_sealed,1);
 assert.equal((await login(r)).status,303);assert.equal(raw(),upgraded,'upgrade is idempotent');
 r.config.INSTALLATION_KEY_PREVIOUS=r.config.INSTALLATION_KEY;r.config.INSTALLATION_KEY=crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'');r.restart();
 assert.equal((await login(r)).status,303);const rotated=raw();assert.notEqual(JSON.parse(rotated).kid,JSON.parse(upgraded).kid);await resealDependencyKeys(r.db,r.config);
 delete r.config.INSTALLATION_KEY_PREVIOUS;r.config.SESSION_SECRET=crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'');r.restart();assert.equal((await login(r)).status,303);assert.equal(raw(),rotated,'session secret rotation leaves the signing key intact');
 const current=r.config.INSTALLATION_KEY;delete r.config.INSTALLATION_KEY;r.restart();
 const refused=await r.call('/auth/oidc/auth/start',{body:{}});assert.equal(refused.status,503);assert.deepEqual(await refused.json(),{error:'installation_key_missing'});assert.equal(raw(),rotated);
 r.config.INSTALLATION_KEY=crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'');r.restart();
 const wrong=await r.call('/auth/oidc/auth/start',{body:{}});assert.equal(wrong.status,503);assert.deepEqual(await wrong.json(),{error:'installation_key_unavailable'});assert.equal(raw(),rotated);
 // Neither malformed envelopes nor ciphertext moved to another interface become plaintext.
 r.config.INSTALLATION_KEY=current;r.sqlite.prepare("UPDATE rer_dependency_keys SET private_key=? WHERE interface='oidc-provider@1'").run(JSON.stringify({...JSON.parse(rotated),ciphertext:'invalid'}));r.restart();
 const corrupt=await r.call('/auth/oidc/auth/start',{body:{}});assert.deepEqual(await corrupt.json(),{error:'installation_key_unavailable'});
 r.sqlite.prepare("UPDATE rer_dependency_keys SET private_key=? WHERE interface='oidc-provider@1'").run(r.sqlite.prepare("SELECT private_key FROM rer_dependency_keys WHERE interface='error-sink@1'").get().private_key);
 const swapped=await r.call('/auth/oidc/auth/start',{body:{}});assert.deepEqual(await swapped.json(),{error:'installation_key_unavailable'});
});


test('an unreadable sibling row leaves healthy sign-in, document, JWKS and link callback working',async t=>{
 for(const damage of ['corrupt','retired']) await t.test(damage,async t=>{
  const r=await runtime(t);await r.bootstrap();await r.link();await r.link('error-sink@1');
  await r.approve('error-sink@1');const badCode=await r.code('error-sink@1');
  const old=r.sqlite.prepare("SELECT private_key FROM rer_dependency_keys WHERE interface='error-sink@1'").get().private_key;
  if(damage==='retired') {
   r.config.INSTALLATION_KEY_PREVIOUS=r.config.INSTALLATION_KEY;r.config.INSTALLATION_KEY=crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'');
   await resealDependencyKeys(r.db,r.config);delete r.config.INSTALLATION_KEY_PREVIOUS;r.restart();
  }
  r.sqlite.prepare("UPDATE rer_dependency_keys SET private_key=? WHERE interface='error-sink@1'").run(damage==='corrupt'?JSON.stringify({...JSON.parse(old),ciphertext:'invalid'}):old);
  const start=await r.call('/auth/oidc/auth/start',{body:{}}),document=await r.call('/.well-known/rer-dependencies'),jwks=await r.call('/.well-known/rer-link/jwks/oidc-provider@1');
  assert.deepEqual([start.status,document.status,jwks.status],[303,200,200]);
  const reordered=createDependencies({db:r.db,...r.config,name:'App',auth:r.auth(),interfaces:[{interface:'error-sink@1',paths:['/errors/callback']},{interface:'oidc-provider@1',paths:r.identityPaths}]});
  assert.equal((await reordered.handle(r.request('/.well-known/rer-dependencies'))).status,200,'the public document needs no interface private key');
  const grant=await r.idp.authorize(start.headers.get('location'));
  assert.equal((await r.call(`/auth/oidc/auth/callback?code=${grant.code}&state=${grant.state}`,{cookie:start.headers.get('set-cookie')})).status,303);
  assert.equal((await r.link()).status,200);
  for(const response of [await r.call('/.well-known/rer-link/jwks/error-sink@1'),await r.call('/.well-known/rer-link/callback',{body:{issuer:ISSUER,interface:'error-sink@1',code:badCode}})]) {
   assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:damage==='retired'?'installation_key_version_unknown':'installation_key_unavailable'});
  }
 });
});

test('a restored pre-rotation row needs the retired key and reopens without changing its public identity',async t=>{
 const r=await runtime(t);await r.bootstrap();await r.link();
 const before=r.sqlite.prepare('SELECT private_key FROM rer_dependency_keys').get().private_key;
 const publicBefore=await (await r.call('/.well-known/rer-link/jwks')).json();
 const retired=r.config.INSTALLATION_KEY;
 r.config.INSTALLATION_KEY_PREVIOUS=retired;r.config.INSTALLATION_KEY=crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'');
 await resealDependencyKeys(r.db,r.config);delete r.config.INSTALLATION_KEY_PREVIOUS;r.restart();
 r.sqlite.prepare('UPDATE rer_dependency_keys SET private_key=?').run(before);
 const refused=await r.call('/auth/oidc/auth/start',{body:{}});assert.equal(refused.status,503);assert.deepEqual(await refused.json(),{error:'installation_key_version_unknown'});
 r.config.INSTALLATION_KEY_PREVIOUS=retired;await resealDependencyKeys(r.db,r.config);delete r.config.INSTALLATION_KEY_PREVIOUS;r.restart();
 assert.equal((await login(r)).status,303);assert.deepEqual(await (await r.call('/.well-known/rer-link/jwks')).json(),publicBefore);
});

test('a whole pre-rotation restore refuses unavailable custody and reports its D1 tail before rekey',async t=>{
 const r=await runtime(t);await r.bootstrap();await r.link();
 const installation=r.sqlite.prepare('SELECT key_ids FROM rer_dependency_installation').get();
 const raw=r.sqlite.prepare('SELECT private_key FROM rer_dependency_keys').get().private_key;
 const retired=r.config.INSTALLATION_KEY;
 r.config.INSTALLATION_KEY_PREVIOUS=retired;r.config.INSTALLATION_KEY=crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'');
 await resealDependencyKeys(r.db,r.config);delete r.config.INSTALLATION_KEY_PREVIOUS;r.restart();
 r.sqlite.prepare('UPDATE rer_dependency_installation SET key_ids=?').run(installation.key_ids);
 r.sqlite.prepare('UPDATE rer_dependency_keys SET private_key=?').run(raw);
 const refused=await r.call('/auth/oidc/auth/start',{body:{}});
 assert.equal(refused.status,503);assert.deepEqual(await refused.json(),{error:'installation_key_unavailable'});
 const diagnostics=[];
 await assert.rejects(resealDependencyKeys(r.db,r.config,{report:status=>diagnostics.push(status)}),{code:'installation_key_unavailable'});
 const ids=JSON.parse(installation.key_ids);
 assert.deepEqual(diagnostics,[{keyIds:ids,tail:ids.at(-1),custody:ids.map(kid=>({kid,available:false}))}]);
 r.config.INSTALLATION_KEY_PREVIOUS=retired;
 await resealDependencyKeys(r.db,r.config,{report:status=>diagnostics.push(status)});
 assert.deepEqual(diagnostics.at(-1).custody,ids.map(kid=>({kid,available:true})));
 delete r.config.INSTALLATION_KEY_PREVIOUS;r.restart();assert.equal((await login(r)).status,303);
});

test('a mid-rotation snapshot reopens with all retired custody and relinks both interfaces without unlinking',async t=>{
 const r=await runtime(t);await r.bootstrap();await r.link();await r.link('error-sink@1');
 const publicBefore=await (await r.call('/.well-known/rer-link/jwks')).json();
 const sector=(await r.dependencies().document()).sector_id, k0=r.config.INSTALLATION_KEY;
 const installation=r.sqlite.prepare('SELECT key_ids FROM rer_dependency_installation').get();
 r.config.INSTALLATION_KEY_PREVIOUS=k0;r.config.INSTALLATION_KEY=crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'');r.restart();
 await dependencyStore(r.db,r.config).readKey('error-sink@1');
 const k1=r.config.INSTALLATION_KEY, snapshot=r.sqlite.prepare('SELECT * FROM rer_dependency_keys ORDER BY interface').all();
 assert.equal(new Set(snapshot.map(row=>JSON.parse(row.private_key).kid)).size,2);
 assert.equal(r.sqlite.prepare('SELECT key_ids FROM rer_dependency_installation').get().key_ids,installation.key_ids);
 await resealDependencyKeys(r.db,r.config);
 r.config.INSTALLATION_KEY_PREVIOUS=k1;r.config.INSTALLATION_KEY=crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'');
 await resealDependencyKeys(r.db,r.config);delete r.config.INSTALLATION_KEY_PREVIOUS;
 for(const previous of [k0,k1]) {
  r.sqlite.prepare('UPDATE rer_dependency_installation SET key_ids=?').run(installation.key_ids);
  for(const row of snapshot)r.sqlite.prepare('UPDATE rer_dependency_keys SET private_key=? WHERE interface=?').run(row.private_key,row.interface);
  r.config.INSTALLATION_KEY_PREVIOUS=previous;
  await resealDependencyKeys(r.db,r.config,{retiredKeys:[k0,k1]});
  delete r.config.INSTALLATION_KEY_PREVIOUS;r.restart();
  assert.equal((await login(r)).status,303);
  for(const contract of ['oidc-provider@1','error-sink@1'])assert.equal((await r.link(contract)).status,200);
  assert.equal((await r.dependencies().document()).sector_id,sector);
  assert.deepEqual(await (await r.call('/.well-known/rer-link/jwks')).json(),publicBefore);
 }
});

test('a fully sealed installation refuses a plaintext signing key injected by a database writer',async t=>{
 const r=await runtime(t);await r.bootstrap();await r.link();
 const key=(await dependencyStore(r.db,r.config).readKey()).key;
 r.sqlite.prepare('UPDATE rer_dependency_keys SET private_key=?').run(JSON.stringify(key));
 const refused=await r.call('/auth/oidc/auth/start',{body:{}});assert.equal(refused.status,503);assert.deepEqual(await refused.json(),{error:'installation_key_unavailable'});
});

test('plaintext-only signing refuses a sealed key with a typed rollback error',async t=>{
 const r=await runtime(t);await r.bootstrap();await r.link();
 const envelope=JSON.parse(r.sqlite.prepare('SELECT private_key FROM rer_dependency_keys').get().private_key);
 await assert.rejects(assertion(envelope,{sub:'rollback'}),e=>e.code==='installation_key_sealed_rollback' && e.status===503);
});

test('installation key custody refuses passphrases outside the generated secret format',async t=>{
 const r=await runtime(t);await r.bootstrap();await r.link();r.config.INSTALLATION_KEY='a guessed passphrase that is comfortably longer than thirty two characters';r.restart();
 const refused=await r.call('/auth/oidc/auth/start',{body:{}});assert.equal(refused.status,503);assert.deepEqual(await refused.json(),{error:'installation_key_missing'});
});

test('sealed rows authenticate the explicit storage purpose, interface, version and key ID',async t=>{
 const r=await runtime(t);await r.bootstrap();await r.link();
 const value=JSON.parse(r.sqlite.prepare('SELECT private_key FROM rer_dependency_keys').get().private_key);
 const root=await crypto.subtle.importKey('raw',new TextEncoder().encode(r.config.INSTALLATION_KEY),'HKDF',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('rer-at-rest-v1'),info:new TextEncoder().encode('rer-at-rest-v1:dependency-key')},root,{name:'AES-GCM',length:256},false,['decrypt']);
 const bytes=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
 const open=aad=>crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(value.iv),additionalData:new TextEncoder().encode(aad),tagLength:128},key,bytes(value.ciphertext));
 const jwk=JSON.parse(new TextDecoder().decode(await open(`rer-at-rest-v1|rer_dependency_keys|oidc-provider@1|1|${value.kid}`)));
 assert.equal(jwk.kid,(await dependencyStore(r.db,r.config).readKey()).key.kid);
 await assert.rejects(open(`rer-at-rest-v1|another_table|oidc-provider@1|1|${value.kid}`));
 await assert.rejects(open(`rer-at-rest-v1|rer_dependency_keys|oidc-provider@1|2|${value.kid}`));
 r.sqlite.prepare('UPDATE rer_dependency_keys SET private_key=?').run(JSON.stringify({...value,kid:crypto.randomUUID()}));
 const tampered=await r.call('/auth/oidc/auth/start',{body:{}});assert.equal(tampered.status,503);assert.deepEqual(await tampered.json(),{error:'installation_key_unavailable'});
});
