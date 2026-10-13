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
  await createSubscriberRepository(db).anonymizeAndDeactivate(id,operator,now);
  const subscriber=await db.prepare('SELECT destination,contact_email,state FROM subscribers WHERE id=?').bind(id).first();
  assert.deepEqual(subscriber,{destination:'deleted:'+id,contact_email:null,state:'deactivated'});
  const kept=JSON.parse((await db.prepare("SELECT payload_json FROM notification_outbox WHERE aggregate_id='erasure-test'").first()).payload_json);
  assert.deepEqual(kept,alert);
  const addressed=JSON.parse((await db.prepare('SELECT payload_json FROM notification_outbox WHERE aggregate_id=?').bind('webhook-deactivated/'+id).first()).payload_json);
  assert.deepEqual(addressed,{...own,recipients:[]});
 }finally{await platform?.dispose();await vite.close();await rm(state,{recursive:true,force:true})}
});
