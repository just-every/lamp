import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectFiles} from '../scripts/delivery/base/paths.mjs';
test("Artifact packaging rejects private credentials at every nested path and keeps application modules named like them", async t => {
  for (const name of ['.env','.env.production','.dev.vars','.dev.vars.production','.npmrc','.yarnrc.yml','.netrc','credentials.json','id_ed25519']) {
 t.diagnostic(`artifact refuses nested ${name}`);
    await (async()=>{
  const root=await mkdtemp(join(tmpdir(),'lamp-credentials-'));
  try {await mkdir(join(root,'nested'));await writeFile(join(root,'nested',name),'private');await assert.rejects(collectFiles(root,'nested'),/private|credential/i);} finally {await rm(root,{recursive:true,force:true});}
 })(t);
}
 // Application modules named after environment or credential handling still ship.
 const root=await mkdtemp(join(tmpdir(),'lamp-modules-'));
 try {await mkdir(join(root,'nested'));for(const name of ['environment.js','credentials.js.map','dotenv.js'])await writeFile(join(root,'nested',name),'export default {}');assert.equal((await collectFiles(root,'nested')).length,3);}finally{await rm(root,{recursive:true,force:true});}
});
