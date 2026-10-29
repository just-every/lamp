import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { load } from '../operator-readiness/runtime.mjs';
import { authFixture, secret, setupToken } from './runtime.mjs';

export async function portableRole(db) {
  const id=crypto.randomUUID(),email=['synthetic-lamp-'+id,'example.test'].join('@');
  await db.batch([
    db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES(?,?,'Synthetic Lamp portable responder','member','active',?)").bind(id,email,Date.now()),
    db.prepare("INSERT INTO operator_roles(operator_id,role) VALUES(?,'responder')").bind(id),
  ]);
  const fixture=authFixture(db),cookie=await fixture.signIn(email);
  const person=await db.prepare('SELECT * FROM oa_operators WHERE id=?').bind(id).first();
  return {id,email,cookie,person};
}

export async function restoredRole(db,prior) {
  assert.deepEqual(await db.prepare('SELECT * FROM oa_operators WHERE id=?').bind(prior.id).first(),prior.person,'native restore preserves role authority metadata without advancing its version');
  assert.equal((await db.prepare('SELECT role FROM operator_roles WHERE operator_id=?').bind(prior.id).first()).role,'responder');
  const fixture=authFixture(db);
  assert.equal(await fixture.auth.getSession(fixture.request('/auth/session',{cookie:prior.cookie})),null,'restored role metadata does not restore sessions');
  const {createLampAuth,requireOperator,registerOperatorRoutes,registerAuditLogRoutes,createAuditLogRepository}=await load('tests/auth-adoption/adapter.ts');
  const bindings={DB:db,LAMP_APP_HOST:'app.example.test',SETUP_OPERATOR_EMAIL:['owner','example.test'].join('@'),SESSION_SECRET:secret,SETUP_TOKEN:setupToken};
  const auth=createLampAuth(bindings),app=new Hono();
  app.use('/api/app/*',requireOperator(()=>auth));registerOperatorRoutes(app,()=>auth,'page.example.test');registerAuditLogRoutes(app,createAuditLogRepository(db));
  const cookie=await fixture.signIn(prior.email);
  const call=path=>app.fetch(fixture.request(path,{cookie}),bindings);
  const session=await call('/api/app/session');assert.equal(session.status,200);assert.equal((await session.json()).operator.role,'responder');
  assert.equal((await call('/api/app/audit-log')).status,403,'restoring a Responder never grants manager access');
}
