import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,rm,stat,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {startInstaller} from '@runeditrun/rer/installer-server';
import {install} from '../scripts/installer/install.mjs';
import {createSeed} from '../scripts/installer/seed.mjs';
import {createInstallerModel} from '@runeditrun/rer/setup-manifest';
import {createSecretVault} from '@runeditrun/rer/internal/onboarding/secrets.mjs';
import {installationFailureMessage} from '@runeditrun/rer/failures';
import {hostLamp} from '../scripts/installer/hosting.mjs';
import {nativeSecrets} from '../scripts/installer/secrets.mjs';
import {deploymentConfig} from '../scripts/ops-config.mjs';
import * as browser from '../scripts/installer/ui/seed.mjs';
test('local-first Lamp browser setup saves only nonsecret fields and requires deliberate start',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lamp-installer-'));
 let server;
 try {
  await cp('rer-setup.json',join(root,'rer-setup.json'));
  await cp('scripts/installer/ui',join(root,'scripts/installer/ui'),{recursive:true});
  // The seed declares its theme, public/rer-theme.css, and the installer serves it and its files.
  await cp('public',join(root,'public'),{recursive:true});
  const seed=createSeed();
  server=await startInstaller(root,{seed,noPrefill:true});
  const page=await fetch(server.origin);
  const cookie=page.headers.get('set-cookie').split(';')[0];
  const token=(await page.text()).match(/name="installer-token" content="([^"]+)"/)[1];
  const headers={Cookie:cookie,'x-installer-token':token,Origin:server.origin,'Content-Type':'application/json'};
  const post=(path,value,extra={})=>fetch(server.origin+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(value)});
  assert.equal((await post('/api/draft',{SETUP_OPERATOR_EMAIL:'owner@example.test',LAMP_PAGE_NAME:'Owner lamp'})).status,200);
  assert.equal((await post('/api/draft',{SETUP_TOKEN:'private-token'})).status,400);
  assert.equal((await post('/api/start',{}, {Origin:'https://untrusted.test'})).status,403);
  const state=await (await fetch(server.origin+'/api/state',{headers})).json();
  assert.equal(state.phase,'ready');
  assert.equal(state.draft.LAMP_PAGE_NAME,'Owner lamp');
  const file=join(root,'.seed/installer/state.json');
  assert.equal((await stat(file)).mode&0o777,0o600);
  assert.doesNotMatch(await readFile(file,'utf8'),/private-token|bootstrapSecret|mailApiKey/);
  await server.close();server=undefined;
  server=await startInstaller(root,{seed,resume:true});
  assert.equal(server.state.draft.LAMP_PAGE_NAME,'Owner lamp');
  assert.equal(server.state.phase,'ready');
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});
test('one manifest makes local sign-in key-free and offers one shared hosting target',async()=>{
 const manifest=JSON.parse(await readFile('rer-setup.json','utf8'));
 const model=createInstallerModel(manifest,browser);
 const common={SESSION_SECRET:'test-only-session-secret-'.repeat(3),SETUP_TOKEN:'test-only-setup-token-'.repeat(3),SETUP_OPERATOR_EMAIL:'owner@example.test',OWNER_DISPLAY_NAME:'Owner',LAMP_PAGE_NAME:'Owner page',LAMP_PAGE_TAGLINE:'Status',LAMP_PAGE_TIMEZONE:'UTC'};
 assert.equal(model.setupModel({...common,target:'local'}).ready,true);
 assert.equal(model.setupModel({...common,target:'remote'}).ready,false);
 assert.equal(model.setupModel({...common,target:'remote',accountId:'a'.repeat(32),prefix:'lamp-page',appOrigin:'https://app.example.test',apiToken:'synthetic-owner-credential'}).ready,true);
 assert.equal(model.fields.INSTALL_TARGET,undefined);
});

test('native-invalid setup stops with value-free guidance before any installation effect',async()=>{
 const common={target:'local',SESSION_SECRET:'test-only-session-secret-'.repeat(3),SETUP_TOKEN:'test-only-setup-token-'.repeat(3),SETUP_OPERATOR_EMAIL:'owner@example.test',OWNER_DISPLAY_NAME:'Owner',LAMP_PAGE_NAME:'Owner page',LAMP_PAGE_TAGLINE:'Status',LAMP_PAGE_TIMEZONE:'UTC'};
 for(const [changes,field] of [
  [{OWNER_DISPLAY_NAME:'x'.repeat(121)},'OWNER_DISPLAY_NAME'],
  [{LAMP_PAGE_NAME:'x'.repeat(121)},'LAMP_PAGE_NAME'],
  [{LAMP_PAGE_TAGLINE:'x'.repeat(281)},'LAMP_PAGE_TAGLINE'],
 ]){
  const steps=[];
  // No command, file, request or state callback is available at this boundary.
  await assert.rejects(install('/nonexistent-lamp-installer-fixture',{...common,...changes},{step:async value=>steps.push(value)},()=>{}),error=>{
   assert.match(installationFailureMessage(error),/Installation stopped while setting up/);
   return true;
  });
  assert.ok(steps.at(-1).includes(field));
  assert.doesNotMatch(steps.join('\n'),/xxx|app\.example\.test/);
 }
});

