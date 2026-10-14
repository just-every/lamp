import {secret as sessionSecret} from '../auth-adoption/runtime.mjs';
import {setupPageSettingsStatement} from '../../scripts/ops-config.mjs';
import test from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {payload} from '../artifact-payload.mjs';
import {produceArtifact} from '../../scripts/build-delivery-artifact.mjs';
import {isolatedWranglerConfig} from '../helpers/wrangler-config.mjs';
import {fixtureProcessEnv} from '../helpers/worker-environment.mjs';
const require=createRequire(import.meta.url);
const wranglerRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');

// Provider responses exist only in this native-runtime test. No real mail is sent.
test('independent emitted artifact owns secure empty setup, native sessions and publication',async()=>{
 const temporary=await mkdtemp(resolve('.lamp-independent-'));
 const environment=fixtureProcessEnv();
 const config=isolatedWranglerConfig(undefined,environment);
 let runtime;
 try {
  // Installed builds include a private preview .dev.vars sidecar. Build the
  // real source with a fixture-owned config so packaging remains fail-closed
  // without reading or changing the installation's secrets or saved settings.
  const build=spawnSync(process.execPath,['scripts/build.mjs'],{
   env:{...environment,LAMP_WRANGLER_CONFIG:config.path,LAMP_VITE_CACHE_DIR:join(temporary,'vite-cache'),LAMP_WORKERS_STATE_PATH:join(temporary,'build-state')},
   stdio:'inherit',
  });
  assert.equal(build.status,0,'isolated independent release build succeeds');
  const artifactPath=await produceArtifact({output:relative(process.cwd(),join(temporary,'package/artifact.json'))});
  const artifact=JSON.parse(await readFile(artifactPath,'utf8'));
  const raw=new Map(await Promise.all([...artifact.modules,...artifact.assets].map(async item=>[item.payload,await payload(artifactPath,item)])));
  const mail=[];
  const secret='test-bootstrap-secret-'.repeat(3);
  const bindings={...artifact.deploymentSpec.publicVariables,LAMP_APP_HOST:'127.0.0.1',LAMP_PAGE_HOST:'status.lamp.test',SETUP_TOKEN:secret,SESSION_SECRET:sessionSecret,SETUP_OPERATOR_EMAIL:'owner@example.test',AUTH_ORIGIN:'http://127.0.0.1:12402',AUTH_LOCAL:'true',MAIL_FROM_ADDRESS:'status@example.test',MAIL_PROVIDER_API_KEY:'test-only-provider',SUBSCRIBER_TOKEN_SECRET:'test-subscriber-secret-'.repeat(3),WEBHOOK_SIGNING_SECRET:'test-webhook-secret-'.repeat(3),RER_INSTALLATION_ID:'independent-local'};
  const modules=artifact.modules.map(module=>({type:module.type==='esm'?'ESModule':module.type==='compiled-wasm'?'CompiledWasm':'Text',path:module.name,contents:module.type==='compiled-wasm'?raw.get(module.payload):raw.get(module.payload).toString()}));
  modules.sort((a,b)=>a.path===artifact.mainModule?-1:b.path===artifact.mainModule?1:0);
  const options=convertV4MiniflareOptions({port:12402,name:'lamp-independent',modules,compatibilityDate:artifact.deploymentSpec.compatibilityDate,compatibilityFlags:artifact.deploymentSpec.compatibilityFlags,bindings,d1Databases:{DB:'lamp-independent-db'},r2Buckets:{SNAPSHOTS:'lamp-independent-snapshots'},durableObjects:{SNAPSHOT_CACHE:{className:'SnapshotCache',useSQLite:true}},queueProducers:{JOBS:'lamp-independent-jobs'},resourcePersistencePath:join(temporary,'state'),serviceBindings:{ASSETS:async request=>{const asset=artifact.assets.find(asset=>asset.path===new URL(request.url).pathname);return asset?new Response(raw.get(asset.payload),{headers:{'Content-Type':asset.contentType}}):new Response(null,{status:404});}},outboundService:async request=>{assert.equal(new URL(request.url).hostname,'api.resend.com','unexpected external request');mail.push(await request.json());return Response.json({id:'test-only-mail-'+mail.length});}});
  runtime=new Miniflare(options);
  const db=await runtime.getD1Database('DB');
  for(const migration of artifact.deploymentSpec.migrations)await db.batch(unstable_splitSqlQuery(migration.sql).map(sql=>db.prepare(sql)));
  const request=(path,init={})=>fetch('http://127.0.0.1:12402'+path,{redirect:'manual',...init,headers:{Origin:'http://127.0.0.1:12402',...init.headers}});
  const publicRequest=(path,init={})=>runtime.dispatchFetch('https://status.lamp.test'+path,init);
  assert.equal((await request('/health')).status,200);
  assert.equal((await request('/setup/status')).status,409);
  const unsetPage=await publicRequest('/');
  assert.equal(unsetPage.status,503);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM page_settings').first()).count,0);
  assert.equal((await request('/__dev/outbox')).status,404);
  assert.doesNotMatch(await (await request('/signin')).text(),/aria-labelledby="setup-title"/);
  assert.equal((await publicRequest('/setup/status')).status,404);
  {const anonymous=await request('/api/app/session');assert.equal(anonymous.status,401,await anonymous.text());}
  const owner={email:'owner@example.test',displayName:'Independent owner',pageName:'Independent Lamp',tagline:'Owner-run infrastructure status',timezone:'UTC'};
  const setup={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:secret,displayName:owner.displayName})};
  assert.equal((await request('/auth/bootstrap',{...setup,body:JSON.stringify({token:'wrong',displayName:owner.displayName})})).status,403);
  assert.equal((await publicRequest('/auth/bootstrap',setup)).status,404);
  assert.equal((await request('/auth/bootstrap',{...setup,headers:{...setup.headers,Origin:'https://other.test'}})).status,403);
  const created=await request('/auth/bootstrap',setup);
  assert.equal(created.status,303);
  assert.equal(Boolean(created.headers.get('set-cookie')),true);
  await db.prepare(setupPageSettingsStatement({pageName:owner.pageName,pageTagline:owner.tagline,pageTimezone:owner.timezone,pageHost:'status.lamp.test',mailFromAddress:'status@example.test',pageAccentColor:'#16794C'})).run();
  assert.equal((await request('/auth/bootstrap',setup)).status,409);
  assert.equal((await request('/setup/status')).status,200);
  assert.equal((await request('/health')).status,200);
  const publicPage=await publicRequest('/');
  assert.equal(publicPage.status,200);
  assert.equal(publicPage.headers.get('set-cookie'),null);
  assert.match(await publicPage.text(),/Independent Lamp/);
  assert.equal((await request('/signin')).status,200);
  assert.equal((await request('/auth/magic-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:owner.email})})).status,202);
  assert.equal(mail.length,1);
  const link=mail[0].text.match(/https?:\/\/[^\s]+/)[0];
  assert.equal((await request(new URL(link).pathname+new URL(link).search,{redirect:'manual'})).status,200);
  const signIn=await request('/auth/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:new URL(link).searchParams.get('token')})});
  assert.equal(signIn.status,303);
  const cookie=signIn.headers.get('set-cookie').split(';')[0];
  assert.equal((await request(new URL(link).pathname+new URL(link).search,{redirect:'manual'})).status,400);
  assert.equal((await request('/api/app/session',{headers:{Cookie:cookie}})).status,200);
  const component=await request('/api/app/components',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'Owner API',description:'Persistent independent component',groupId:null,internal:false,displayOrder:0,note:''})});
  assert.equal(component.status,201,await component.text());
  assert.match(await (await publicRequest('/')).text(),/Owner API/);
  await runtime.dispose();runtime=undefined;
  runtime=new Miniflare(options);await runtime.ready;
  assert.equal((await request('/auth/bootstrap',setup)).status,409,'restart must never reopen bootstrap');
  assert.equal((await request('/api/app/session',{headers:{Cookie:cookie}})).status,200,'real persisted session survives restart');
  assert.match(await (await publicRequest('/')).text(),/Owner API/);
  assert.equal((await request('/api/app/session/signout',{method:'POST',headers:{Cookie:cookie}})).status,204);
  assert.equal((await request('/api/app/session',{headers:{Cookie:cookie}})).status,401);
 }finally{await runtime?.dispose();config.cleanup();await rm(temporary,{recursive:true,force:true});}
});
