import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'vite';
import {getPlatformProxy} from 'wrangler';
import {legacyApiFixtureSql} from './e2e/fixtures/legacy-api-fixture.mjs';
import {openSnapshotCacheRuntime} from './e2e/snapshot-cache-runtime.mjs';
import {reservePort} from './e2e/worker-startup.mjs';

test('scheduled heartbeat is off by default, reports healthy dependencies without data, and silence alarms externally',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lamp-heartbeat-'));let platform,vite,snapshotCache,last=null,requests=0,alarm=false,alarmTimer;
 const receiver=http.createServer((req,res)=>{assert.equal(req.method,'GET');assert.equal(req.url,'/ping');requests++;last=Date.now();alarm=false;clearTimeout(alarmTimer);alarmTimer=setTimeout(()=>{alarm=true},750);res.end('ok')});await new Promise(r=>receiver.listen(0,'127.0.0.1',r));
 const original=globalThis.fetch;
 try{
  for(const args of [['migrations','apply','DB'],['execute','DB','--command',legacyApiFixtureSql()]])execFileSync('pnpm',['exec','wrangler','d1',...args,'--local','--config','wrangler.jsonc','--persist-to',directory],{ maxBuffer: 8 * 1024 * 1024,stdio:'pipe'});
  platform=await getPlatformProxy({configPath:'wrangler.jsonc',remoteBindings:false,persist:{path:join(directory,'v3')}});
  vite=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,hmr:{port:await reservePort({label:'heartbeat test'})}}});
  snapshotCache=await openSnapshotCacheRuntime(directory);
  const bindings={...platform.env,SNAPSHOT_CACHE:snapshotCache.namespace};
  const {runScheduled}=await vite.ssrLoadModule('/src/core/app/worker-lifecycle.ts');
  globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).hostname,'heartbeat.example.test');assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.headers,undefined);return original(`http://127.0.0.1:${receiver.address().port}/ping`,options)};
  const tick=async bindings=>{const pending=[];await runScheduled(bindings,{waitUntil:p=>pending.push(p)},Math.floor(Date.now()/60000)*60000);await Promise.all(pending)};
  await tick(bindings);assert.equal(requests,0);
  const enabled={...bindings,LAMP_HEARTBEAT_URL:'https://heartbeat.example.test/ping',LAMP_HEARTBEAT_INTERVAL_MINUTES:'1'};
  await tick(enabled);assert.equal(requests,1);assert.ok(last!==null);
  await tick({...enabled,EFFECTS_PAUSED:'1'});assert.equal(requests,1,'hosting moves hold heartbeat side effects');
  await tick(enabled);assert.equal(requests,2,'the receiving active host can resume pings');
  const silenceStarted=last;
  await tick({...enabled,JOBS:{async send(){throw Error('Local Queue edge outage')}}});assert.equal(last,silenceStarted);
  const deadline=Date.now()+5000;while(!alarm&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));assert.equal(alarm,true,'the independent local service raises its own silence alarm');
 }finally{clearTimeout(alarmTimer);globalThis.fetch=original;await vite?.close();await snapshotCache?.dispose();await platform?.dispose();receiver.closeAllConnections();await new Promise(r=>receiver.close(r));await rm(directory,{recursive:true,force:true})}
});
