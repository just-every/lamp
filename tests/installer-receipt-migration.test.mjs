import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {installationReceipt} from '../scripts/installer/receipt.mjs';
test('an earlier local receipt recovers sender identity from retained runtime bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lamp-old-receipt-'));
 try{
  const git=args=>execFileSync('git',args,{cwd:root,stdio:'pipe'});git(['init']);git(['config','user.email','test@example.test']);git(['config','user.name','Test']);
  const descriptor={projectId:'just-every/lamp',sourceRepository:'https://github.com/just-every/lamp'};
  await writeFile(join(root,'rer-project.json'),JSON.stringify(descriptor));git(['add','.']);git(['commit','-m','Source']);
  const input={target:'local',ownerEmail:'owner@example.test',mailProvider:'resend',mailFrom:'status@example.test'};
  const directory=join(root,'.seed/installer');await mkdir(join(directory,'runtime'),{recursive:true});
  await writeFile(join(directory,'local-receipt.json'),JSON.stringify({schema:1,identity:{...descriptor,checkout:await realpath(root),target:input.target,ownerEmail:input.ownerEmail},sourceRevision:'a'.repeat(40),completed:true}));
  await writeFile(join(directory,'runtime/wrangler.json'),JSON.stringify({vars:{MAIL_PROVIDER:'resend',MAIL_FROM_ADDRESS:'status@example.test'}}));
  await assert.rejects(installationReceipt(root,{...input,mailFrom:'replacement@example.test'}),/mail configuration/);
  await installationReceipt(root,input);
  const restored=JSON.parse(await readFile(join(directory,'local-receipt.json'),'utf8'));assert.equal(restored.identity.mailFrom,input.mailFrom);assert.equal(restored.completed,true);assert.equal(restored.sourceRevision,'a'.repeat(40));
 }finally{await rm(root,{recursive:true,force:true});}
});
