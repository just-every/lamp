import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createServer} from 'vite';
import {getPlatformProxy} from 'wrangler';

test('real D1 erasure removes only the erased subscriber and leaves other people\'s alerts alone',async()=>{
 const state=await mkdtemp(join(tmpdir(),'lamp-erasure-'));
 const vite=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true}});let platform;
 try{
  execFileSync('pnpm',['exec','wrangler','d1','migrations','apply','DB','--local','--persist-to',state,'--config','wrangler.jsonc'],{stdio:'pipe'});
  platform=await getPlatformProxy({configPath:'wrangler.jsonc',remoteBindings:false,persist:{path:join(state,'v3')}});
  const db=platform.env.DB,{createSubscriberRepository}=await vite.ssrLoadModule('/src/core/features/subscribers/repository.ts');
  const id='01J000000000000000000000E01',operator='01J000000000000000000000E02',now=new Date().toISOString();
  // The erased contact is also an operator's own address, and the destination and contact are substrings of another
  // operator's address and of alert text. Only the alert addressed to this subscription loses its recipient.
  const destination='https://example.test/receiver/mark',contact='ann@example.test';
  const alert={from:'lamp@example.test',recipients:[contact,'joann@example.test','owner@example.test'],title:'Annual check',text:'Marketing hook https://example.test/receiver/marketing failed; joann@example.test is looking.'};
  const own={from:'lamp@example.test',recipients:[contact],title:'Lamp disabled a failing webhook subscription',text:'Lamp stopped sending to this webhook endpoint.'};
  await db.batch([
   db.prepare('INSERT INTO operators(id,email,display_name,is_setup_operator,created_at,updated_at) VALUES(?,?,?,1,?,?)').bind(operator,'owner@example.test','Owner',now,now),
   db.prepare("INSERT INTO subscribers(id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES(?,'webhook',?,?,'active','all','test-token',?,?)").bind(id,destination,contact,now,now),
   db.prepare("INSERT INTO notification_outbox(id,kind,aggregate_id,payload_json,available_at,created_at,updated_at) VALUES(?,'operator-alert','erasure-test',?,?,?,?)").bind('01J000000000000000000000E03',JSON.stringify(alert),now,now,now),
   db.prepare("INSERT INTO notification_outbox(id,kind,aggregate_id,payload_json,available_at,created_at,updated_at) VALUES(?,'operator-alert',?,?,?,?,?)").bind('01J000000000000000000000E04','webhook-deactivated/'+id,JSON.stringify(own),now,now,now),
  ]);
  // The same erasure operation must remove SMS personal authority while an
  // unrelated subscriber keeps exact consent and pending delivery work.
  const smsId='synthetic-lamp-1820',otherSmsId='synthetic-lamp-1821';
  for(const [subscriberId,phone] of [[smsId,'+12025550120'],[otherSmsId,'+12025550121']]) {
   await db.batch([
    db.prepare("INSERT INTO subscribers(id,channel,sms_kind,destination,state,selection_mode,token_hash,created_at,updated_at) VALUES(?,'webhook',1,?,'active','all',?,?,?)").bind(subscriberId,phone,subscriberId+'-hash',now,now),
    db.prepare("INSERT INTO sms_subscriptions(subscriber_id,page_name,opt_in_wording,pending_since) VALUES(?,'synthetic-lamp-1822','synthetic-lamp-1823',?)").bind(subscriberId,now),
    db.prepare("INSERT INTO sms_consents(id,subscriber_id,number,page_name,wording,consented_at) VALUES(?,?,?,'synthetic-lamp-1822','synthetic-lamp-1823',?)").bind(subscriberId+'-consent',subscriberId,phone,now),
    db.prepare("INSERT INTO sms_inbound_events(message_sid,subscriber_id,received_at) VALUES(?,?,?)").bind(subscriberId+'-reply',subscriberId,now),
    db.prepare("INSERT INTO subscriber_tokens(id,subscriber_id,scope,token_hash,created_at,updated_at) VALUES(?,?,'manage',?,?,?)").bind(subscriberId+'-token',subscriberId,subscriberId+'-manage-hash',now,now),
    db.prepare("INSERT INTO sms_deliveries(id,subscriber_id,event_id,kind,outcome,provider_message_id,queued_at) VALUES(?,?,'synthetic-lamp-1824','incident-update','queued',?,?)").bind(subscriberId+'-delivery',subscriberId,subscriberId+'-provider',now),
   ]);
  }
  const otherBefore={};
  for(const table of ['subscribers','subscriber_tokens','sms_subscriptions','sms_consents','sms_inbound_events','sms_deliveries']) {
   const key=table==='subscribers'?'id':'subscriber_id';
   otherBefore[table]=(await db.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).bind(otherSmsId).all()).results;
  }
  await createSubscriberRepository(db).anonymizeAndDeactivate(smsId,operator,now);
  assert.deepEqual({...await db.prepare('SELECT destination,state FROM subscribers WHERE id=?').bind(smsId).first()},{destination:'deleted:'+smsId,state:'deactivated'});
  for(const table of ['sms_subscriptions','sms_consents','sms_inbound_events'])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE subscriber_id=?`).bind(smsId).first()).n,0,`${table} no longer retains erased SMS authority`);
  assert.deepEqual({...await db.prepare('SELECT provider_message_id,outcome FROM sms_deliveries WHERE subscriber_id=?').bind(smsId).first()},{provider_message_id:null,outcome:'suppressed'});
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM subscriber_tokens WHERE subscriber_id=? AND revoked_at IS NULL').bind(smsId).first()).n,0,'erased SMS management authority is revoked');
  for(const [table,rows] of Object.entries(otherBefore)) {
   const key=table==='subscribers'?'id':'subscriber_id';
   assert.deepEqual((await db.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).bind(otherSmsId).all()).results,rows,`${table} preserves the other SMS recipient exactly`);
  }
  await createSubscriberRepository(db).anonymizeAndDeactivate(id,operator,now);
  const subscriber=await db.prepare('SELECT destination,contact_email,state FROM subscribers WHERE id=?').bind(id).first();
  assert.deepEqual(subscriber,{destination:'deleted:'+id,contact_email:null,state:'deactivated'});
  const kept=JSON.parse((await db.prepare("SELECT payload_json FROM notification_outbox WHERE aggregate_id='erasure-test'").first()).payload_json);
  assert.deepEqual(kept,alert);
  const addressed=JSON.parse((await db.prepare('SELECT payload_json FROM notification_outbox WHERE aggregate_id=?').bind('webhook-deactivated/'+id).first()).payload_json);
  assert.deepEqual(addressed,{...own,recipients:[]});
 }finally{await platform?.dispose();await vite.close();await rm(state,{recursive:true,force:true})}
});
