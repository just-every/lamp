import assert from 'node:assert/strict';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm,symlink,writeFile,readFile,mkdir,readdir} from 'node:fs/promises';
import {hostname,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {unstable_splitSqlQuery} from 'wrangler';
import {reservePort} from './worker-startup.mjs';
import {operatorHydrated} from './helpers/operator-hydrated.mjs';
import {readDevKey,signInAs} from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import {createRedaction} from '@runeditrun/rer/redaction';

const owner='owner@example.test';
const evidence=process.env.LAMP_AUTH_JOURNEY_EVIDENCE;
async function capture(page,name){if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,name+'.png'),fullPage:true});}}
const run=(root,env,...args)=>spawnSync(process.execPath,['node_modules/@runeditrun/rer/bin/rer.mjs',...args],{cwd:root,env,encoding:'utf8',timeout:600000});
// The journey's copy links the checkout's node_modules, so Vite serves its own client and pre-bundled modules from
// /@fs/<real path>, which rer dev answers only with the checkout's dev key. A real checkout holds them inside its root,
// where no key is needed; here only those module requests carry it, and every application request stays keyless.
async function journeyContext(browser,key){const context=await browser.newContext();await context.route(url=>url.pathname.startsWith('/@fs/'),route=>route.continue({headers:{...route.request().headers(),'x-rer-dev-key':key}}));return context;}
async function accessible(page){const result=await new AxeBuilder({page}).analyze();assert.deepEqual(result.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);}
async function emailSignIn(context,origin,email,width,key){
 const entered=await signInAs({origin,key});await context.addCookies(entered.cookies.map(c=>({...c,url:origin})));
 const page=await context.newPage();await page.setViewportSize({width,height:1000});await page.goto(origin+entered.location);
 const session=await page.request.get(origin+'/api/app/session');assert.equal(session.status(),200);assert.equal((await session.json()).operator.email,email);return page;
}
async function signOut(page,origin){
 const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/app/session/signout'&&response.request().method()==='POST');
 await page.getByRole('button',{name:'Sign out',exact:true}).click();
 const signedOut=await response;
 assert.equal(signedOut.status(),204,'public sign-out revokes the session before navigation');
 const cookie=(await signedOut.request().allHeaders()).cookie;
 assert.equal(Boolean(cookie),true,'sign-out submitted the browser session');
 assert.equal(/(?:^|;)\s*Max-Age=0(?:;|$)/i.test(await signedOut.headerValue('set-cookie')??''),true,'sign-out expires the browser cookie');
 await page.waitForURL(url=>url.pathname==='/signin');
 assert.equal((await page.request.get(origin+'/api/app/session')).status(),401,'browser is unauthenticated after sign-out');
 assert.equal((await fetch(origin+'/api/app/session',{headers:{Cookie:cookie}})).status,401,'the revoked session cannot be replayed');
 const document=await page.request.get(origin+'/app',{maxRedirects:0});
 assert.equal(document.status(),302,'a signed-out operator document redirects');
 assert.equal(new URL(document.headers().location,origin).pathname,'/signin');
 await page.goto(origin+'/app');
 assert.equal(new URL(page.url()).pathname,'/signin','operator documents remain inaccessible after sign-out');
 await page.locator('a[href^="/auth/dev/enter?as=owner&"]').waitFor({state:'visible'});
}
async function denied(origin,archive){for(const path of ['/cdn-cgi/local/explorer/api/local/workers','/cdn-cgi/handler/scheduled','/.rer/local/dev-key.env','/.seed/installer/secrets.json',...(archive?['/exports/probe.rer','/probe.rer','/@fs/'+archive]:[])]){const result=await fetch(origin+path,{redirect:'manual'});assert.equal((path.startsWith('/cdn-cgi/')||path.startsWith('/.rer/')||path.startsWith('/.seed/'))?result.status===404:[403,404].includes(result.status),true,'sensitive route denied: '+path);assert.equal((await result.text()).includes('auth-journey-private-sentinel'),false);}}

