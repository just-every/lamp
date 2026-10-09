import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startInstaller } from './server.mjs';

// A gated adapter is test-only: it exposes the real server's pre-install await.
test('Start reserves the session before persistence/artwork and persists running before adapter execution', async t => {
 const root = await mkdtemp(join(tmpdir(), 'rer-start-race-'));
 let deliver, delivered, installs=0, persisted;
 const gate = new Promise(resolve => { deliver=resolve; });
 const entered = new Promise(resolve => { delivered=resolve; });
 const seed = {product:'Concurrency fixture',model:{fields:{name:{valid:v=>typeof v==='string'}},safeKeys:['name']},
  validateInput:value=>value,
  artwork:async()=>({workspaceArt:{request:async()=>{},deliverSidebar:async()=>{delivered();await gate;}}}),
  install:async(_root,_input,store)=>{installs++;persisted=JSON.parse(await readFile(join(root,'.seed/installer/state.json'),'utf8')).phase;await store.phase('complete');}
 };
 const server=await startInstaller(root,{seed,noPrefill:true});
 t.after(async()=>{deliver();await server.close();await rm(root,{recursive:true,force:true});});
 const page=await fetch(server.origin),html=await page.text();
 const headers={Origin:server.origin,Cookie:page.headers.get('set-cookie').split(';')[0],'X-Installer-Token':html.match(/name="installer-token" content="([a-f0-9]+)"/)[1],'Content-Type':'application/json'};
 const post=(path,body)=>fetch(server.origin+path,{method:'POST',headers,body:JSON.stringify(body)});
 const first=post('/api/start',{name:'Owner'});
 await entered;
 for(const [path,body] of [['/api/start',{name:'Second'}],['/api/draft',{name:'Changed'}],['/api/prefill',{name:'Changed'}],['/api/connect',{provider:'github'}]])assert.equal((await post(path,body)).status,409);
 assert.equal(installs,0);
 deliver();assert.equal((await first).status,202);
 await server.close();
 assert.equal(installs,1);assert.equal(persisted,'running');
});
