import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {installationReceipt} from '../scripts/installer/receipt.mjs';
test('local receipt preserves owner, source, target and sender across resume and source edits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lamp-receipt-'));
 try{
  const git=args=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
  git(['init']);git(['config','user.email','qualification@example.test']);git(['config','user.name','Qualification']);
  await writeFile(join(root,'rer-project.json'),JSON.stringify({projectId:'just-every/lamp',sourceRepository:'https://github.com/just-every/lamp'}));git(['add','.']);git(['commit','-m','Initial source']);
  const input={target:'local',ownerEmail:'owner@example.test',mailProvider:'resend',mailFrom:'status@example.test'};
  await(await installationReceipt(root,input)).complete();
  const before=await readFile(join(root,'.seed/installer/local-receipt.json'),'utf8');
  await writeFile(join(root,'owner-customization.txt'),'Retain owner customization');git(['add','owner-customization.txt']);git(['commit','-m','Owner customization']);
  await installationReceipt(root,input);
  for(const changes of [{ownerEmail:'other@example.test'},{mailProvider:'sendgrid'},{mailFrom:'other@example.test'}])await assert.rejects(installationReceipt(root,{...input,...changes}),/another owner, mail configuration, target or source/);
  const after=JSON.parse(await readFile(join(root,'.seed/installer/local-receipt.json'),'utf8'));
  assert.equal(after.sourceRevision,JSON.parse(before).sourceRevision);assert.equal(after.completed,true);assert.notEqual(after.sourceRevision,after.lastAttemptSourceRevision);
 }finally{await rm(root,{recursive:true,force:true});}
});
