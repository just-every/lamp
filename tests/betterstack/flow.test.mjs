import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { contract } from '../contract.mjs';
import { lampRuntime, moveIn } from '../auth-adoption/lamp-runtime.mjs';
import { load } from '../operator-readiness/runtime.mjs';
const native = await load('tests/betterstack/reader-adapter.ts');
const fixture=family=>readdirSync(`tests/fixtures/betterstack/${family}`).map(name=>({name,text:readFileSync(`tests/fixtures/betterstack/${family}/${name}`,'utf8')}));
const sourceBody=files=>({source:'betterstack',publicAccessAcknowledged:true,files});
const endpoint=id=>`/api/app/statuspage-import/jobs/${id}`;
async function api(r,path,body){const response=await r.call(path,{cookie:r.cookie,...(body?{method:'POST',body}:{})});return {status:response.status,body:await response.json()};}
async function preview(r,files){const response=await moveIn(r,r.cookie).preview(sourceBody(files));assert.equal(response.status,200,JSON.stringify(response.body));return response.body;}
async function apply(r,body){const result=await moveIn(r,r.cookie).apply(body);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.job.state,'completed');return result.body;}
async function undo(r,result){const undone=await moveIn(r,r.cookie).undo(result.door);assert.equal(undone.status,200,JSON.stringify(undone.body));return undone;}
const count=async(r,table)=>(await r.db.prepare(`SELECT count(*) n FROM ${table}`).first()).n;

async function ownerRuntime(t) {
  const r=await lampRuntime(t,{registerRoutes({app,db,modules}) {
    // Register production routes before the runtime makes its first request.
    // Only outward snapshot/overrun dispatch stays at the network edge.
    const components=modules.createComponentsService(modules.createComponentRepository(db),async()=>{});
    modules.registerComponentRoutes(app,components);
    const maintenance=native.createMaintenanceService(native.createMaintenanceRepository(db),components,async()=>{}, {
      forMaintenanceNotice:async input=>native.notificationPublicationStatements(db,{eventId:input.eventId,eventType:'maintenance-notice',maintenanceId:input.maintenanceId,componentIds:input.componentIds,channels:['email','webhook'],queuedAt:input.queuedAt,recipientScope:input.recipientScope,previousEventIds:input.previousEventIds}),
    },undefined,async()=>{});
    native.registerMaintenanceRoutes(app,maintenance);
  }});
  const pending=[];
  r.call=(path,options={})=>r.app.fetch(r.request(path,options),r.bindings,{waitUntil:promise=>pending.push(promise),passThroughOnException(){}});
  t.after(async()=>{await Promise.all(pending);});
  return r;
}

function withScheduledWindow(files) {
  const response=files.find(file=>file.name.startsWith('status-reports')&&JSON.parse(file.text).data.some(row=>row.attributes.report_type==='maintenance'));
  const raw=JSON.parse(response.text),window=raw.data.find(row=>row.attributes.report_type==='maintenance');
  window.attributes.starts_at=new Date(Date.now()+24*60*60*1000).toISOString();
  window.attributes.ends_at=new Date(Date.now()+25*60*60*1000).toISOString();
  response.text=JSON.stringify(raw);
  return files;
}

