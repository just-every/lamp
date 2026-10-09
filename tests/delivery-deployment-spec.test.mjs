import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deploymentSpec} from '../scripts/delivery/deployment-spec.mjs';
test('candidate SQL and source-added topology survive declaration with exact hashes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'candidate-spec-'));
 try{
  await mkdir(join(root,'dist/server'),{recursive:true});await mkdir(join(root,'migrations'));
  const sql='ALTER TABLE outbound_email ADD COLUMN bcc_address TEXT;\n';
  await writeFile(join(root,'migrations/0042_bcc.sql'),sql);
  await writeFile(join(root,'dist/server/wrangler.json'),JSON.stringify({compatibility_date:'2026-09-08',compatibility_flags:['nodejs_compat'],d1_databases:[{binding:'DB',migrations_dir:'../../migrations'}],r2_buckets:[{binding:'NEW_ARCHIVE',bucket_name:'ignored-owner-name'}],queues:{producers:[{binding:'NEW_JOBS',queue:'new'},{binding:'FAILED_JOBS',queue:'failed'}],consumers:[{queue:'new',dead_letter_queue:'failed',max_retries:0}]},durable_objects:{bindings:[{name:'NEW_ROOM',class_name:'NewRoom'}]},migrations:[{tag:'room-v1',new_sqlite_classes:['NewRoom'],renamed_classes:[{from:'OldRoom',to:'RenamedRoom'}],transferred_classes:[{from:'SharedRoom',from_script:'source-worker',to:'AdoptedRoom'}]}],triggers:{crons:['*/5 * * * *']},vars:{PUBLIC_MODE:'enabled'}}));
  const spec=await deploymentSpec(root,{publicVariableNames:['PUBLIC_MODE'],optionalSecretNames:['OPTIONAL_PROVIDER_KEY'],recovery:'Backup first'});
  assert.deepEqual(spec.migrations,[{binding:'DB',name:'0042_bcc.sql',sha256:createHash('sha256').update(sql).digest('hex'),sql}]);
  assert.ok(spec.resources.some(x=>x.binding==='NEW_ARCHIVE'));
  assert.equal(spec.queueConsumers[0].deadLetterBinding,'FAILED_JOBS');
  assert.equal(spec.durableObjects[0].className,'NewRoom');
  assert.deepEqual(spec.durableObjectMigrations[0].renamedClasses,[{from:'OldRoom',to:'RenamedRoom'}]);
  assert.deepEqual(spec.durableObjectMigrations[0].transferredClasses,[{from:'SharedRoom',fromScript:'source-worker',to:'AdoptedRoom'}]);
  assert.deepEqual(spec.schedules,['*/5 * * * *']);
  assert.ok(!JSON.stringify(spec).includes('ignored-owner-name'));
  await assert.rejects(deploymentSpec(root,{recovery:'Backup first'}),/Undeclared public/);
  await writeFile(join(root,'dist/server/wrangler.json'),JSON.stringify({kv_namespaces:[{binding:'NEW_KV',id:'owner-id'}]}));
  await assert.rejects(deploymentSpec(root,{recovery:'Backup first'}),/Unsupported deployment binding/);
 }finally{await rm(root,{recursive:true,force:true})}
});
