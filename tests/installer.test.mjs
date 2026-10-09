import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstaller} from '../scripts/base-onboarding/server.mjs';
import {createSeed} from '../scripts/installer/seed.mjs';
import {createModel} from '../scripts/base-onboarding/ui/model-core.mjs';
import * as browser from '../scripts/installer/ui/seed.mjs';
test('local-first Lamp browser setup saves only nonsecret fields and requires deliberate start',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lamp-installer-'));
 let server;
 try {
  const seed=createSeed();
  server=await startInstaller(root,{seed,noPrefill:true});
  const page=await fetch(server.origin);
  const cookie=page.headers.get('set-cookie').split(';')[0];
  const token=(await page.text()).match(/name="installer-token" content="([^"]+)"/)[1];
  const headers={Cookie:cookie,'x-installer-token':token,Origin:server.origin,'Content-Type':'application/json'};
  const post=(path,value,extra={})=>fetch(server.origin+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(value)});
  assert.equal((await post('/api/draft',{ownerEmail:'owner@example.test',pageName:'Owner lamp'})).status,200);
  assert.equal((await post('/api/draft',{bootstrapSecret:'private-token'})).status,400);
  assert.equal((await post('/api/start',{}, {Origin:'https://untrusted.test'})).status,403);
  const state=await (await fetch(server.origin+'/api/state',{headers})).json();
  assert.equal(state.phase,'ready');
  assert.equal(state.draft.pageName,'Owner lamp');
  const file=join(root,'.seed/installer/state.json');
  assert.equal((await stat(file)).mode&0o777,0o600);
  assert.doesNotMatch(await readFile(file,'utf8'),/private-token|bootstrapSecret|mailApiKey/);
  await server.close();server=undefined;
  server=await startInstaller(root,{seed,resume:true});
  assert.equal(server.state.draft.pageName,'Owner lamp');
  assert.equal(server.state.phase,'ready');
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});
test('server and browser agree on actual local and independent prerequisites',()=>{
 const seed=createSeed();const model=createModel(browser);
 const common={ownerEmail:'owner@example.test',displayName:'Owner',pageName:'Owner page',tagline:'Status',timezone:'UTC',mailProvider:'resend',mailFrom:'status@example.test'};
 for(const input of [{...common,target:'local',mailApiKey:'test-key'},{...common,target:'independent',appOrigin:'https://app.example.test',bootstrapSecret:'a'.repeat(32)}]){
  assert.equal(model.setupModel(input).ready,true);assert.deepEqual(seed.validateInput(input),input);
 }
 assert.throws(()=>seed.validateInput({...common,target:'local'}),/Mail provider API key/i);
 assert.throws(()=>seed.validateInput({...common,target:'independent',appOrigin:'http://app.example.test',bootstrapSecret:'a'.repeat(32)}),/application address/i);
 assert.equal(model.setupModel({...common,target:'local'}).ready,false);
});