contract('MOVE-001','Better Stack owner flow counts the complete source, preserves timelines and shared silence/idempotence/conditional undo',async t=>{
  const r=await ownerRuntime(t);
  const files=withScheduledWindow(fixture('large'));
  const resourceFile=files.find(file=>file.name==='resources.json');
  const resources=JSON.parse(resourceFile.text);
  resources.data.at(-1).attributes.status='degraded';
  const importedClaimName=resources.data.at(-1).attributes.public_name;
  const operatorClaimName=resources.data.at(-2).attributes.public_name;
  resourceFile.text=JSON.stringify(resources);
  const reviewed=await preview(r,files);
  assert.equal(await count(r,'components'),0);
  const result=await apply(r,reviewed);
  assert.equal(result.job.namespace,'betterstack');
  assert.deepEqual(Object.fromEntries(Object.entries(result.report.counts).map(([kind,row])=>[kind,[row.read,row.imported+row.changed,row.skipped,row.rejected]])),{group:[4,4,0,0],component:[12,12,0,0],incident:[36,36,0,0],maintenance:[3,3,0,0],subscriber:[160,159,1,0]});
  assert.deepEqual(await Promise.all(['component_groups','components','incidents','incident_updates','maintenance','import_maintenance_updates','subscribers'].map(table=>count(r,table))),[4,12,36,72,3,9,159]);
  assert.equal(await count(r,'maintenance_notices'),0);
  assert.equal(await count(r,'notification_deliveries'),0);assert.equal(r.messages.length,0);
  const cutover=(await api(r,endpoint(result.job.id))).body.report.cutover;
  assert.equal(cutover.total,4);assert.deepEqual(cutover.feeds,['/feed.atom']);
  assert.ok(cutover.readerGaps.join(' ').includes('/index.json'));assert.ok(!JSON.stringify(cutover).includes('/history.atom'));
  assert.ok(cutover.unavailable.some(reason=>reason.includes('no documented public address')));
  const before=await count(r,'ik_provenance');
  assert.equal((await apply(r,reviewed)).job.id,result.job.id);
  assert.equal(await count(r,'ik_provenance'),before);
  assert.equal(r.messages.length,0);
  const importedClaimComponent=await r.db.prepare('SELECT id FROM components WHERE name=?').bind(importedClaimName).first();
  assert.equal((await r.db.prepare('SELECT state FROM component_standing_claims WHERE component_id=?').bind(importedClaimComponent.id).first()).state,'Degraded performance');
  const operatorClaimComponent=await r.db.prepare('SELECT id FROM components WHERE name=?').bind(operatorClaimName).first();
  const claim=await r.call(`/api/app/components/${operatorClaimComponent.id}/standing-claim`,{cookie:r.cookie,method:'PUT',body:{state:'Major outage'}});
  assert.equal(claim.status,200,await claim.text());
  // Production initialization persists the installation's feed identity before rendering.
  await native.createPageSettingsService(native.createPageSettingsRepository(r.db),async()=>{},undefined,r.bindings.MAIL_FROM_ADDRESS).ensureInitial({
    pageName:'Synthetic status',tagline:'',accentColor:'#2563eb',timezone:'UTC',hostname:'status.example',footerCreditEnabled:true,
  });
  const source=await native.createSnapshotRepository(r.db).load();
  assert.ok(source);
  const rendered=native.renderPublicSnapshot(source,'2025-02-01T00:00:00Z');
  const pages=rendered.artifacts.filter(row=>row.key.startsWith('maintenance/'));
  assert.equal(pages.length,3);
  for(const row of source.importedMaintenanceUpdates) assert.ok(pages.some(page=>page.body.includes(row.body)&&page.body.includes(row.publishedAt)));
  const history=await native.createMaintenanceRepository(r.db).listImportedUpdates(source.maintenance[0].id);assert.equal(history.length,3);
  assert.ok(!rendered.artifacts.find(row=>row.key==='feed.atom').body.includes('maintenance 37 original update'));
  const edited=source.maintenance.find(row=>row.state==='Scheduled');assert.ok(edited);
  const cancelled=await api(r,`/api/app/maintenance/${edited.id}/cancel`,{});
  assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));assert.equal(cancelled.body.maintenance.state,'Cancelled');
  const undone=await undo(r,result);
  assert.equal(undone.body.job.state,'undone');
  assert.equal(await count(r,'maintenance'),1);assert.equal(await count(r,'import_maintenance_updates'),3);
  assert.equal(await r.db.prepare('SELECT id FROM components WHERE id=?').bind(importedClaimComponent.id).first(),null);
  assert.equal(await r.db.prepare('SELECT id FROM component_standing_claims WHERE component_id=?').bind(importedClaimComponent.id).first(),null);
  assert.equal((await r.db.prepare('SELECT state FROM component_standing_claims WHERE component_id=?').bind(operatorClaimComponent.id).first()).state,'Major outage');
  assert.ok(undone.body.undo.dispositions.some(row=>row.disposition==='retained'&&row.reason));
  assert.equal(r.messages.length,0);
});

