import {secret as sessionSecret} from '../auth-adoption/runtime.mjs';
import {setupPageSettingsStatement} from '../../scripts/ops-config.mjs';
import test from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm,mkdir,writeFile,copyFile,cp} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const wranglerRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');

// Provider responses exist only in this native-runtime test. No real mail is sent.
test('ACCESS-001 SETUP-002 — a packaged installation refuses missing deploy authority, claims its owner, publishes, survives restart and protects a preview', {timeout:240000}, async()=>{
 const temporary=await mkdtemp(resolve('.lamp-independent-'));
 let runtime;
 try {
  // Use the same production build as every other shard. Deployment stops at
  // missing owner authority before any provider operation or second build.
  const refusal=spawnSync(process.execPath,['scripts/deploy.mjs'],{
   env:{PATH:process.env.PATH,HOME:process.env.HOME,LAMP_PAGE_HOST:'status.lamp.test',LAMP_APP_HOST:'app.lamp.test',
    LAMP_PAGE_NAME:'Independent Lamp',LAMP_PAGE_TAGLINE:'Owner status',LAMP_PAGE_TIMEZONE:'UTC',LAMP_ACCENT_COLOR:'#163C60',
    MAIL_FROM_ADDRESS:'status@example.test',SESSION_SECRET:sessionSecret,SETUP_TOKEN:'synthetic-owner-claim-secret-'.repeat(2),SETUP_OPERATOR_EMAIL:'owner@example.test',
    MAIL_PROVIDER_API_KEY:'synthetic-provider-key-'.repeat(2),SUBSCRIBER_TOKEN_SECRET:'synthetic-subscriber-key-'.repeat(2),WEBHOOK_SIGNING_SECRET:'synthetic-webhook-key-'.repeat(2),MAIL_DKIM_SELECTOR:'resend'},
   encoding:'utf8',timeout:10000,
  });
  assert.equal(refusal.status,1,'missing deployment authority prevents provisioning');
  assert.match(refusal.stderr,/CLOUDFLARE_/);
  assert.doesNotMatch(refusal.stderr,/synthetic-provider-key/,'diagnostics keep owner inputs private');
  // The declared artifact command consumes a private copy of the one build.
  const candidate=join(temporary,'candidate');
  await mkdir(join(candidate,'scripts/delivery'),{recursive:true});
  for(const directory of ['dist','migrations'])await cp(directory,join(candidate,directory),{recursive:true});
  for(const name of ['edition.json','rer-setup.json','scripts/delivery/rer-entry.template.mjs'])await copyFile(name,join(candidate,name));
  const producer=resolve('scripts/build-delivery-artifact.mjs');
  const packaged=spawnSync(process.execPath,[producer],{cwd:candidate,encoding:'utf8',timeout:30000});
  assert.equal(packaged.status,0,packaged.stderr);
  const artifactPath=packaged.stdout.trim();
  const artifact=JSON.parse(await readFile(artifactPath,'utf8'));
  const raw=new Map(await Promise.all([...artifact.modules,...artifact.assets].map(async item=>[item.payload,await readFile(resolve(dirname(artifactPath),item.payload))])));
  const mail=[];
  const secret='test-bootstrap-secret-'.repeat(3);
  const bindings={...artifact.deploymentSpec.publicVariables,LAMP_APP_HOST:'127.0.0.1',LAMP_PAGE_HOST:'status.lamp.test',SETUP_TOKEN:secret,SESSION_SECRET:sessionSecret,SETUP_OPERATOR_EMAIL:'owner@example.test',AUTH_ORIGIN:'http://127.0.0.1:12402',AUTH_LOCAL:'true',MAIL_FROM_ADDRESS:'status@example.test',MAIL_PROVIDER_API_KEY:'test-only-provider',SUBSCRIBER_TOKEN_SECRET:'test-subscriber-secret-'.repeat(3),WEBHOOK_SIGNING_SECRET:'test-webhook-secret-'.repeat(3),RER_INSTALLATION_ID:'independent-local'};
  const modules=artifact.modules.map(module=>({type:module.type==='esm'?'ESModule':module.type==='compiled-wasm'?'CompiledWasm':'Text',path:module.name,contents:module.type==='compiled-wasm'?raw.get(module.payload):raw.get(module.payload).toString()}));
  modules.sort((a,b)=>a.path===artifact.mainModule?-1:b.path===artifact.mainModule?1:0);
  const runtimeOptions={port:12402,name:'lamp-independent',modules,compatibilityDate:artifact.deploymentSpec.compatibilityDate,compatibilityFlags:artifact.deploymentSpec.compatibilityFlags,bindings,d1Databases:{DB:'lamp-independent-db'},r2Buckets:{SNAPSHOTS:'lamp-independent-snapshots'},durableObjects:{SNAPSHOT_CACHE:{className:'SnapshotCache',useSQLite:true}},queueProducers:{JOBS:'lamp-independent-jobs'},resourcePersistencePath:join(temporary,'state'),serviceBindings:{ASSETS:async request=>{const asset=artifact.assets.find(asset=>asset.path===new URL(request.url).pathname);return asset?new Response(raw.get(asset.payload),{headers:{'Content-Type':asset.contentType}}):new Response(null,{status:404});}},outboundService:async request=>{assert.equal(new URL(request.url).hostname,'api.resend.com','unexpected external request');mail.push(await request.json());return Response.json({id:'test-only-mail-'+mail.length});}};
  const options=convertV4MiniflareOptions(runtimeOptions);
  runtime=new Miniflare(options);
  const db=await runtime.getD1Database('DB');
  for(const migration of artifact.deploymentSpec.migrations)await db.batch(unstable_splitSqlQuery(migration.sql).map(sql=>db.prepare(sql)));
  const request=(path,init={})=>fetch('http://127.0.0.1:12402'+path,{redirect:'manual',...init,headers:{Origin:'http://127.0.0.1:12402',...init.headers}});
  const publicRequest=(path,init={})=>runtime.dispatchFetch('https://status.lamp.test'+path,init);
  assert.equal((await request('/health')).status,200);
  assert.equal((await request('/setup/status')).status,409);
  const unsetPage=await publicRequest('/');
  assert.equal(unsetPage.status,503);
  assert.equal((await request('/__dev/outbox')).status,404);
  assert.equal((await publicRequest('/setup/status')).status,404);
  {const anonymous=await request('/api/app/session');assert.equal(anonymous.status,401,await anonymous.text());}
  const owner={email:'owner@example.test',displayName:'Independent owner',pageName:'Independent Lamp',tagline:'Owner-run infrastructure status',timezone:'UTC'};
  const setup={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:secret,displayName:owner.displayName})};
  assert.equal((await request('/auth/bootstrap',{...setup,body:JSON.stringify({token:'wrong',displayName:owner.displayName})})).status,403);
  assert.equal((await publicRequest('/auth/bootstrap',setup)).status,404);
  assert.equal((await request('/auth/bootstrap',{...setup,headers:{...setup.headers,Origin:'https://other.test'}})).status,403);
  // A hosted deployment stores the page settings before the owner claims it, and
  // health publishes that page. Until setup the page answers its declared pending status.
  await db.prepare(setupPageSettingsStatement({pageName:owner.pageName,pageTagline:owner.tagline,pageTimezone:owner.timezone,pageHost:'status.lamp.test',mailFromAddress:'status@example.test',pageAccentColor:'#16794C'})).run();
  assert.equal((await request('/health')).status,200);
  assert.equal((await request('/setup/status')).status,409);
  const pendingPage=await publicRequest('/');
  assert.equal(pendingPage.status,503);
  assert.equal(pendingPage.headers.get('cache-control'),'no-store');
  assert.match(await pendingPage.text(),/Independent Lamp/);
  const created=await request('/auth/bootstrap',setup);
  assert.equal(created.status,303);
  assert.equal(Boolean(created.headers.get('set-cookie')),true);
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

  await runtime.dispose();runtime=undefined;
  const previewSecret='synthetic-preview-authority', releaseDigest='synthetic-release-identity';
  runtime=new Miniflare(convertV4MiniflareOptions({...runtimeOptions,bindings:{...bindings,RER_PREVIEW_TOKEN:previewSecret,RER_RELEASE_DIGEST:releaseDigest,RER_VERSION_METADATA:{id:'synthetic-build'}}}));
  await runtime.ready;
  const preview=(path,headers={})=>runtime.dispatchFetch('http://127.0.0.1:12402'+path,{headers,redirect:'manual'});
  assert.equal((await preview('/signin')).status,401,'an uninvited preview visitor cannot reach application or assets');
  const assetPath=artifact.assets.find(asset=>asset.path.endsWith('.js')).path;
  assert.equal((await preview(assetPath)).status,401);
  const grant=(digest=releaseDigest,expiresAt=Date.now()+60000)=>{
   const body=Buffer.from(JSON.stringify({releaseDigest:digest,expiresAt})).toString('base64url');
   return body+'.'+createHmac('sha256',previewSecret).update(body).digest('base64url');
  };
  const token=grant(), opened=await preview('/signin?rer_preview_grant='+token);
  assert.equal(opened.status,303);
  const previewCookie=opened.headers.get('set-cookie').split(';')[0];
  assert.equal((await preview('/signin',{Cookie:previewCookie})).status,200);
  assert.equal((await preview(assetPath,{Cookie:previewCookie})).status,200,'a valid grant admits the emitted browser asset');
  assert.equal((await preview('/__rer/release',{Authorization:'Bearer '+previewSecret})).status,200);
  assert.equal((await preview('/signin?rer_preview_grant='+grant('another-release'))).status,401,'a different release has no authority');
  assert.equal((await preview('/signin?rer_preview_grant='+grant(releaseDigest,Date.now()-1))).status,401,'expired preview authority stays closed');

  // Packaging refuses private input at its public producer door before bytes
  // can become a distributable artifact. Keep the shared build untouched.
  const unsafe=join(temporary,'unsafe');
  await mkdir(join(unsafe,'dist/server/nested'),{recursive:true});
  await writeFile(join(unsafe,'dist/server/index.js'),'export default {};');
  await writeFile(join(unsafe,'dist/server/nested/.dev.vars'),'PRIVATE=synthetic-fixture-only');
  await mkdir(join(unsafe,'dist/client'),{recursive:true});
  await copyFile('edition.json',join(unsafe,'edition.json'));
  await copyFile('rer-setup.json',join(unsafe,'rer-setup.json'));
  const privateCandidate=spawnSync(process.execPath,[producer],{cwd:unsafe,encoding:'utf8',timeout:30000});
  assert.equal(privateCandidate.status,1,'a credential sidecar never ships');
  assert.match(privateCandidate.stderr,/private|credential/i);
 }finally{await runtime?.dispose();await rm(temporary,{recursive:true,force:true});}
});
