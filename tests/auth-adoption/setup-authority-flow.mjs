import assert from 'node:assert/strict';
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
  let beforeSms;
  if(migration.startsWith('0065_')) {
   // The held 0064 installation already has subscriber consent authority and
   // accepted delivery history when SMS is added; none may be reissued.
   const at='2026-10-24T01:00:00.000Z';
   await db.batch([
    db.prepare("INSERT INTO maintenance(id,reference,title,state,starts_at,ends_at,created_by_operator_id,created_at,updated_at) VALUES('synthetic-lamp-1801','SCH-1801','synthetic-lamp-1802','Completed',?,?,'01J00000000000000000000001',?,?)").bind(at,at,at,at),
    db.prepare("INSERT INTO notification_deliveries(id,subscriber_id,maintenance_id,channel,outcome,queued_at,outcome_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES('synthetic-lamp-1803','prior-subscriber','synthetic-lamp-1801','email','delivered',?,?,?,?,'synthetic-lamp-1804','maintenance-notice')").bind(at,at,at,at),
    db.prepare("INSERT INTO notification_delivery_attempts(id,delivery_id,attempt_number,attempted_at,provider_message_id,created_at) VALUES('synthetic-lamp-1805','synthetic-lamp-1803',1,?,'synthetic-lamp-1806',?)").bind(at,at),
   ]);
   beforeSms=[];
   for(const table of ['subscribers','subscriber_components','subscriber_tokens','subscriber_intake','notification_deliveries','notification_delivery_attempts']) {
    const columns=(await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(row=>row.name).join(',');
    beforeSms.push({table,columns,rows:(await db.prepare(`SELECT ${columns} FROM ${table} ORDER BY rowid`).all()).results});
   }
   assert.ok(beforeSms.find(row=>row.table==='subscribers').rows.length);
   assert.ok(beforeSms.find(row=>row.table==='subscriber_tokens').rows.length);
   assert.equal(beforeSms.find(row=>row.table==='notification_deliveries').rows.length,1);
  }
  if(migration.startsWith('0064_'))await db.prepare("INSERT INTO management_tokens(id,name,scope,issuer_id,expires_at,created_at,last_used_at) VALUES('synthetic-lamp-65','synthetic-lamp-66','metrics:write','synthetic-lamp-67',9999999999999,'2026-10-24',123)").run();
  await executeSql(db,await readFile(join(directory,migration),'utf8'));
  if(beforeSms) {
   for(const {table,columns,rows} of beforeSms)assert.deepEqual((await db.prepare(`SELECT ${columns} FROM ${table} ORDER BY rowid`).all()).results,rows,`${table}: populated 0064 authority and delivery history survive the additive SMS upgrade`);
   assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE sms_kind<>0').first()).n,0,'no incumbent subscription silently becomes SMS');
   assert.deepEqual({...await db.prepare('SELECT countries_json,support_contact FROM sms_settings WHERE id=1').first()},{countries_json:'["US","CA"]',support_contact:''});
   for(const table of ['sms_subscriptions','sms_consents','sms_inbound_events','sms_deliveries','sms_reporting_daily'])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0,'SMS upgrade does not manufacture consent, replies or outbound work');
  }
  if(migration.startsWith('0064_'))assert.deepEqual({...await db.prepare("SELECT name,scope,issuer_id,expires_at,last_used_at,read_scope FROM management_tokens WHERE id='synthetic-lamp-65'").first()},{name:'synthetic-lamp-66',scope:'metrics:write',issuer_id:'synthetic-lamp-67',expires_at:9999999999999,last_used_at:123,read_scope:0},'populated 0063 metadata survives upgrade with no implicit read authority');
 }

}

// These migration scenarios belong to the existing ownership-upgrade journey.
// Run them sequentially with isolated storage, without extra test registrations.
export async function setupAuthorityFlow(diagnostic = () => {}) {
 const erase="UPDATE operators SET email='deleted-01j00000000000000000000001@operator.invalid',display_name='Erased operator',deactivated_at=COALESCE(deactivated_at,'2026-10-02T00:00:00.000Z'),updated_at='2026-10-02T00:00:00.000Z' WHERE id='01J00000000000000000000001'";
 const revoke="UPDATE operators SET deactivated_at='2026-10-02T00:00:00.000Z',updated_at='2026-10-02T00:00:00.000Z' WHERE id='01J00000000000000000000001'";
 for(const [state,before] of [['kept',null],['erased',erase],['revoked',revoke]]) {
  diagnostic(`ACCESS-002 setup authority: ${state}`);
  const directory=await mkdtemp(join(process.cwd(),'.lamp-auth-upgrade-'));const runtime=openRuntime(directory);
  try {
   const db=await runtime.getD1Database('DB');
   const statements=unstable_splitSqlQuery(await readFile('tests/auth-adoption/fixtures/prechange.sql','utf8')).filter(s=>!['BEGIN TRANSACTION;','COMMIT;'].includes(s.trim()));
   const tables=statements.filter(s=>s.trim().startsWith('CREATE TABLE'));
   await executeSql(db,tables.join(';\n'));
   await executeSql(db,'PRAGMA defer_foreign_keys=ON;\n'+statements.filter(s=>!tables.includes(s)).join(';\n'));
   if(before)await executeSql(db,before);
   await executeSql(db,await readFile('migrations/core/0019_operator_auth.sql','utf8'));
   await executeSql(db,await readFile('migrations/core/0020_dependency_approval.sql','utf8'));
   await migrateAfterDependencyApproval(db);
   const auth=authFixture(db);
   const {createLampAuth,requireOperator,registerOperatorRoutes}=await load('tests/auth-adoption/adapter.ts');
   const bindings={DB:db,LAMP_APP_HOST:'app.example.test',SETUP_OPERATOR_EMAIL:'owner@example.test',SESSION_SECRET:secret,SETUP_TOKEN:setupToken,MAIL_FROM_ADDRESS:'lamp@example.test'};
   const lamp=createLampAuth(bindings);const app=new Hono();app.use('/api/app/*',requireOperator(()=>lamp));registerOperatorRoutes(app,()=>lamp,'page.example.test');
   const call=(path,options={})=>app.fetch(auth.request(path,options),bindings);
   const active=(await db.prepare("SELECT id,email FROM oa_operators WHERE status='active' ORDER BY email").all()).results;
   assert.deepEqual(active.map(o=>o.email),state==='kept'?['owner@example.test','second@example.test','third@example.test']:['second@example.test','third@example.test']);
   const cookies={};
   for(const {email} of active){
    cookies[email]=await auth.signIn(email);
    const setup=email==='owner@example.test';
    assert.equal((await (await call('/api/app/session',{cookie:cookies[email]})).json()).operator.isSetupOperator,setup,'setup authority: '+email);
    assert.equal((await call('/api/app/editor-config',{cookie:cookies[email]})).status,setup?200:403,'editor config: '+email);
   }
   if(state!=='kept'){
    const second=active.find(o=>o.email==='second@example.test');
    assert.equal((await call(`/api/app/operators/${second.id}/revoke-access`,{method:'POST',cookie:cookies['third@example.test'],body:{}})).status,204,'no remaining operator is protected as the setup operator');
   }
  }finally{await runtime.dispose();await rm(directory,{recursive:true,force:true});}
 }
}
