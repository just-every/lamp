import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstaller} from './server.mjs';
import {installationFailure} from './failures.mjs';

const secret='PRIVATE_COMMAND_OUTPUT_TOKEN';
const run=(command,args,options)=>new Promise((resolve,reject)=>{
 const child=spawn(command,args,options);
 child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${secret}: exit ${code}`)));
});
async function session(root,seed,resume=false){
 const server=await startInstaller(root,{seed,...(resume?{resume:true}:{noPrefill:true})});
 const page=await fetch(server.origin),html=await page.text();
 const headers={Origin:server.origin,Cookie:page.headers.get('set-cookie').split(';')[0],'X-Installer-Token':html.match(/name="installer-token" content="([a-f0-9]+)"/)[1],'Content-Type':'application/json'};
 return {server,headers,post:(body,overrides={})=>fetch(server.origin+'/api/start',{method:'POST',headers:{...headers,...overrides},body:JSON.stringify(body)}),state:async()=>{const response=await fetch(server.origin+'/api/state',{headers});assert.equal(response.status,200);return response.json();}};
}
async function waitPhase(client,phase){
 for(let n=0;n<200;n++){const state=await client.state();if(state.phase===phase)return state;await new Promise(resolve=>setTimeout(resolve,5));}
 assert.fail(`Never reached ${phase}`);
}
for(const [name,failure,expected] of [
 ['runtime',async()=>{throw installationFailure('node_version',{version:'26.8.1'});},/Install Node.js 26\.8\.1/],
 ['missing npm',async root=>{try{await run('npm',['--version'],{cwd:root,env:{PATH:root},stdio:'ignore'});}catch(error){assert.equal(error.code,'ENOENT');throw installationFailure('missing_tool',{tool:'npm'});}},/npm was not found.*PATH/],
 ['command exit',async root=>{try{await run(process.execPath,['-e','process.exit(7)'],{cwd:root,stdio:'ignore'});}catch{throw installationFailure('command_failed',{step:'build'});}},/stopped while building the application/],
 ['unknown',async()=>{throw Object.assign(new Error(secret),{code:'missing_tool',tool:'npm',cause:new Error(secret)});},/stopped unexpectedly.*last installation step/],
 ['modified typed error',async()=>{const error=installationFailure('missing_tool',{tool:'git'});error.message=secret;error.cause=new Error(secret);throw error;},/Git was not found/]
])test(`HTTP reports ${name} safely and preserves a resumable draft`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'rer-failure-'));let calls=0,client;
 const seed={product:'Failure fixture',model:{fields:{name:{valid:v=>typeof v==='string'}},safeKeys:['name'],secretScopes:{apiToken:['name']}},validateInput:v=>v,install:async(root,input,store)=>{calls++;await store.step('Building application');if(calls===1)await failure(root);else await store.phase('complete');}};
 t.after(async()=>{await client?.server.close();await rm(root,{recursive:true,force:true});});
 client=await session(root,seed);
 assert.equal(calls,0);
 assert.equal((await client.post({name:'Owner',apiToken:secret},{Origin:'https://attacker.invalid'})).status,403);
 assert.equal((await client.post({name:'Owner',apiToken:secret},{Cookie:''})).status,403);
 assert.equal((await client.post({name:'Owner',apiToken:secret},{'X-Installer-Token':''})).status,403);
 assert.equal(calls,0);
 assert.equal((await client.post({name:'Owner',apiToken:secret})).status,202);
 const state=await waitPhase(client,'failed');assert.match(state.error,expected);assert.doesNotMatch(JSON.stringify(state),new RegExp(secret));
 await client.server.close();
 const saved=await readFile(join(root,'.seed/installer/state.json'),'utf8');assert.doesNotMatch(saved,new RegExp(secret));assert.deepEqual(JSON.parse(saved).draft,{name:'Owner'});assert.equal(JSON.parse(saved).phase,'failed');
 client=await session(root,seed,true);
 assert.deepEqual((await client.state()).draft,{name:'Owner'});assert.equal(calls,1);
 // Retrying explicitly must not retain the previous failure on a successful run.
 assert.equal((await client.post({name:'Owner'})).status,202);assert.equal((await waitPhase(client,'complete')).error,undefined);
 await client.server.close();client=await session(root,seed,true);
 assert.deepEqual((await client.state()).draft,{name:'Owner'});assert.equal(calls,2);
});
test('failure contract rejects arbitrary diagnostic fields as display text',()=>{
 for(const [code,details] of [['unknown',{}],['missing_tool',{tool:secret}],['node_version',{version:secret}],['command_failed',{step:secret}]])assert.throws(()=>installationFailure(code,details),TypeError);
});
test('explicit retry clears the preceding failure in the same HTTP session',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rer-retry-'));let calls=0;
 const seed={product:'Retry fixture',model:{fields:{},safeKeys:[]},validateInput:v=>v,install:async(_root,_input,store)=>{if(++calls===1)throw installationFailure('command_failed',{step:'setup'});await store.phase('complete');}};
 const client=await session(root,seed);
 t.after(async()=>{await client.server.close();await rm(root,{recursive:true,force:true});});
 assert.equal((await client.post({})).status,202);assert.match((await waitPhase(client,'failed')).error,/setting up/);
 assert.equal((await client.post({})).status,202);assert.equal((await waitPhase(client,'complete')).error,undefined);
});