async function setupAndProbe(root,env,port,origin){
 const process=spawn(globalThis.process.execPath,['node_modules/@runeditrun/rer/bin/rer.mjs','setup','--owner-email',owner,'--non-interactive','--port',String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 // Capture credential-bearing output without forwarding it to the test reporter.
 process.stdout.resume();process.stderr.resume();let probed=false;
 const ended=new Promise(resolve=>process.once('exit',code=>resolve(code)));
 const deadline=Date.now()+600000;
 try{
  while(process.exitCode===null&&Date.now()<deadline){
   try{const health=await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)});await health.body?.cancel();if(health.status===200){await denied(origin);probed=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(await ended,0,'rer setup succeeds');assert.equal(probed,true,'setup runtime was probed while listening');
 }finally{if(process.exitCode===null){process.kill('SIGTERM');await ended;}}
}

test('SETUP-002 Base setup/dev, one-click sign-in, invite, signout and prior-data upgrade work at 1440 and 390',{timeout:1200000},async t=>{
 t.diagnostic('Execution host: '+hostname());
 const root=await mkdtemp(join(tmpdir(),'lamp-auth-journey-')),servers=await mkdtemp(join(tmpdir(),'lamp-auth-servers-'));
 const cache=await mkdtemp(join(resolve('node_modules'),'.lamp-auth-vite-'));
 const {RER_LOCAL_OPERATION,RER_ONBOARDING_PROCESS_OWNER,AUTH_ORIGIN,AUTH_LOCAL,SESSION_SECRET,SETUP_OPERATOR_EMAIL,...inherited}=process.env;
 // This copy links node_modules. Keep Vite's optimized graph with this
 // checkout, under the already admitted node_modules asset namespace.
 const env={...inherited,LAMP_VITE_CACHE_DIR:cache,RER_SERVER_JOURNEY:'1',RER_SERVERS_DIR:servers,CI:'true',X_LOCAL_EXPLORER:'false'};
 let child,browser;let output='',verb='dev';
 const stop=async()=>{if(child&&child.exitCode===null){run(root,env,verb,'--stop');await new Promise(done=>child.exitCode!==null?done():child.once('exit',done));}child=undefined;};
 try{
  execFileSync('sh',['-c','git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf - | tar -xf - -C "$1"','copy',root]);
  await symlink(resolve('node_modules'),join(root,'node_modules'),'dir');
  const port=await reservePort(),origin=`http://127.0.0.1:${port}`;
  await setupAndProbe(root,env,port,origin);
  browser=await chromium.launch();
  for(const upgraded of [false,true]){
   if(upgraded){
    // An in-place upgrade of an install made before Base sign-in: its saved
    // settings have no SESSION_SECRET or SETUP_TOKEN, and every other value
    // (the subscriber link secret among them) must survive setup unchanged.
    const vars=join(root,'.dev.vars');
    const prior=(await readFile(vars,'utf8')).split('\n').filter(line=>line&&!/^(SESSION_SECRET|SETUP_TOKEN|AUTH_ORIGIN|AUTH_LOCAL)=/.test(line)).join('\n')+'\nLAMP_BOOTSTRAP_SECRET='+'b'.repeat(64)+'\n';
    await writeFile(vars,prior,{mode:0o600});
    await rm(join(root,'.wrangler/state'),{recursive:true,force:true}); // the next store is the captured historical installation
    const fixture=unstable_splitSqlQuery(await readFile('tests/auth-adoption/fixtures/prechange.sql','utf8')).filter(s=>!/^\s*(BEGIN|COMMIT)/.test(s));
    const tables=fixture.filter(s=>/^\s*CREATE TABLE/.test(s));const others=fixture.filter(s=>!tables.includes(s));
    const migrated=(await readdir('migrations/core')).filter(n=>n<'0019');
    const sql=[...tables,'PRAGMA defer_foreign_keys=ON',...others,'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',...migrated.map(name=>`INSERT INTO d1_migrations(name) VALUES ('${name}')`)].join(';\n');
    const path=join(root,'prior.sql');await writeFile(path,sql);
    execFileSync('pnpm',['exec','wrangler','d1','execute','DB','--local','--config','wrangler.jsonc','--persist-to','.wrangler/state','--file',path],{cwd:root,env,stdio:'pipe'});await rm(path);
    await setupAndProbe(root,env,port,origin);
    const upgradedVars=await readFile(vars,'utf8');
    assert.equal(upgradedVars.startsWith(prior),true,'setup keeps every earlier setting');
    for(const name of ['SESSION_SECRET','SETUP_TOKEN'])assert.match(upgradedVars,new RegExp(`^${name}=[0-9a-f]{64}$`,'m'),'setup adds the sign-in secret the earlier install lacked');
   }
   await mkdir(join(root,'exports'),{recursive:true});await writeFile(join(root,'exports/probe.rer'),'auth-journey-private-sentinel');await writeFile(join(root,'probe.rer'),'auth-journey-private-sentinel');
   verb='dev';output='';child=spawn(process.execPath,['node_modules/@runeditrun/rer/bin/rer.mjs','dev'],{cwd:root,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
   const deadline=Date.now()+180000;while(!output.includes('RER_READY ')&&child.exitCode===null&&Date.now()<deadline)await new Promise(done=>setTimeout(done,250));
   if(!output.includes('RER_READY ')){
    const redaction=createRedaction();redaction.addSecrets([await readDevKey(root),...(await readFile(join(root,'.dev.vars'),'utf8')).split('\n').map(line=>line.slice(line.indexOf('=')+1)).filter(Boolean)]);
    t.diagnostic(redaction.redact(output));
   }
   assert.equal(output.includes('RER_READY '),true,'rer dev reaches readiness');
   await denied(origin,join(root,'probe.rer'));
   const key=await readDevKey(root);
   for(const headers of [{},{'x-rer-dev-key':key}])assert.equal((await fetch(origin+'/__dev/outbox',{headers})).status,404,'local dev has no mail outbox, even for the dev key');
   const entered=await signInAs({origin,key});const devContext=await journeyContext(browser,key);await devContext.addCookies(entered.cookies.map(c=>({...c,url:origin})));
   const devPage=await devContext.newPage();await devPage.goto(origin+entered.location);
   const devSession=await devPage.request.get(origin+'/api/app/session');
   if(devSession.status()!==200){const redaction=createRedaction();redaction.addSecrets([key,...(await readFile(join(root,'.dev.vars'),'utf8')).split('\n').map(line=>line.slice(line.indexOf('=')+1)).filter(Boolean)]);t.diagnostic(redaction.redact((await devSession.text())+'\n'+output));}
   assert.equal(devSession.status(),200);
   if(!upgraded){await devPage.getByLabel('Page name').fill('Auth Journey');await devPage.getByRole('button',{name:'Save and open Lamp'}).click();await devPage.waitForURL('**/app');}
   await devContext.close();
   for(const width of [1440,390]){
    const context=await journeyContext(browser,key);const page=await emailSignIn(context,origin,owner,width,key);await accessible(page);
    const identity=await page.request.get(origin+'/auth/settings/identity');assert.equal(identity.status(),200);assert.equal((await identity.json()).idpSignIn,false);
    const discovery=await page.request.get(origin+'/.well-known/rer-dependencies');assert.equal(discovery.status(),200);assert.equal((await discovery.json()).dependencies.some(d=>d.interface==='oidc-provider@1'&&d.optional),true);
    if(!upgraded){
     await capture(page,'workspace-'+width);const landing=await context.newPage();await landing.setViewportSize({width,height:1000});await landing.goto(origin+'/');await capture(landing,'landing-'+width);await landing.close();
     await page.goto(origin+'/app/settings');
     await operatorHydrated(page);
     const operators=page.getByRole('region',{name:'Operators',exact:true});
     const pending=page.getByRole('region',{name:'Pending invitations'});
     const email=`invited-${width}@example.test`,cancelledEmail=`cancelled-${width}@example.test`;
     for(const [address,name] of [[email,'Invited operator'],[cancelledEmail,'Cancelled operator']]){
      await operators.getByLabel('Email',{exact:true}).fill(address);
      await operators.getByLabel('Name',{exact:true}).fill(name);
      const invited=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/app/operators/invite'&&response.request().method()==='POST');
      await operators.getByRole('button',{name:'Invite operator',exact:true}).click();
      assert.equal((await invited).status(),202);
      await pending.getByText(address,{exact:true}).waitFor({state:'visible'});
     }
     await accessible(page);
     const cancelledRow=pending.locator('.operator-row').filter({hasText:cancelledEmail});
     page.once('dialog',dialog=>dialog.accept());
     await cancelledRow.getByRole('button',{name:'Erase personal data',exact:true}).click();
     await cancelledRow.waitFor({state:'detached'});
     await accessible(page);
     assert.equal((await page.request.get(origin+'/api/app/operators/invited')).status(),200);
    }else{assert.equal(new URL(page.url()).pathname,'/app','prior first-run completion survives');}
    if(!upgraded&&width===1440){
     const location=new URL(page.url()).pathname;
     // Fail only the network edge: the real session and rendered shell stay live.
     await page.route('**/api/app/session/signout',route=>route.abort());
     try{
      await page.getByRole('button',{name:'Sign out',exact:true}).click();
      await page.getByRole('alert').waitFor({state:'visible'});
      assert.equal(new URL(page.url()).pathname,location,'a failed sign-out keeps its error visible');
      assert.equal(await page.getByRole('button',{name:'Sign out',exact:true}).isEnabled(),true,'the operator can retry a failed sign-out');
      assert.equal((await page.request.get(origin+'/api/app/session')).status(),200,'an undelivered sign-out leaves its session active');
     }finally{await page.unroute('**/api/app/session/signout');}
    }
    await signOut(page,origin);await accessible(page);await capture(page,'signin-'+width);await context.close();
   }
   await stop();
   verb='preview';output='';child=spawn(process.execPath,['node_modules/@runeditrun/rer/bin/rer.mjs','preview'],{cwd:root,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
   const previewDeadline=Date.now()+180000;while(!output.includes('RER_READY ')&&child.exitCode===null&&Date.now()<previewDeadline)await new Promise(done=>setTimeout(done,250));
   if(!output.includes('RER_READY ')){const redaction=createRedaction();redaction.addSecrets([key,...(await readFile(join(root,'.dev.vars'),'utf8')).split('\n').map(line=>line.slice(line.indexOf('=')+1)).filter(Boolean)]);t.diagnostic(redaction.redact(output));}
   assert.equal(output.includes('RER_READY '),true,'preview reaches readiness');
   await denied(origin,join(root,'probe.rer'));assert.equal((await fetch(origin+'/auth/dev/enter',{redirect:'manual'})).status,404,'production preview omits dev identity');
   await stop();await rm(join(root,'exports/probe.rer'));await rm(join(root,'probe.rer'));
   t.diagnostic((upgraded?'Prior-data':'Fresh')+' journey passed at both widths.');
  }
 }finally{await browser?.close();await stop();await rm(root,{recursive:true,force:true});await rm(servers,{recursive:true,force:true});await rm(cache,{recursive:true,force:true});}
});
