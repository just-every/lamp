import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, stat, symlink, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { installationCredential, installationReceipt, persistLocalEmail, localEmailBindings } from './private.mjs';
import { createState } from './state.mjs';
const origin='https://owner.example';
async function workspace(t){const root=await mkdtemp(join(tmpdir(),'installer-private-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function mode(path, expected){assert.equal((await stat(path)).mode&0o777,expected);}

test('resume tightens private directories and receipts without losing credentials or unknown outcome',async t=>{
 const root=await workspace(t),path=join(root,'.seed/installer/private',createHash('sha256').update(origin).digest('hex')+'.json');
 await mkdir(join(root,'.seed/installer/private'),{recursive:true});
 for(const part of ['.seed','.seed/installer','.seed/installer/private'])await chmod(join(root,part),0o777);
 const saved={origin,token:'existing-secret',accountId:'owner',prefix:'app',operatorNote:'preserve',deployed:false};
 await writeFile(path,JSON.stringify(saved));await chmod(path,0o666);
 const credential=await installationCredential(root,origin,{accountId:'owner',prefix:'app'});
 assert.equal(credential.token,saved.token);assert.equal(credential.deployed,false);
 assert.deepEqual(JSON.parse(await readFile(path,'utf8')),saved);
 for(const part of ['.seed','.seed/installer','.seed/installer/private'])await mode(join(root,part),0o700);
 await mode(path,0o600);
 await chmod(path,0o666);await credential.markDeployed();await mode(path,0o600);
 assert.deepEqual(await installationReceipt(root,origin),{...saved,deployed:true});
});

test('local email updates and reads tighten existing credentials and preserve unrelated content',async t=>{
 const root=await workspace(t),path=join(root,'.dev.vars');
 await writeFile(path,'# owner configuration\nOTHER_SECRET="keep-me"\nEMAIL_API_KEY="old"\n');await chmod(path,0o644);
 await persistLocalEmail(root,{EMAIL_API_KEY:'replacement',EMAIL_PROVIDER:'sendgrid'});
 await mode(path,0o600);
 assert.equal(await readFile(path,'utf8'),'# owner configuration\nOTHER_SECRET="keep-me"\nEMAIL_API_KEY="replacement"\nEMAIL_PROVIDER="sendgrid"\n');
 await chmod(path,0o644);assert.equal((await localEmailBindings(root)).EMAIL_API_KEY,'replacement');await mode(path,0o600);
});

test('state resume and preexisting temporary files are private without losing interrupted state',async t=>{
 const root=await workspace(t),directory=join(root,'.seed/installer');await mkdir(directory,{recursive:true});await chmod(directory,0o777);
 const path=join(directory,'state.json');await writeFile(path,JSON.stringify({product:'test',phase:'running',draft:{name:'owner'}}));await chmod(path,0o644);
 await writeFile(path+'.tmp','stale');await chmod(path+'.tmp',0o666);
 const store=await createState(root,{product:'test',model:{safeKeys:['name']}});
 assert.match(store.state.error,/interrupted/);assert.equal(store.state.draft.name,'owner');await mode(path,0o600);await mode(directory,0o700);
 await store.phase('failed');await mode(path,0o600);assert.equal(JSON.parse(await readFile(path,'utf8')).draft.name,'owner');
});

test('credential writes reject symlinks and hard links without touching unrelated files',async t=>{
 const root=await workspace(t),outside=join(root,'unrelated');await writeFile(outside,'preserve');await chmod(outside,0o644);
 const path=join(root,'.dev.vars');await symlink(outside,path);
 await assert.rejects(persistLocalEmail(root,{EMAIL_API_KEY:'secret'}));await rm(path);await link(outside,path);
 await assert.rejects(persistLocalEmail(root,{EMAIL_API_KEY:'secret'}),/no permissive hard links/);
 assert.equal(await readFile(outside,'utf8'),'preserve');await mode(outside,0o644);
 await mkdir(join(root,'elsewhere'));await symlink(join(root,'elsewhere'),join(root,'.seed'));
 await assert.rejects(installationCredential(root,origin));
 assert.equal(await readFile(outside,'utf8'),'preserve');
});


test('concurrent first receipt creation publishes one complete credential without replacement',async t=>{
 const parent=await workspace(t);
 for(let index=0;index<50;index++){
  const root=join(parent,String(index));await mkdir(root);
  const credentials=await Promise.all(Array.from({length:10},()=>installationCredential(root,origin)));
  assert.equal(new Set(credentials.map(value=>value.token)).size,1);
  assert.equal((await installationReceipt(root,origin)).token,credentials[0].token);
  await Promise.all(credentials.map(value=>value.markDeployed()));
  assert.equal((await installationReceipt(root,origin)).deployed,true);
 }
});


test('already-private hard links remain readable and atomic updates preserve other links',async t=>{
 const root=await workspace(t),other=join(root,'private-staging'),path=join(root,'.dev.vars');
 await writeFile(other,'EMAIL_API_KEY="original"\n',{mode:0o600});await link(other,path);
 assert.equal((await localEmailBindings(root)).EMAIL_API_KEY,'original');
 await persistLocalEmail(root,{EMAIL_API_KEY:'updated'});
 assert.equal(await readFile(other,'utf8'),'EMAIL_API_KEY="original"\n');await mode(other,0o600);
 assert.equal((await localEmailBindings(root)).EMAIL_API_KEY,'updated');await mode(path,0o600);
});

test('a receipt remains resumable after interruption between publication and staging unlink',async t=>{
 const root=await workspace(t),directory=join(root,'.seed/installer/private');await mkdir(directory,{recursive:true});
 const path=join(directory,createHash('sha256').update(origin).digest('hex')+'.json');
 const temporary=path+'.'+'a'.repeat(32)+'.tmp';
 const saved={origin,token:'published-before-crash',deployed:false};
 await writeFile(temporary,JSON.stringify(saved),{mode:0o600});await link(temporary,path);
 const credential=await installationCredential(root,origin);
 assert.equal(credential.token,saved.token);assert.equal(credential.deployed,false);
 await credential.markDeployed();
 assert.deepEqual(await installationReceipt(root,origin),{...saved,deployed:true});
 assert.equal(await readFile(temporary,'utf8'),JSON.stringify(saved));await mode(temporary,0o600);
});