contract('MOVE-002','Better Stack refuses unsafe preview and stale source/target, sends explicit invitations once, and preserves current cross-source undo',async t=>{
  const r=await ownerRuntime(t);
  for(const [text,reason] of [['{invalid',/invalid Better Stack JSON/],['[]',/invalid Better Stack JSON/],['x'.repeat(8*1024*1024+1),/8 MiB/]]) {
    const refused=await moveIn(r,r.cookie).preview(sourceBody([{name:'status-page.json',text}]));
    assert.equal(refused.status,400,JSON.stringify(refused.body));assert.match(refused.body.error,reason);assert.doesNotMatch(refused.body.error,/[\r\n]/);
    assert.equal(await count(r,'ik_jobs'),0);assert.equal(await count(r,'components'),0);
  }
  const files=fixture('small');
  const review=await preview(r,files);
  const changedFiles=structuredClone(files); const page=changedFiles.find(f=>f.name==='status-page.json');const raw=JSON.parse(page.text);raw.data.attributes.company_name='Changed source';page.text=JSON.stringify(raw);
  const changed=await preview(r,changedFiles);
  assert.equal((await moveIn(r,r.cookie).apply(changed,review.fingerprint)).status,403,'a reviewed fingerprint applies only the source it reviewed');
  const reviewed=await preview(r,files);
  const group=await api(r,'/api/app/component-groups',{name:'Operator group',displayOrder:1});assert.equal(group.status,201,JSON.stringify(group.body));
  const stale=await moveIn(r,r.cookie).apply(reviewed);
  assert.equal(stale.status,409,JSON.stringify(stale.body));assert.equal(stale.body.error,'The source or this page changed since the dry run. Review a fresh dry run.');
  assert.equal(await count(r,'ik_jobs'),0);assert.equal(await count(r,'components'),0);assert.equal(await count(r,'component_groups'),1);
  const result=await apply(r,await preview(r,files));
  assert.equal(r.messages.length,0);
  await moveIn(r,r.cookie).apply(result.door);await api(r,endpoint(result.job.id));assert.equal(r.messages.length,0);
  assert.equal((await api(r,`${endpoint(result.job.id)}/send-invitations`,{})).status,200);
  await api(r,`${endpoint(result.job.id)}/send-invitations`,{});
  assert.equal(r.messages.length,3);assert.equal(new Set(r.messages.map(row=>row.to)).size,3);
  assert.equal(await count(r,'notification_deliveries'),0);
  // Current-code cross-source regression only. This does not prove a journal
  // created by an earlier Lamp release upgrades safely; that needs the retained
  // old-database upgrade proof run separately by the parent.
  const oldFiles=readdirSync('tests/fixtures/statuspage/small').map(name=>({name,text:readFileSync(`tests/fixtures/statuspage/small/${name}`,'utf8')}));
  const p=await moveIn(r,r.cookie).preview({files:oldFiles});assert.equal(p.status,200,JSON.stringify(p.body));
  const old=await apply(r,p.body);
  const plan=await r.db.prepare('SELECT plan_json FROM ik_jobs WHERE id=?').bind(old.job.id).first();
  assert.ok(!plan.plan_json.includes('import_maintenance_updates'));
  const oldUndo=await undo(r,old);
  assert.equal(oldUndo.body.job.state,'undone');assert.ok(!oldUndo.body.undo.dispositions.some(row=>row.disposition==='retained'));
});
