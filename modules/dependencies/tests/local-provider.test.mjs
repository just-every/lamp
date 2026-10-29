import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './runtime.mjs';
import { createDependencies } from '../index.mjs';

async function signIn(r) {
 const start=await r.call('/auth/oidc/auth/start',{body:{}});assert.equal(start.status,303,await start.clone().text());
 const grant=await r.idp.authorize(start.headers.get('location'),{});
 return r.call(`/auth/oidc/auth/callback?code=${grant.code}&state=${grant.state}`,{cookie:start.headers.get('set-cookie')});
}
const setup=(r,issuer)=>r.call('/auth/dependencies/setup',{body:{issuer,interface:'oidc-provider@1',token:'setup-secret-only-for-test-thirty-two-bytes'}});

test('under rer dev a seed links to a seed on http loopback, whatever the port and loopback spelling, and signs in through it',async t=>{
 for(const issuer of ['http://127.0.0.1:9787','http://localhost:9788','http://[::1]:9789']){
  const r=await runtime(t,{local:true,issuer});
  await r.bootstrap();
  assert.equal((await r.link()).status,200,issuer);
  assert.equal((await signIn(r)).status,303,issuer);
 }
});

test('a hosted app refuses http loopback providers; production still needs https',async t=>{
 const r=await runtime(t);
 for(const issuer of ['http://127.0.0.1:9787','http://localhost:9788','http://[::1]:9789'])assert.equal((await setup(r,issuer)).status,400,issuer);
 assert.throws(()=>createDependencies({db:r.db,origin:'https://app.example',name:'App',provider:'https://auth.example',local:true,auth:{}}),{code:'invalid_link'});
});

test('http to anything but loopback is refused even under rer dev',async t=>{
 const r=await runtime(t,{local:true});
 for(const issuer of ['http://auth.example','http://127.0.0.1.evil.example','http://192.0.2.7:9787','http://user@127.0.0.1:9787'])assert.equal((await setup(r,issuer)).status,400,issuer);
 assert.equal((await setup(r,'https://auth.example')).status,200);
});
