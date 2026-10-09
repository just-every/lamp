import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstaller} from './server.mjs';
import {stopChild} from './private.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function child(t){
 const processChild=spawn(process.execPath,['-e',"process.stdout.write('ready\\n');setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','pipe','ignore']});
 t.after(async()=>{if(processChild.exitCode===null&&processChild.signalCode===null){const exited=once(processChild,'exit');processChild.kill('SIGKILL');await exited;}});
 await once(processChild.stdout,'data');
 return processChild;
}
async function session(t,install){
 const root=await mkdtemp(join(tmpdir(),'rer-process-custody-'));
 const server=await startInstaller(root,{noPrefill:true,seed:{product:'Process custody test',model:{fields:{name:{valid:v=>typeof v==='string'}},safeKeys:['name']},validateInput:v=>v,install}});
 t.after(async()=>{await server.close();await rm(root,{recursive:true,force:true});});
 const page=await fetch(server.origin),html=await page.text();
 const headers={Origin:server.origin,Cookie:page.headers.get('set-cookie').split(';')[0],'X-Installer-Token':html.match(/name="installer-token" content="([a-f0-9]+)"/)[1],'Content-Type':'application/json'};
 const start=()=>fetch(server.origin+'/api/start',{method:'POST',headers,body:JSON.stringify({name:'Preserved owner'})});
 return {root,server,start};
}
async function phase(server,value){
 for(let n=0;n<400;n++){if(server.state.phase===value)return;await delay(5);}
 assert.fail(`Never reached ${value}`);
}
function stopped(child){assert.ok(child.exitCode!==null||child.signalCode!==null,`Child ${child.pid} still alive`);}
function alive(child){assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);assert.doesNotThrow(()=>process.kill(child.pid,0));}

test('failed attempts stop every registered detached child before explicit retry; success stays alive until close',async t=>{
 const children=[];let attempts=0;
 const unrelated=await child(t);
 const client=await session(t,async(_root,_input,store,onApp)=>{
  attempts++;
  for(let n=0;n<2;n++){const app=await child(t);children.push(app);onApp(app);}
  if(attempts<3)throw Error('private failure');
  store.state.appUrl='http://127.0.0.1:1234';await store.phase('complete');
 });
 for(let n=0;n<2;n++){
  assert.equal((await client.start()).status,202);await phase(client.server,'failed');
  children.forEach(stopped);alive(unrelated);
  assert.deepEqual(client.server.state.draft,{name:'Preserved owner'});
 }
 assert.equal((await client.start()).status,202);await phase(client.server,'complete');
 children.slice(-2).forEach(alive);assert.equal(client.server.state.appUrl,'http://127.0.0.1:1234');
 await client.server.close();children.forEach(stopped);alive(unrelated);
 const saved=JSON.parse(await readFile(join(client.root,'.seed/installer/state.json'),'utf8'));
 assert.deepEqual(saved.draft,{name:'Preserved owner'});
});

for(const early of [true,false])for(const outcome of ['resolve','reject'])test(`shutdown owns ${early?'earlier and late':'first late'} registration while install will ${outcome}`,async t=>{
 let entered,release;
 const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const children=[];
 const client=await session(t,async(_root,_input,_store,onApp,signal)=>{
  if(early){const first=await child(t);children.push(first);onApp(first);}
  entered();
  await gate;assert.equal(signal.aborted,true);
  const late=await child(t);children.push(late);onApp(late);
  if(outcome==='reject')throw Error('cancelled');
 });
 assert.equal((await client.start()).status,202);await ready;
 const closing=client.server.close();release();await closing;
 assert.equal(children.length,early?2:1);children.forEach(stopped);
});

test('a child terminated by signal is not signalled again even if its PID is reused',async t=>{
 const retired=await child(t),unrelated=await child(t);
 const exited=once(retired,'exit');retired.kill('SIGTERM');await exited;
 assert.equal(retired.exitCode,null);assert.equal(retired.signalCode,'SIGTERM');
 // Model PID reuse with a real unrelated process group; the retired handle must be ignored.
 retired.pid=unrelated.pid;
 stopChild(retired);await delay(30);alive(unrelated);
});
