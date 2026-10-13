import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {deploymentSpec} from '../scripts/delivery/base/spec.mjs';

test('same-prefix migrations retain collector order and execute with exact SQL hashes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'migration-order-'));
 const db=new DatabaseSync(':memory:');
 try{
  await mkdir(join(root,'dist/server'),{recursive:true});
  await mkdir(join(root,'migrations'));await mkdir(join(root,'empty-migrations'));
  const files={
   '0060_customer_context_engine.sql':'ALTER TABLE context_subjects ADD COLUMN engine TEXT;\n',
   '0060_customer_context.sql':'CREATE TABLE context_subjects (id TEXT PRIMARY KEY);\n',
  };
  for(const [name,sql] of Object.entries(files))await writeFile(join(root,'migrations',name),sql);
  await writeFile(join(root,'dist/server/wrangler.json'),JSON.stringify({compatibility_date:'2026-09-08',d1_databases:[{binding:'DB',migrations_dir:'../../migrations'}]}));
  // The source collector uses Array.sort(): punctuation precedes underscores.
  const expected=Object.keys(files).sort();
  for(const extraDirectory of [false,true]){
   if(extraDirectory)await writeFile(join(root,'dist/server/wrangler.json'),JSON.stringify({compatibility_date:'2026-09-08',d1_databases:[{binding:'DB',migrations_dir:'../../empty-migrations'}]}));
   const spec=await deploymentSpec(root,extraDirectory?{recovery:'Restore the backup before retrying.',extraMigrationDirectories:[{binding:'DB',path:'migrations',prefix:'module-'}]}:{recovery:'Restore the backup before retrying.'});
   assert.deepEqual(spec.migrations.map(x=>x.name),expected.map(name=>(extraDirectory?'module-':'')+name));
   for(const [index,migration] of spec.migrations.entries()){
    const sql=files[expected[index]];
    assert.equal(migration.sql,sql);
    assert.equal(migration.sha256,createHash('sha256').update(sql).digest('hex'));
    if(!extraDirectory)db.exec(migration.sql);
   }
  }
  assert.deepEqual(db.prepare('PRAGMA table_info(context_subjects)').all().map(x=>x.name),['id','engine']);
 }finally{db.close();await rm(root,{recursive:true,force:true})}
});
