import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {getPlatformProxy} from 'wrangler';
import {authFixture,secret} from '../auth-adoption/runtime.mjs';
const run=promisify(execFile);

test('ACCESS-001 terminal command issues an ordinary private 20-minute Base link and audits once; confirmation consumes once',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.lamp-terminal-auth-'));let runtime,db;
 const config=join(dir,'wrangler.json'),state=join(dir,'state'),origin='http://127.0.0.1:39123';
 const env={...process.env,SESSION_SECRET:secret,WRANGLER_SEND_METRICS:'false',X_LOCAL_EXPLORER:'false'};
 // The real command reads installation settings from cwd, independently of
 // --config. Give it the fixture installation, never the checkout's owner key.
 const open=async()=>{runtime=await getPlatformProxy({configPath:config,persist:{path:join(state,'v3')},remoteBindings:false});db=runtime.env.DB;};
 const cli=async(email)=>{
  // Wrangler and the binding proxy must not own the same SQLite state at
  // once. Hand it to the real command, then reopen for durable assertions.
  await runtime.dispose();runtime=undefined;
  try{return await run(process.execPath,[resolve('scripts/signin-link.mjs'),'--email',email,'--origin',origin,'--config',config,'--persist-to',state],{env,cwd:dir});}
  finally{await open();}
 };
 try{
  await writeFile(config,JSON.stringify({name:'lamp-terminal-test',main:resolve('src/server.ts'),compatibility_date:'2026-09-08',d1_databases:[{binding:'DB',database_name:'test',database_id:'00000000-0000-0000-0000-000000000000',migrations_dir:resolve('migrations/core')}]}));
  await run('pnpm',['exec','wrangler','d1','migrations','apply','DB','--local','--config',config,'--persist-to',state],{env});
  await open();
  await db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES ('terminal-owner','owner@example.test','Owner','owner','active',?),('inactive','inactive@example.test','Former','owner','inactive',?),('erased','deleted-erased@operator.invalid','Erased operator','owner','inactive',?)").bind(Date.now(),Date.now(),Date.now()).run();
  const before=Date.now();const result=await cli('owner@example.test');
  assert.equal(result.stderr,'');assert.equal(result.stdout.trim().split('\n').length,1);
  const token=new URL(result.stdout.trim()).searchParams.get('token');assert.equal(Boolean(token),true);
  const row=await db.prepare('SELECT * FROM oa_tokens').first();
  assert.equal(row.expires_at>=before+1200000&&row.expires_at<=Date.now()+1200000,true);
  assert.equal(JSON.stringify(row).includes(token),false);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM oa_sessions').first()).n,0);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_entries WHERE action='sign-in link created from the command line'").first()).n,1);
  let {handle,request}=authFixture(db,{origin});
  const preview=await handle(request('/auth/confirm?token='+token));assert.equal(preview.status,200);assert.equal(preview.headers.has('set-cookie'),false);
  assert.equal((await handle(request('/auth/confirm',{method:'POST',body:{token}}))).status,303);
  assert.equal((await handle(request('/auth/confirm',{method:'POST',body:{token}}))).status,400);
  const second=await cli('owner@example.test');const expired=new URL(second.stdout.trim()).searchParams.get('token');
  ({handle,request}=authFixture(db,{origin}));
  await db.prepare('UPDATE oa_tokens SET expires_at=? WHERE consumed_at IS NULL').bind(Date.now()-1).run();
  assert.equal((await handle(request('/auth/confirm?token='+expired))).status,400);
  let refusal;
  for(const email of ['unknown@example.test','inactive@example.test','deleted-erased@operator.invalid']){
   let failure;try{await cli(email);}catch(e){failure=e;}assert.equal(Boolean(failure),true);assert.equal(failure.stdout,'');
   refusal??=failure.stderr;assert.equal(failure.stderr,refusal);assert.equal(failure.stderr.includes(email),false);
  }
 }finally{await runtime?.dispose();await rm(dir,{recursive:true,force:true});}
});
