import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {unstable_splitSqlQuery} from 'wrangler';
import {Hono} from 'hono';
import {openRuntime,executeSql} from '../reference-storage/runtime.mjs';
import {load} from '../operator-readiness/runtime.mjs';
import {authFixture,secret,setupToken} from './runtime.mjs';

// Keep the captured starting schema, then bring it through every migration
// required by the current product routes after the explicit auth upgrade.
async function migrateAfterDependencyApproval(db){
 const directory='migrations/core';
 const migrations=(await readdir(directory)).filter(name=>/^\d{4}_.+\.sql$/.test(name)&&Number(name.slice(0,4))>20).sort();
 for(const migration of migrations){
  await executeSql(db,await readFile(join(directory,migration),'utf8'));

 }

}

test('ACCESS-001 TEAM-001 TEAM-002 upgrade preserves identities, history and subscriber authority and destroys legacy credentials',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.lamp-auth-upgrade-'));const runtime=openRuntime(directory);
 try {
  const db=await runtime.getD1Database('DB');
  // Captured from pre-change HEAD and migrations BEFORE implementation edits.
  const fixture=await readFile('tests/auth-adoption/fixtures/prechange.sql','utf8');
  const statements=unstable_splitSqlQuery(fixture).filter(s=>!['BEGIN TRANSACTION;','COMMIT;'].includes(s.trim()));
  const tables=statements.filter(s=>s.trim().startsWith('CREATE TABLE'));
  await executeSql(db,tables.join(';\n'));
  await executeSql(db,'PRAGMA defer_foreign_keys=ON;\n'+statements.filter(s=>!tables.includes(s)).join(';\n'));
  const beforeAudit=(await db.prepare('SELECT * FROM audit_entries').all()).results;
  const beforeTokens=(await db.prepare('SELECT * FROM subscriber_tokens').all()).results;
  await executeSql(db,await readFile('migrations/core/0019_operator_auth.sql','utf8'));
  // A pending approval from the previous auth revision grants no authority after upgrade.
  await db.prepare("INSERT INTO rer_dependency_pending(interface,issuer,approved_by,expires_at,approved_session,approved_version,callbacks) VALUES('oidc-provider@1','https://old-idp.example.test','legacy-owner',9999999999999,'legacy-session',1,'[]')").run();
  await executeSql(db,await readFile('migrations/core/0020_dependency_approval.sql','utf8'));
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM rer_dependency_pending').first()).n,0);
  await migrateAfterDependencyApproval(db);
  const auth=authFixture(db);
  const {createLampAuth,requireOperator,registerOperatorRoutes,createComponentRepository,createComponentsService,registerComponentRoutes,createSubscriberRepository,createSubscribersService,registerSubscriberRoutes}=await load('tests/auth-adoption/adapter.ts');
  const bindings={DB:db,LAMP_APP_HOST:'app.example.test',SETUP_OPERATOR_EMAIL:'owner@example.test',SESSION_SECRET:secret,SETUP_TOKEN:setupToken,MAIL_FROM_ADDRESS:'lamp@example.test'};
  const lamp=createLampAuth(bindings);const app=new Hono();app.use('/api/app/*',requireOperator(()=>lamp));registerOperatorRoutes(app,()=>lamp,'page.example.test');
  // Publication sink is the storage/network boundary; the real route/service/repository write D1.
  registerComponentRoutes(app,createComponentsService(createComponentRepository(db),async()=>{}));
  registerSubscriberRoutes(app,createSubscribersService(createSubscriberRepository(db),{tokenSecret:'prior-subscriber-secret'}));
  const call=(path,options={})=>app.fetch(auth.request(path,options),bindings);
  const eligible=(await db.prepare('SELECT id,email,status,role FROM oa_operators ORDER BY email').all()).results;
  assert.equal(eligible.length,4);assert.equal(eligible.every(o=>o.role==='owner'),true);
  assert.equal((await db.prepare('SELECT idp_sign_in,first_setup FROM oa_auth_settings').first()).first_setup,0);
  assert.equal((await db.prepare('SELECT idp_sign_in FROM oa_auth_settings').first()).idp_sign_in,0);
  assert.deepEqual((await db.prepare('SELECT * FROM audit_entries').all()).results,beforeAudit);
  assert.deepEqual((await db.prepare('SELECT * FROM subscriber_tokens').all()).results,beforeTokens);
  assert.equal((await db.prepare("SELECT evidence_key FROM setup_readiness WHERE step='first-run'").first()).evidence_key,'complete');
  assert.equal((await call('/api/app/operators',{cookie:'lamp_session=01J00000000000000000000060'})).status,401);
  assert.equal((await auth.handle(auth.request('/auth/confirm?token=legacy-token-fixture-aaaaaaaaaaaaaaa'))).status,400);
  const cookies={};
  for(const row of eligible.filter(o=>o.status==='active')){
   cookies[row.email]=await auth.signIn(row.email);
   const response=await call('/api/app/session',{cookie:cookies[row.email]});assert.equal(response.status,200);assert.equal((await response.json()).operator.id,row.id);
  }
  for(const email of ['inactive@example.test','deleted-01j00000000000000000000005@operator.invalid']){
   const count=auth.messages.length;assert.equal((await auth.handle(auth.request('/auth/magic-link',{method:'POST',body:{email}}))).status,202);assert.equal(auth.messages.length,count);
  }
  const owner=eligible.find(o=>o.email==='owner@example.test');
  assert.equal((await call(`/api/app/operators/${owner.id}/revoke-access`,{method:'POST',cookie:cookies['second@example.test']})).status,403);
  const forged=new Request(auth.origin+'/api/app/components',{method:'POST',headers:{Cookie:cookies['owner@example.test'],Origin:'https://attacker.example','Content-Type':'application/json'},body:JSON.stringify({name:'forged'})});
  assert.equal((await app.fetch(forged,bindings)).status,403);
  const component=await call('/api/app/components',{method:'POST',cookie:cookies['third@example.test'],body:{name:'Upgraded actor',description:'',groupId:null,internal:false,displayOrder:0,note:''}});
  assert.equal(component.status,201,`migrated operator can create a real product record: ${await component.clone().text()}`);
  const managed=await call('/manage/v1.manage.prior-manage.NlLnezYyjGOeel4Ol69LbZ2roTyfwuVqTg-zT8JnibU');assert.equal(managed.status,200);assert.equal(managed.headers.has('set-cookie'),false);
  const unsubscribed=await app.fetch(new Request(auth.origin+'/unsubscribe/v1.unsubscribe.prior-unsubscribe.8NHGOaVy7qkNQywROcQbISo2HIbDoKWJI0gmQ981_Oo',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'}),bindings);assert.equal(unsubscribed.status,200);
  assert.equal((await call('/manage/v1.manage.prior-manage.NlLnezYyjGOeel4Ol69LbZ2roTyfwuVqTg-zT8JnibU')).status,404);
  assert.equal((await auth.handle(auth.request('/auth/bootstrap',{method:'POST',body:{token:setupToken,displayName:'Replacement'}}))).status,409);
  const retainedSubscriberTokens=(await db.prepare('SELECT * FROM subscriber_tokens').all()).results;
  assert.ok(retainedSubscriberTokens.length>0,'real subscriber authority remains before operator erasure');
  const second=eligible.find(o=>o.email==='second@example.test');
  assert.equal((await call(`/api/app/operators/${second.id}`,{method:'DELETE',cookie:cookies['owner@example.test']})).status,204);
  assert.equal((await call('/api/app/session',{cookie:cookies['second@example.test']})).status,401);
  const erased=await db.prepare('SELECT email,status FROM oa_operators WHERE id=?').bind(second.id).first();
  assert.equal(erased.status,'inactive');assert.equal(erased.email,`deleted-${second.id.toLowerCase()}@operator.invalid`);
  const targetBefore=await db.prepare('SELECT * FROM oa_operators WHERE id=?').bind(owner.id).first();
  assert.equal((await call(`/api/app/operators/${owner.id}`,{method:'DELETE',cookie:cookies['second@example.test']})).status,401);
  assert.deepEqual(await db.prepare('SELECT * FROM oa_operators WHERE id=?').bind(owner.id).first(),targetBefore);
  assert.equal((await call(`/api/app/operators/${owner.id}`,{method:'DELETE',cookie:cookies['owner@example.test']})).status,204,'setup owner may erase themselves while another owner remains');
  assert.equal((await call('/api/app/session',{cookie:cookies['owner@example.test']})).status,401);
  assert.deepEqual((await db.prepare('SELECT * FROM subscriber_tokens').all()).results,retainedSubscriberTokens,'operator erasure preserves subscriber authority');
  const third=eligible.find(o=>o.email==='third@example.test');
  assert.equal((await call(`/api/app/operators/${third.id}`,{method:'DELETE',cookie:cookies['third@example.test']})).status,409,'last active owner remains recoverable');
  for(const [origin,fetchSite] of [[null,null],['null',null],['https://attacker.example',null],[auth.origin,'cross-site']]){
   const request=auth.request('/api/app/session/signout',{method:'POST',cookie:cookies['third@example.test'],body:{}});
   if(origin===null)request.headers.delete('Origin');else request.headers.set('Origin',origin);
   if(fetchSite)request.headers.set('Sec-Fetch-Site',fetchSite);
   const denied=await app.fetch(request,bindings);assert.equal(denied.status,403,'untrusted sign-out is denied');
   assert.equal(denied.headers.has('set-cookie'),false,'denied sign-out retains the browser cookie');
   assert.equal((await call('/api/app/session',{cookie:cookies['third@example.test']})).status,200,'denied sign-out leaves the session active');
  }
  const signout=await call('/api/app/session/signout',{method:'POST',cookie:cookies['third@example.test'],body:{}});assert.equal(signout.status,204);
  assert.equal(/(?:^|;)\s*Max-Age=0(?:;|$)/i.test(signout.headers.get('set-cookie')??''),true,'sign-out expires the browser cookie');
  assert.equal((await call('/api/app/session',{cookie:cookies['third@example.test']})).status,401);
 }finally{await runtime.dispose();await rm(directory,{recursive:true,force:true});}
});
