import { createAppProcesses } from './app-processes.mjs';
import { installationFailureMessage } from './failures.mjs';
import { agentHandoff } from './agent-handoff.mjs';
import { validateAnswers } from './prefill.mjs';
import { createSecretVault } from './secrets.mjs';
import { discoverProviders, connectProvider } from './providers.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { emailMetadata } from './email.mjs';
import { createState } from './state.mjs';
import { metadata } from './metadata.mjs';
import { localEmailBindings } from './private.mjs';
export async function startInstaller(root,{seed,port=0,answers,secretInput,noPrefill=false,resume=false,agent=false}={}){
 root=resolve(root);
 if(!seed?.product||!seed.model?.fields||!seed.model?.safeKeys||typeof seed.install!=='function'||typeof seed.validateInput!=='function')throw Error('Provide a seed onboarding contract.');
 const validate=value=>validateAnswers(value,seed.model);
 const accent=seed.branding?.accent;
 const accentStyle=/^#[0-9a-f]{6}$/i.test(accent||'')?`<style>:root{--installer-accent:${accent};--installer-accent-text:${[1,3,5].map((start,i)=>parseInt(accent.slice(start,start+2),16)*[.299,.587,.114][i]).reduce((a,b)=>a+b,0)>150?'#173753':'#ffffff'}}</style>`:'';
 const uiRoot=fileURLToPath(new URL('./ui/',import.meta.url));
 if(resume&&noPrefill)throw Error('--resume cannot be combined with --no-prefill.');
 const vault=createSecretVault(seed.model);
 const store=await createState(root,seed),token=randomBytes(32).toString('hex'),cookie=randomBytes(32).toString('hex');let origin,work,connection,starting=false,mutations=0;const apps=createAppProcesses();const abort=new AbortController();
 store.state.sessionId=randomBytes(16).toString('hex');
 const {workspaceArt,artworkBridge,imageLimit}=seed.artwork?await seed.artwork(root,store):{};
 if(agent)store.state.agent.mode='connecting';
 if(noPrefill&&(answers||secretInput||Object.keys(store.state.draft).length))throw Error('--no-prefill requires a fresh checkout with no saved installer draft or supplied answers. Existing drafts are preserved.');
 const configuredEnv=noPrefill?{}:{...process.env,...await localEmailBindings(root)};
 if(!noPrefill&&!resume){
 const info=await metadata(root);const defaults=validate(await seed.defaults?.(info,{root,env:configuredEnv})||{});store.state.known={...store.state.known,...info,suggestedFields:Object.keys(defaults).filter(key=>!store.state.answered.includes(key)),...(seed.features?.email?{email:emailMetadata(configuredEnv)}:{})};store.state.draft={...defaults,...store.state.draft};
 }
 if(answers){const validated=validate(answers);await store.draft({...store.state.draft,...validated},'agent',Object.keys(validated));}
 if(secretInput){vault.set(secretInput,store.state.draft);if(Object.keys(secretInput).length)store.activity.secrets();secretInput=undefined;}
 await workspaceArt?.request();
 store.state.known.providers=noPrefill||(!seed.features?.hosting&&!seed.features?.github)?{}:(await discoverProviders(root,{signal:abort.signal})).providers;
 const assets={'/seed.mjs':[seed.browserModule,'text/javascript'],'/model-core.mjs':['model-core.mjs','text/javascript'],'/workspace-art.js':['workspace-art.js','text/javascript'],'/activity.js':['activity.js','text/javascript'], '/':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/address-client.mjs':['address-client.mjs','text/javascript'], '/model.mjs':['model.mjs','text/javascript'], '/style.css':['style.css','text/css'], '/ocean.png':[null,seed.background?.endsWith('.svg')?'image/svg+xml':'image/png']};
 const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
 const server=createServer(async(req,res)=>{
  let mutation=false;
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body))};
  try{
   if(abort.signal.aborted)return json(503,{error:'The installer is closing.'});
   if(req.headers.host!==new URL(origin).host)return json(403,{error:'Invalid installer host.'});
   const path=new URL(req.url,origin).pathname;
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
   if(path.startsWith('/api/')){
    if(req.headers.origin&&req.headers.origin!==origin)return json(403,{error:'Use the local installer page.'});
    const session=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('rer_installer='))?.slice(14);
    if(!equal(req.headers['x-installer-token'],token)||!equal(session,cookie))return json(403,{error:'Reload the installer page.'});
    if(req.method==='POST'&&['/api/draft','/api/prefill','/api/secrets','/api/activity','/api/address','/api/connect'].includes(path)){
     if(req.headers.origin!==origin)return json(403,{error:'Use the local installer page.'});
     if(starting||['running','complete'].includes(store.state.phase))return json(409,{error:'Installation has already started.'});
     mutation=true;mutations++;
    }
    if(req.method==='POST'&&path.startsWith('/api/workspace-art')){
     if(!workspaceArt)return json(404,{error:'This seed does not support workspace artwork.'});
     if(req.headers.origin!==origin)return json(403,{error:'Use the local installer page.'});
     const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>(path==='/api/workspace-art/image'?imageLimit:8000))return json(413,{error:'Too much input.'});chunks.push(chunk);}
     try{
      if(path==='/api/workspace-art/image'){
       if(req.headers['content-type']!=='image/png')return json(415,{error:'Supply a PNG image.'});
       return json(200,await workspaceArt?.complete({id:req.headers['x-artwork-job'],revision:req.headers['x-artwork-revision'],sessionId:req.headers['x-installer-session'],kind:req.headers['x-artwork-kind']},Buffer.concat(chunks)));
      }
      const input=JSON.parse(Buffer.concat(chunks).toString());
      if(path==='/api/workspace-art')return json(200,await workspaceArt?.request(input));
      if(path==='/api/workspace-art/job')return json(200,await workspaceArt?.report(input));
      return json(404,{error:'Unknown workspace artwork action.'});
     }catch(error){return json(409,{error:error.message});}
    }
    if(req.method==='GET'&&path==='/api/agent-handoff')return json(200,(seed.handoff||agentHandoff)(root,origin,store.state.sessionId,seed));
    if(req.method==='GET'&&path==='/api/state'){await workspaceArt?.refresh();store.state.known.secretReadiness=vault.readiness(store.state.draft);return json(200,store.state);}
    if(req.method==='POST'&&path==='/api/activity'){
     if(req.headers.origin!==origin)return json(403,{error:'Use the local installer page.'});
     if(starting||['running','complete'].includes(store.state.phase))return json(409,{error:'Installation has already started.'});
     let body='';for await(const chunk of req){body+=chunk;if(body.length>1000)return json(413,{error:'Too much input.'})}
     try{const activity=store.activity.agent(JSON.parse(body));await workspaceArt?.request();return json(200,{activity})}catch{return json(400,{error:'Choose a supported activity phase and topic.'})}
    }
    if(req.method==='POST'&&path==='/api/address'){
     if(!seed.resolveAddress)return json(404,{error:'This seed does not support address discovery.'});
     if(req.headers.origin!==origin)return json(403,{error:'Use the local installer page.'});
     if(starting||['running','complete'].includes(store.state.phase))return json(409,{error:'Installation has already started.'});
     let body='';for await(const chunk of req){body+=chunk;if(body.length>8000)return json(413,{error:'Too much input.'})}
     let input;try{input=JSON.parse(body);if(!input||typeof input!=='object'||Array.isArray(input))throw Error()}catch{return json(400,{error:'Provide your workspace name and Cloudflare account.',code:'invalid_input'})}
     const merged=vault.merge(input,store.state.draft);
     try{return json(200,await seed.resolveAddress(root,{name:input.name,accountId:input.accountId,prefix:input.prefix,apiToken:merged.apiToken},{env:configuredEnv}));}
     catch(error){if(typeof error.code==='string')return json(error.code==='invalid_input'?400:422,{error:error.message,code:error.code});return json(502,{error:'Cloudflare could not confirm your app address.',code:'cloudflare_unavailable'});}
     finally{merged.apiToken='';input.apiToken='';}
    }
    if(req.method==='POST'&&['/api/prefill','/api/secrets'].includes(path)){
     if(req.headers.origin!==origin)return json(403,{error:'Use the local installer page.'});
     if(starting||['running','complete'].includes(store.state.phase))return json(409,{error:'Installation has already started.'});
     let body='';for await(const chunk of req){body+=chunk;if(body.length>16000)return json(413,{error:'Too much input.'})}
     try{const input=JSON.parse(body);if(path==='/api/prefill'){const answers=Object.fromEntries(Object.entries(validate(input)).filter(([key])=>store.state.sources[key]!=='browser'));await store.draft({...store.state.draft,...answers},'agent',Object.keys(answers));await workspaceArt?.request();}else {if(input.revision!==store.state.lastUpdate.revision)throw Error('Setup details changed; read them again before supplying credentials.');vault.set(input.secrets,store.state.draft);if(Object.keys(input.secrets).length)store.activity.secrets();}}catch{return json(400,{error:'Invalid setup input. Use supported nonsecret answers or the secure credential endpoint.'})}
     return json(200,{saved:true,revision:store.state.lastUpdate.revision,updatedFields:store.state.lastUpdate.keys,secretReadiness:vault.readiness(store.state.draft)});
    }
    if(req.method==='POST'&&path==='/api/connect'){
     if(req.headers.origin!==origin)return json(403,{error:'Use the local installer page.'});
     if(starting||['running','complete'].includes(store.state.phase)||connection)return json(409,{error:'Another operation is running.'});
     let body='';for await(const chunk of req){body+=chunk;if(body.length>1000)return json(413,{error:'Too much input.'})}
     let provider;try{provider=JSON.parse(body).provider;if(!['cloudflare','github'].includes(provider)||(provider==='cloudflare'&&!seed.features?.hosting)||(provider==='github'&&!seed.features?.github))throw Error()}catch{return json(400,{error:'Select Cloudflare or GitHub.'})}
     store.state.connection={provider,state:'starting'};store.activity.provider(provider,'starting');json(202,{started:true});
     connection=connectProvider(root,provider,{signal:abort.signal,onProgress:value=>{store.state.connection=value;store.activity.provider(provider,value.state)}}).then(result=>{store.state.known.providers[provider]=result;store.state.connection={provider,state:result.operation.state};store.activity.provider(provider,result.operation.state);}).catch(()=>{store.state.connection={provider,state:'failed'};store.activity.provider(provider,'failed');}).finally(()=>{connection=null});return;
    }
    if(req.method==='POST'&&path==='/api/draft'){
     if(req.headers.origin!==origin)return json(403,{error:'Use the local installer page.'});
     if(starting||['running','complete'].includes(store.state.phase))return json(409,{error:'Installation has already started.'});
     let body='';for await(const chunk of req){body+=chunk;if(body.length>16000)return json(413,{error:'Too much input.'})}
     let draft;try{draft=JSON.parse(body);if(!draft||typeof draft!=='object'||Array.isArray(draft)||Object.values(draft).some(value=>typeof value!=='string'||value.length>2048))throw Error()}catch{return json(400,{error:'Provide nonsecret setup details.'})}
     try{draft=validate(draft)}catch{return json(400,{error:'Provide supported nonsecret setup details.'})}
     await store.draft({...store.state.draft,...draft});return json(200,{saved:true});
    }
    if(req.method==='POST'&&path==='/api/start'){
     if(req.headers.origin!==origin)return json(403,{error:'Use the local installer page.'});
     if(starting||mutations||connection||['running','complete'].includes(store.state.phase))return json(409,{error:'Installation is already running.'});
     starting=true;
     try{
     let body='';for await(const chunk of req){body+=chunk;if(body.length>16000)return json(413,{error:'Too much input.'})}
     let input;try{input=seed.validateInput(vault.merge(JSON.parse(body),store.state.draft),configuredEnv,store.state.known.providers)}catch(error){return json(400,{error:error.message})}
     await store.draft(input);await workspaceArt?.deliverSidebar();delete store.state.error;await store.phase('running');
     if(abort.signal.aborted)return json(503,{error:'The installer is closing.'});
     vault.clear();json(202,{started:true});const attempt=createAppProcesses();
     work=Promise.resolve().then(()=>seed.install(root,input,store,child=>{
      apps.register(child);attempt.register(child);
     },abort.signal,artworkBridge)).catch(async(error)=>{
      await attempt.stop();store.state.error=installationFailureMessage(error);await store.phase('failed');
     }).finally(()=>{for(const key of Object.keys(seed.model.secretScopes||{}))input[key]='';});void work;return;
     }finally{starting=false;}
    }
    return json(404,{error:'Unknown installer action.'});
   }
   if(req.method!=='GET'||!assets[path])return json(404,{error:'Not found.'});
   const [file,type]=assets[path];let content=await readFile(file?(path==='/seed.mjs'?join(root,file):join(uiRoot,file)):join(root,seed.background));
   if(path==='/'){content=content.toString().replaceAll('{{product}}',String(seed.product).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))).replace('</head>',`${accentStyle}<meta name="installer-token" content="${token}"></head>`);res.setHeader('Set-Cookie',`rer_installer=${cookie}; Path=/; HttpOnly; SameSite=Strict`);res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'")}
   res.writeHead(200,{'Content-Type':type});res.end(content);
  }catch{json(500,{error:'The installer could not complete this request.'})}finally{if(mutation)mutations--;}
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 return {origin,state:store.state,close:async()=>{artworkBridge?.close();vault.clear();abort.abort();const stopped=apps.stop();await work;await stopped;await apps.stop();await connection;await new Promise(resolve=>server.close(resolve))}};
}
