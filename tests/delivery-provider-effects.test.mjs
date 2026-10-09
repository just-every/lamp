import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {specInputs} from '../scripts/delivery/spec-inputs.mjs';
import {deploymentSpec} from '../scripts/delivery/deployment-spec.mjs';
test('Lamp declares every outbound provider effect even without optional provider configuration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lamp-effects-'));
 try{
  await mkdir(join(root,'dist/server'),{recursive:true});
  await writeFile(join(root,'dist/server/wrangler.json'),JSON.stringify({compatibility_date:'2026-09-08'}));
  const spec=await deploymentSpec(root,specInputs);
  assert.deepEqual(spec.providerEffects,['outbound-mail','ai','outbound-webhooks']);
  assert.deepEqual(spec.publicVariables,{});
 }finally{await rm(root,{recursive:true,force:true});}
});
