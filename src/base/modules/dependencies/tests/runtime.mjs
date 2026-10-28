import { DatabaseSync } from '../../container/adapters/d1-sqlite.mjs';
import { readFile } from 'node:fs/promises';
import { createOperatorAuth, createAuthHandler } from '../../operator-auth/index.mjs';
import { createDependencies } from '../index.mjs';
import { createIdpOwnerClaimHandler } from '../../owner-claim/idp.mjs';
import { provider, network, keys } from '../../operator-auth/identity/oidc/tests/idp.mjs';
import { assertion, digest } from '../crypto.mjs';
import { parseIdToken, verifySignature } from '../../operator-auth/identity/oidc/jwt.mjs';
export const ORIGIN='https://app.example', ISSUER='https://auth.example';
export const NOW=1791676800000;
export async function runtime(t,{existing=false,local=false,issuer=ISSUER}={}) {
 const appOrigin=local?'http://127.0.0.1:8787':ORIGIN;
 let now=NOW;
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 for(const path of ['operator-auth/accounts/schema/operator-auth.sql','operator-auth/identity/oidc/schema/oidc.sql','owner-claim/schema/owner-claim.sql','owner-claim/schema/idp.sql','dependencies/schema/dependencies.sql','dependencies/schema/approval-attempt.sql','dependencies/schema/keys-sealed.sql'])sqlite.exec(await readFile(new URL('../../'+path,import.meta.url),'utf8'));
 // Real SQL with serial transactions and trigger-inclusive changes metadata, like D1.
 function statement(sql,args=[]) {return {bind:(...v)=>statement(sql,v),async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},run(){return Promise.resolve(this.execute());},execute(){const before=sqlite.prepare('SELECT total_changes() n').get().n,st=sqlite.prepare(sql),results=st.columns().length?st.all(...args):(st.run(...args),[]);return {results,meta:{changes:sqlite.prepare('SELECT total_changes() n').get().n-before}};}};}
 const db={prepare:statement,async batch(items){sqlite.exec('BEGIN IMMEDIATE');try{const result=items.map(s=>s.execute());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const signing=await keys('ES256');
 const idp=await provider({now:()=>now,issuer:issuer,clientId:'app-client',redirectUri:appOrigin+'/auth/oidc/auth/callback',alg:'ES256',method:'private_key_jwt',clientKey:signing.public,rerInterfaces:['oidc-provider@1.0.0'],claims:{iat:now/1000,exp:now/1000+300,email_verified_at:now/1000,sid:'owner-sid'}});
 const transport=network([idp]), codes=new Map(),tokens=new Map(),redeemed=new Set();
 const metadata={issuer:issuer,interface:'oidc-provider@1',provides:['oidc-provider@1','error-sink@1'],version:1,initiate:issuer+'/link',redeem:issuer+'/redeem',deregister:issuer+'/remove'};
 let auth,dependencies,handler,claimHandler,tokenGate,linkGate,keysGate;
 const mails=[],identityPaths=['/auth/oidc/auth/callback','/auth/oidc/auth/logout'];
 const config={dependencies:true,INSTALLATION_KEY:crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),''),local,origin:appOrigin,OWNER_EMAIL:'owner@example.com',SESSION_SECRET:'session-secret-only-for-test-thirty-two-bytes',SETUP_TOKEN:'setup-secret-only-for-test-thirty-two-bytes',MAIL_FROM:'app@example.com',ipLimit:1000,emailLimit:1000};
 function request(path,{body,cookie,bearer,headers={},method=body===undefined?'GET':'POST',origin=appOrigin}={}) {return new Request(new URL(path,origin),{method,headers:{Host:new URL(origin).host,Origin:origin,'Content-Type':'application/json',...headers,...(bearer?{Authorization:'Bearer '+bearer}:{}),...(cookie?{Cookie:cookie.match(/__Host-operator_session=[^;,]+/)?.[0]??cookie.split(';')[0]}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
 async function call(path,options) {const req=request(path,options);if(path==='/test/credentials') {try{return Response.json(await auth.mintCredential(req,options.body),{status:201});}catch(e){return Response.json({error:e.code},{status:e.status});}}if(path==='/test/credential-use')return new Response(null,{status:await auth.authenticateCredential(req)?200:401});return await dependencies.handle(req)??await claimHandler(req)??await handler(req);}
 async function fetcher(url,init={}) {
  url=String(url);
  if(url.startsWith(appOrigin))return call(new URL(url).pathname,{method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined,cookie:new Headers(init.headers).get('Cookie'),headers:new Headers(init.headers).has('x-rer-local-cli')?{'x-rer-local-cli':new Headers(init.headers).get('x-rer-local-cli')}:{}});
  if(url===issuer+'/.well-known/rer-provider')return Response.json(metadata);
  if(url===issuer+'/link') {
   const input=JSON.parse(init.body),token=tokens.get(input.token);
   if(!token || token.used || token.expiresAt<=now || token.origin!==input.origin || token.interface!==input.interface)return Response.json({error:'invalid_token'},{status:403});
   const doc=await (await fetcher(input.origin+'/.well-known/rer-dependencies')).json();
   const dependency=doc.dependencies.find(d=>d.interface===input.interface);
   if(JSON.stringify([...token.callbacks].sort())!==JSON.stringify([doc.callback,...dependency.paths].sort()))return Response.json({error:'invalid_callbacks'},{status:403});
   token.used=true;
   const code=crypto.randomUUID();codes.set(code,{origin:doc.origin,callback:doc.callback,sector:doc.sector_id,jwks:(await (await fetcher(dependency.jwks_uri)).json()),contract:input.interface});
   const result=await call('/.well-known/rer-link/callback',{body:{issuer:issuer,code,interface:input.interface}});
   return result.status===200?Response.json({linked:true}):result;
  }
  if(url===issuer+'/redeem') {
   if(linkGate){const gate=linkGate;linkGate=null;gate.reached();await gate.wait;}
   const input=JSON.parse(init.body),code=codes.get(input.code);
   if(!code || redeemed.has(input.code))return Response.json({error:'used_code'},{status:403});
   try {
    const parsed=parseIdToken(input.client_assertion,{algorithms:['ES256']});await verifySignature(parsed,code.jwks);const c=parsed.claims;
    if(c.iss!==code.origin||c.sub!==code.origin||c.aud!==url||c.code!==input.code||c.callback!==code.callback||c.sector_id!==code.sector||c.exp<=now/1000||input.origin!==code.origin||input.callback!==code.callback)throw Error();
   }catch{return Response.json({error:'invalid_proof'},{status:403});}
   redeemed.add(input.code);
   // OIDC token redemption checks the same registered public client key.
   if(code.contract==='oidc-provider@1')idp.options.clientKey=code.jwks.keys[0];
   return Response.json({issuer:issuer,interface:code.contract,client_id:'app-client',sector_id:code.sector,origin:code.origin,callback:code.callback,continuity:'provider-owner'});
  }
  if(url===issuer+'/remove')throw Error('unreachable');
  if(url===issuer+'/jwks' && keysGate){const gate=keysGate;keysGate=null;gate.reached();await gate.wait;}
  if(url===issuer+'/token' && tokenGate){const gate=tokenGate;tokenGate=null;gate.reached();await gate.wait;}
  return transport(url,init);
 }
 function restart(){auth=createOperatorAuth({db,config,clientIp:()=> '192.0.2.1',clock:()=>now,fetch:fetcher,mailSender:{async send(message){mails.push(message);return {status:'accepted'};}}});dependencies=createDependencies({db,INSTALLATION_KEY:config.INSTALLATION_KEY,INSTALLATION_KEY_PREVIOUS:config.INSTALLATION_KEY_PREVIOUS,local,origin:appOrigin,name:'App',provider:issuer,interfaces:[{interface:'oidc-provider@1',provider:issuer,paths:identityPaths},{interface:'error-sink@1',provider:issuer,paths:['/errors/callback']}],auth,clock:()=>now,fetch:fetcher});handler=createAuthHandler(auth);claimHandler=createIdpOwnerClaimHandler({db,authConfig:config,clientIp:()=> '192.0.2.1',clock:()=>now,fetch:fetcher});}
 restart();
 return {db,sqlite,call,request,metadata,identityPaths,fetch:fetcher,pauseKeys(){let reached,release;const ready=new Promise(r=>{reached=r;});const wait=new Promise(r=>{release=r;});keysGate={reached,wait};return {ready,release};},pauseLink(){let reached,release;const ready=new Promise(r=>{reached=r;});const wait=new Promise(r=>{release=r;});linkGate={reached,wait};return {ready,release};},pauseToken(){let reached,release;const ready=new Promise(r=>{reached=r;});const wait=new Promise(r=>{release=r;});tokenGate={reached,wait};return {ready,release};},idp,codes,tokens,auth:()=>auth,dependencies:()=>dependencies,signing,mails,config,restart,now:()=>now,advance:ms=>{now+=ms;},
  async bootstrap({approve=true}={}){if(approve && !existing)await this.approveSetup();const r=await call('/auth/bootstrap',{body:{token:config.SETUP_TOKEN,displayName:'Owner'}});if(r.status!==303)throw Error(await r.text());if(existing)sqlite.exec('UPDATE oa_auth_settings SET first_setup=0');return r.headers.get('set-cookie');},
  async code(contract='oidc-provider@1'){const doc=await dependencies.document(),key=await (await call('/.well-known/rer-link/jwks/'+contract)).json();const code=crypto.randomUUID();codes.set(code,{origin:appOrigin,callback:doc.callback,sector:doc.sector_id,jwks:key,contract});return code;},
  async approveSetup(contract='oidc-provider@1'){return call('/auth/dependencies/setup',{body:{issuer:issuer,interface:contract,token:config.SETUP_TOKEN}});},
  async approve(contract='oidc-provider@1'){const cookie=await this.proof();return call('/auth/dependencies/relink',{cookie,body:{issuer:issuer,interface:contract}});},
  async link(contract='oidc-provider@1'){if(!sqlite.prepare('SELECT 1 FROM rer_dependency_pending WHERE interface=?').get(contract)){const approved=sqlite.prepare('SELECT 1 FROM oa_operators').get()?await this.approve(contract):await this.approveSetup(contract);if(approved.status!==200)throw Error(await approved.text());}return this.rawLink(contract);},
  async rawLink(contract='oidc-provider@1'){return call('/.well-known/rer-link/callback',{body:{issuer:issuer,code:await this.code(contract),interface:contract}});},
  async proof(cookie){await call('/auth/magic-link',{body:{email:'owner@example.com'}});const token=new URL(mails.at(-1).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');const result=await call('/auth/confirm',{body:{token}});return result.headers.get('set-cookie');},
 };
}
