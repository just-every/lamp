import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Hono } from 'hono';
import { authFixture, secret, setupToken } from '../auth-adoption/runtime.mjs';
import { load } from '../operator-readiness/runtime.mjs';
import { moveInDoor } from '../helpers/import-notifications.mjs';

async function ownerApi(db, bootstrap) {
  const owner='move-in-owner@example.test';
  const base=authFixture(db,{owner});
  if (bootstrap) {
    const response=await base.handle(base.request('/auth/bootstrap',{method:'POST',body:{token:setupToken,displayName:'Move-in owner'}}));
    assert.equal(response.status,303);
  }
  const cookie=await base.signIn();
  const modules=await load('tests/auth-adoption/adapter.ts');
  const bindings={DB:db,LAMP_APP_HOST:'app.example.test',AUTH_ORIGIN:base.origin,AUTH_LOCAL:'false',SETUP_OPERATOR_EMAIL:owner,SESSION_SECRET:secret,SETUP_TOKEN:setupToken,MAIL_FROM_ADDRESS:'lamp@example.test'};
  const auth=modules.createLampAuth(bindings);
  const app=new Hono();
  app.use('/api/app/*',modules.requireOperator(()=>auth));
  modules.registerOperatorRoutes(app,()=>auth,'page.example.test');
  const imports=modules.createStatuspageImportService(db,{
    async inviteSubscriber(){assert.fail('Archive restoration must not send invitations.');},
    async publicDataChanged(){},
  });
  modules.registerStatuspageImportRoutes(app,imports);
  modules.registerImportDoor(app,bindings,imports,async()=>{},()=>auth);
  const moveIn=moveInDoor(async (path,body,headers={}) => {
    const request=base.request(path,{cookie,method:body===undefined?'GET':'POST',body});
    request.headers.set('CF-Connecting-IP','192.0.2.10');
    for (const [name,value] of Object.entries(headers)) request.headers.set(name,value);
    const response=await app.fetch(request,bindings);
    return {status:response.status,body:await response.json()};
  });
  const ok=response => { assert.equal(response.status,200,JSON.stringify(response.body)); return response.body; };
  return {preview:async input=>ok(await moveIn.preview(input)),apply:async plan=>ok(await moveIn.apply(plan)),undo:async door=>ok(await moveIn.undo(door))};
}

export async function importHistoryForRestore(db) {
  const api=await ownerApi(db,true);
  const directory='tests/fixtures/betterstack/small';
  const files=await Promise.all((await readdir(directory)).filter(name=>!name.startsWith('webhook-')).map(async name=>({name,text:await readFile(`${directory}/${name}`,'utf8')})));
  const reports=JSON.parse(files.find(file=>file.name==='status-reports.json').text).data;
  const report=reports.find(row=>row.attributes.report_type==='maintenance');
  for (const file of files.filter(file=>file.name.startsWith(`status-updates-${report.id}`))) {
    const raw=JSON.parse(file.text);
    raw.data.forEach(row=>{row.attributes.published_at='2025-01-03T09:30:00.000Z';});
    file.text=JSON.stringify(raw);
  }
  const result=await api.apply(await api.preview({source:'betterstack',publicAccessAcknowledged:true,files}));
  assert.equal(result.job.state,'completed');
  const maintenance=await db.prepare('SELECT id FROM maintenance WHERE title=?').bind(report.attributes.title).first();
  const history=(await db.prepare('SELECT * FROM import_maintenance_updates WHERE maintenance_id=? ORDER BY published_at,id').bind(maintenance.id).all()).results;
  assert.equal(history.length,3);
  assert.equal(new Set(history.map(row=>row.published_at)).size,1);
  return {door:result.door,maintenanceId:maintenance.id,history};
}

export async function undoHistoryAfterRestore(db,imported) {
  const history=(await db.prepare('SELECT * FROM import_maintenance_updates WHERE maintenance_id=? ORDER BY published_at,id').bind(imported.maintenanceId).all()).results;
  assert.deepEqual(history,imported.history,'the full archive retains every same-time imported maintenance update');
  const api=await ownerApi(db,false);
  const result=await api.undo(imported.door);
  assert.equal(result.job.state,'undone');
  const disposition=result.undo.dispositions.find(row=>row.targetKind==='maintenance'&&row.targetId===imported.maintenanceId);
  assert.ok(disposition);
  assert.equal(disposition.disposition,'reversed');
  assert.equal(disposition.reason,'unchanged');
  assert.equal(await db.prepare('SELECT id FROM maintenance WHERE id=?').bind(imported.maintenanceId).first(),null);
  assert.equal((await db.prepare('SELECT count(*) n FROM import_maintenance_updates WHERE maintenance_id=?').bind(imported.maintenanceId).first()).n,0);
  assert.ok(await db.prepare("SELECT id FROM maintenance WHERE id='maintenance-export'").first(),'undo preserves the separately restored native maintenance');
}
