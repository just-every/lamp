import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startInstaller } from './server.mjs';

test('a partially received answer request cannot cross the explicit Start boundary',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rer-pending-request-'));let installs=0;
 const seed={product:'Pending request fixture',model:{fields:{name:{valid:v=>typeof v==='string'}},safeKeys:['name']},validateInput:v=>v,install:async(_root,_input,store)=>{installs++;await store.phase('complete')}};
 const server=await startInstaller(root,{seed,noPrefill:true});t.after(async()=>{await server.close();await rm(root,{recursive:true,force:true})});
 const page=await fetch(server.origin),html=await page.text();const headers={Origin:server.origin,Cookie:page.headers.get('set-cookie').split(';')[0],'X-Installer-Token':html.match(/name="installer-token" content="([a-f0-9]+)"/)[1],'Content-Type':'application/json'};
 const start=()=>fetch(server.origin+'/api/start',{method:'POST',headers,body:'{"name":"Owner"}'});
 // The server only emits 100 Continue after receiving the request headers; its
 // handler reserves the answer operation before awaiting these delayed bytes.
 const body='{"name":"Delayed owner"}';let pending;
 const received=new Promise(resolve=>{
  pending=request(server.origin+'/api/draft',{method:'POST',headers:{...headers,Expect:'100-continue','Content-Length':Buffer.byteLength(body)}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode))});
 });
 await new Promise((resolve,reject)=>{pending.once('continue',resolve);pending.once('error',reject);pending.flushHeaders()});
 assert.equal((await start()).status,409);assert.equal(installs,0);
 pending.end(body);assert.equal(await received,200);
 assert.equal((await start()).status,202);await server.close();assert.equal(installs,1);
});
