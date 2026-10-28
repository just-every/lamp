import { incidentFollowBrowserFlow } from "./incident-follow-browser-flow.mjs";
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
import { dirname,resolve,join } from 'node:path';
import { chromium } from 'playwright';
import { readBuiltWorkerArtifact } from '../../../scripts/build-output.mjs';
import { reservePort } from '../worker-startup.mjs';
import { withDraftVersion } from '../draft-version-helper.mjs';
import { migrate,executeSql } from '../../reference-storage/runtime.mjs';
import { smsBindings,smsProviderEdge } from './sms-subscriber-flow.mjs';
import { smsBrowserFlow } from './sms-browser-flow.mjs';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');
const {unstable_getMiniflareWorkerOptions}=require('wrangler');

/** Built production Worker with test-owned local auth and provider edges only. */
export async function smsBrowserRuntime(){
  await readBuiltWorkerArtifact();
  const port=await reservePort({label:'mail settings browser'}),origin=`http://127.0.0.1:${port}`,pageOrigin=`http://localhost:${port}`;
  const options=unstable_getMiniflareWorkerOptions(resolve('dist/server/wrangler.json'));
  const {modulesRules,...workerOptions}=options.workerOptions;
  assert.deepEqual(modulesRules.map(rule=>rule.type),['ESModule','Text','Data','CompiledWasm'],'the emitted module-rule kinds are mapped explicitly');
  async function moduleFiles(directory){
    const files=[];
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const path=join(directory,entry.name);
      if(entry.isDirectory())files.push(...await moduleFiles(path));
      else if(/\.(?:js|mjs|txt|html|sql|bin|wasm)$/.test(path))files.push({type:/\.(?:js|mjs)$/.test(path)?'ESModule':/\.(?:txt|html|sql)$/.test(path)?'Text':path.endsWith('.bin')?'Data':'CompiledWasm',path});
    }
    return files;
  }
  const modules=await moduleFiles(dirname(options.main));
  modules.sort((a,b)=>a.path===options.main?-1:b.path===options.main?1:a.path.localeCompare(b.path));
  const messages=[],smsMessages=[];
  const twilioEdge=smsProviderEdge(smsMessages);
  let runtime,browser;
  const bindings={...options.workerOptions.bindings,...smsBindings,LAMP_APP_HOST:'127.0.0.1',LAMP_PAGE_HOST:'localhost',LAMP_LOCAL_ORIGIN:origin,AUTH_ORIGIN:origin,AUTH_LOCAL:'true',
    SETUP_OPERATOR_EMAIL:'synthetic-lamp-owner@example.test',SESSION_SECRET:'synthetic-lamp-ui-session-1'.repeat(3),SETUP_TOKEN:'synthetic-lamp-ui-setup-1'.repeat(3),
    SUBSCRIBER_TOKEN_SECRET:'synthetic-lamp-ui-subscriber-1'.repeat(3),WEBHOOK_SIGNING_SECRET:'synthetic-lamp-ui-webhook-1'.repeat(3),
    MAIL_FROM_ADDRESS:'lamp@example.test',MAIL_PROVIDER:'resend',MAIL_PROVIDER_API_KEY:'synthetic-lamp-ui-resend-1',MAIL_SECONDARY_PROVIDER:'mailgun',MAIL_SECONDARY_API_KEY:'synthetic-lamp-ui-mailgun-1'};
  const outboundService=async request=>{
    const smsReply=await twilioEdge(request);if(smsReply)return smsReply;
    const url=new URL(request.url);
    if(url.origin==='https://api.resend.com'&&url.pathname==='/emails'){const message=await request.json();messages.push(message);return Response.json({id:`synthetic-lamp-ui-receipt-${messages.length}`});}
    if(url.origin==='https://api.resend.com'&&url.pathname==='/domains')return Response.json({data:[{id:'synthetic-lamp-ui-domain-1',name:'example.test',status:'verified'}],has_more:false});
    if(url.origin===origin||url.origin===pageOrigin)return runtime.dispatchFetch(request);
    throw new Error(`Unexpected mail UI provider edge: ${url.origin}${url.pathname}`);
  };
  try{
    runtime=new Miniflare(convertV4MiniflareOptions({port,workers:[{...workerOptions,modules,modulesRoot:dirname(options.main),bindings,outboundService},...options.externalWorkers]}));
    const env=await runtime.getBindings();
    await migrate(env.DB);
    await executeSql(env.DB,`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('01J00000000000000000000091','synthetic-lamp-owner@example.test','Synthetic Lamp owner','owner','active',${Date.now()});
      INSERT INTO oa_bootstrap(singleton,claim_id,claimed_at) VALUES(1,'01J00000000000000000000091',${Date.now()});
      INSERT INTO page_settings(id,page_name,tagline,accent_color,timezone,hostname,feed_id,mail_from_address,created_at,updated_at) VALUES('default','Synthetic Lamp UI','Mail delivery fixture','#16794C','UTC','localhost','synthetic-lamp-ui-feed-1','lamp@example.test','2026-10-01','2026-10-01');
      INSERT INTO setup_readiness(step,evidence_key,checked_at) VALUES('first-run','complete','2026-10-01');`);
    const login=await runtime.dispatchFetch(`${origin}/auth/magic-link`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'synthetic-lamp-owner@example.test'})});
    assert.ok(login.status>=200&&login.status<300,await login.text());
    const invitation=messages.find(message=>message.to.includes('synthetic-lamp-owner@example.test'));
    assert.ok(invitation,'the real primary adapter sends owner sign-in');
    const token=new URL(invitation.text.match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');
    const confirmed=await runtime.dispatchFetch(`${origin}/auth/confirm`,{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token})});
    assert.equal(confirmed.status,303,await confirmed.text());
    const cookie=confirmed.headers.get('set-cookie').split(';')[0];
    const raw=(path,init={})=>runtime.dispatchFetch(new URL(path,origin).href,{redirect:'manual',...init,headers:{Origin:origin,Cookie:cookie,...init.headers}});
    const api=async(path,init={})=>{init=await withDraftVersion(path,init,read=>raw(read));const response=await raw(path,{...init,headers:{...(init.body?{'Content-Type':'application/json'}:{}),...init.headers}});const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null,text};};
    const post=(path,body)=>api(path,{method:'POST',body:JSON.stringify(body)});
    const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--use-mock-keychain','--password-store=basic',...(executablePath?['--no-sandbox']:[])]});
    const context=await browser.newContext();
    await context.addCookies([{name:cookie.slice(0,cookie.indexOf('=')),value:cookie.slice(cookie.indexOf('=')+1),url:origin}]);
    const page=await context.newPage();
    await incidentFollowBrowserFlow({page,origin,pageOrigin,api,post,raw,messages});
    await smsBrowserFlow({page,origin,pageOrigin,api,post,raw,db:env.DB,flush:async()=>{ const result=await (await runtime.getWorker()).scheduled({cron:"* * * * *"}); assert.equal(result.outcome,"ok"); },messages:smsMessages});
    await context.close();
  }finally{await browser?.close();await runtime?.dispose();}
}
