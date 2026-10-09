import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectFiles} from '../scripts/build-delivery-artifact.mjs';
for (const name of ['.env','.env.production','.dev.vars','.dev.vars.production','.npmrc','.yarnrc.yml','.netrc','credentials.json','id_ed25519']) {
 test(`artifact refuses nested ${name}`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'lamp-credentials-'));
  try {await mkdir(join(root,'nested'));await writeFile(join(root,'nested',name),'private');await assert.rejects(collectFiles(root),/credential files/);} finally {await rm(root,{recursive:true,force:true});}
 });
}
test('artifact retains environment and credential handling application modules',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lamp-modules-'));
 try {for(const name of ['environment.js','credentials.js.map','dotenv.js'])await writeFile(join(root,name),'export default {}');assert.equal((await collectFiles(root)).length,3);}finally{await rm(root,{recursive:true,force:true});}
});