test('hosting credentials invalidate when their Cloudflare account or mail identity changes',async()=>{
 const manifest=JSON.parse(await readFile('rer-setup.json','utf8'));
 const model=createInstallerModel(manifest,browser);
 const draft={target:'remote',accountId:'a'.repeat(32),MAIL_PROVIDER:'sendgrid',MAIL_FROM_ADDRESS:'owner@example.test'};
 for(const [key,changed] of [['apiToken',{accountId:'b'.repeat(32)}],['MAIL_PROVIDER_API_KEY',{MAIL_PROVIDER:'resend'}],['MAIL_PROVIDER_API_KEY',{MAIL_FROM_ADDRESS:'different@example.test'}]]){
  const vault=createSecretVault(model);
  vault.set({[key]:'synthetic-in-memory-only-fixture-credential'},draft);
  const destination={...draft,...changed};
  vault.invalidate(destination);
  assert.equal(vault.readiness(destination)[key],false);
  assert.equal(vault.merge(destination,destination)[key],undefined);
 }
});

test('native hosting carries owner credentials through captured commands and binds the destination',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lamp-hosting-'));
 try{
  const git=args=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
  git(['init']);git(['config','user.email','fixture@example.test']);git(['config','user.name','Fixture']);
  await writeFile(join(root,'rer-project.json'),JSON.stringify({projectId:'just-every/lamp',sourceRepository:'https://github.com/just-every/run-lamp'}));
  git(['add','.']);git(['commit','-m','Fixture']);
  const credential='synthetic-in-memory-only-hosting-credential';
  const input={target:'remote',accountId:'a'.repeat(32),apiToken:credential,prefix:'owner-lamp',appOrigin:'https://operator.example.test',
   LAMP_PAGE_HOST:'status.example.test',LAMP_HOSTING:'custom-domain',SESSION_SECRET:'test-only-session-secret-'.repeat(3),SETUP_TOKEN:'test-only-setup-token-'.repeat(3),SETUP_OPERATOR_EMAIL:'owner@example.test',OWNER_DISPLAY_NAME:'Chosen owner',
   LAMP_PAGE_NAME:'Owner page',LAMP_PAGE_TAGLINE:'Service status',LAMP_PAGE_TIMEZONE:'UTC',LAMP_ACCENT_COLOR:'#123456',
   MAIL_PROVIDER:'sendgrid',MAIL_FROM_ADDRESS:'status@example.test',MAIL_DKIM_SELECTOR:'s1',
   MAIL_PROVIDER_API_KEY:credential};
  const events=[],state={};let failDeployment=true;
  const store={state,setupManifest:JSON.parse(await readFile('rer-setup.json','utf8')),addSecrets:secrets=>events.push({kind:'secrets',registered:Object.values(secrets).every(value=>value===credential)}),
   phase:async value=>{state.phase=value;},step:async()=>{},stopCommands:async()=>events.push({kind:'cleanup'}),
   // The command transport is the effect boundary. This never creates a fake
   // pnpm executable, contacts a provider or claims an actual deployment.
   run:async(label,command,args,options)=>{
    const event={kind:'command',command,args};
    if(args[0]==='scripts/deploy.mjs'){
     assert.equal(options.env.CLOUDFLARE_API_TOKEN,credential);
     assert.equal(options.env.MAIL_PROVIDER_API_KEY,credential);
     const native=deploymentConfig(options.env);
     assert.equal(native.setupOperatorDisplayName,'Chosen owner');
     assert.equal(native.setupOperatorDisplayName,'Chosen owner');
     const generated=JSON.parse(await readFile(join(root,'.seed/installer/hosting/secrets.json'),'utf8'));
     assert.ok(generated.SUBSCRIBER_TOKEN_SECRET.length>=32&&generated.WEBHOOK_SIGNING_SECRET.length>=32);
     assert.ok(options.env.SUBSCRIBER_TOKEN_SECRET===generated.SUBSCRIBER_TOKEN_SECRET&&options.env.WEBHOOK_SIGNING_SECRET===generated.WEBHOOK_SIGNING_SECRET);
     event.ownerCredentialsPassed=true;
    }
    events.push(event);
    if(failDeployment&&args[0]==='scripts/deploy.mjs')throw Error('Synthetic command transport failure');
   }};
  await assert.rejects(hostLamp({root,input,store}),error=>{
   assert.match(installationFailureMessage(error),/Installation stopped while deploying/);
   return true;
  });
  assert.equal(state.hostedUrl,undefined);
  assert.equal(JSON.parse(await readFile(join(root,'.seed/installer/hosted-receipt.json'),'utf8')).completed,false);
  assert.equal(events.at(-1).kind,'cleanup');
  const saved=await readFile(join(root,'.seed/installer/hosting/secrets.json'),'utf8');
  assert.equal((await stat(join(root,'.seed/installer/hosting/secrets.json'))).mode&0o777,0o600);
  assert.ok(!saved.includes(credential));
  failDeployment=false;events.length=0;
  await hostLamp({root,input,store});
  assert.ok(await readFile(join(root,'.seed/installer/hosting/secrets.json'),'utf8')===saved);
  assert.equal(events[0].kind,'secrets');assert.equal(events[0].registered,true);
  assert.deepEqual(events.filter(event=>event.kind==='command').map(event=>event.args),[['install','--frozen-lockfile'],['scripts/deploy.mjs']]);
  assert.equal(events.at(-1).ownerCredentialsPassed,true);
  const receipt=JSON.parse(await readFile(join(root,'.seed/installer/hosted-receipt.json'),'utf8'));
  assert.equal(receipt.completed,true);assert.equal(receipt.identity.appOrigin,input.appOrigin);
  assert.doesNotMatch(JSON.stringify(receipt),/synthetic-in-memory/);
  for(const changed of [{accountId:'b'.repeat(32)},{appOrigin:'https://changed.example.test'},{SESSION_SECRET:'test-only-session-secret-'.repeat(3),SETUP_TOKEN:'test-only-setup-token-'.repeat(3),SETUP_OPERATOR_EMAIL:'different@example.test'},{prefix:'different-lamp'}]){
   const before=events.filter(event=>event.kind==='command').length;
   await assert.rejects(hostLamp({root,input:{...input,...changed},store}));
   assert.equal(events.filter(event=>event.kind==='command').length,before);
   assert.equal(events.at(-1).kind,'cleanup');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('online setup names missing inputs and rejects insecure destinations before commands or private writes',async()=>{
 const input={target:'remote',accountId:'a'.repeat(32),apiToken:'synthetic-token',prefix:'owner-lamp',appOrigin:'https://operator.example.test',LAMP_PAGE_HOST:'status.example.test',LAMP_HOSTING:'custom-domain',LAMP_ACCENT_COLOR:'#123456',MAIL_PROVIDER:'sendgrid',MAIL_FROM_ADDRESS:'status@example.test',MAIL_DKIM_SELECTOR:'s1',MAIL_PROVIDER_API_KEY:'synthetic-in-memory-only-provider-credential'};
 for(const [changed,expected] of [[{MAIL_DKIM_SELECTOR:''},'MAIL_DKIM_SELECTOR'],[{appOrigin:'http://operator.example.test'},'exact HTTPS'],[{appOrigin:'https://operator.example.test/path'},'exact HTTPS']]){
  const steps=[];
  await assert.rejects(hostLamp({root:'/nonexistent-hosting-fixture',input:{...input,...changed},store:{addSecrets:()=>{},step:async value=>steps.push(value)}}));
  assert.ok(steps.at(-1).includes(expected));
  assert.doesNotMatch(steps.join('\n'),/synthetic|operator\.example/);
 }
});

test('canonical managed-secret generation preserves existing local credentials and origin',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lamp-local-secrets-'));
 try{
  const directory=join(root,'.seed/installer/runtime');await mkdir(directory,{recursive:true});
  const fixture='synthetic-in-memory-local-credential';
  const existing={LAMP_LOCAL_ORIGIN:'http://127.0.0.1:54321',SETUP_TOKEN:fixture,SESSION_SECRET:fixture,SUBSCRIBER_TOKEN_SECRET:fixture,WEBHOOK_SIGNING_SECRET:fixture};
  const before=JSON.stringify(existing);await writeFile(join(directory,'secrets.json'),before,{mode:0o600});
  const registered=[];
  const store={setupManifest:JSON.parse(await readFile('rer-setup.json','utf8')),step:async()=>{},addSecrets:values=>registered.push(...Object.values(values))};
  const values=await nativeSecrets(root,store,'runtime',existing.LAMP_LOCAL_ORIGIN);
  assert.ok(JSON.stringify(values)===before);
  assert.ok(await readFile(join(directory,'secrets.json'),'utf8')===before);
  assert.ok(registered.includes(fixture));
 }finally{await rm(root,{recursive:true,force:true});}
});
