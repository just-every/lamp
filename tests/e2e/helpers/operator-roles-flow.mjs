import assert from 'node:assert/strict';
import { sessionCookieName } from '../../helpers/session-cookie.mjs';
import { operatorRoleActors } from './operator-role-actors.mjs';

/** The team’s draft, publish, administration and denial-audit doors together. */
export async function operatorRolesFlow({appFetch,appUrl,persistTo,configPath}) {
  const actors=await operatorRoleActors({persistTo,configPath});
  const call=(role,path,init={})=>appFetch(path,{...init,headers:{...init.headers,Cookie:`${sessionCookieName(appUrl)}=${actors[role].token}`}});
  const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
  for(const role of Object.keys(actors))assert.equal((await json(await call(role,'/api/app/session'))).operator.role,role);
  const component=(await (await appFetch('/api/app/components',{method:'POST',body:JSON.stringify({name:'Synthetic Lamp role component',description:'',groupId:null,internal:false,displayOrder:100,note:''})})).json()).component;
  assert.ok(component?.id);
  const created=await call('responder','/api/app/incidents',{method:'POST',body:JSON.stringify({title:'Synthetic Lamp role handoff',components:[{componentId:component.id,state:'Major outage',relationship:'Primary'}]})});
  assert.equal(created.status,201,await created.clone().text());
  const incident=(await created.json()).incident, path=`/api/app/incidents/${incident.id}`;
  const draft={lifecycle:'Monitoring',affectedAudience:'Synthetic Lamp API customers',customerImpact:'Synthetic Lamp requests are delayed',whatStillWorks:'Synthetic Lamp dashboard',details:'Synthetic Lamp recovery is being checked',nextUpdateAt:new Date(Date.now()+3600000).toISOString(),componentChanges:[{componentId:component.id,state:'Degraded performance'}]};
  assert.equal((await call('responder',`${path}/draft`,{method:'PUT',body:JSON.stringify(draft)})).status,200);
  assert.equal((await call('responder',`${path}/internal-notes`,{method:'POST',body:JSON.stringify({body:'Synthetic Lamp private response note'})})).status,201);
  const before=await json(await appFetch(path));
  const settings=await json(await appFetch('/api/app/page-settings'));
  const {pageName,tagline,accentColor,timezone,hostname,footerCreditEnabled}=settings.settings;
  const settingsWrite={pageName,tagline,accentColor,timezone,hostname,footerCreditEnabled};
  const denied=[];
  async function refuse(role,route,init={}) {
    const response=await call(role,route,init);
    assert.equal(response.status,403,`${role} ${route}: ${await response.text()}`);
    denied.push({actorId:actors[role].id,path:route.split('?')[0]});
  }
  await refuse('responder',`${path}/publish`,{method:'POST',body:JSON.stringify({channels:[]})});
  await refuse('responder',`${path}/draft/schedule`,{method:'POST',body:JSON.stringify({publishAt:new Date(Date.now()+7200000).toISOString(),channels:[]})});
  await refuse('viewer','/api/app/page-settings',{method:'PUT',body:JSON.stringify({...settingsWrite,pageName:'Synthetic Lamp forbidden change'})});
  await refuse('viewer',`${path}/draft`,{method:'PUT',body:JSON.stringify({...draft,customerImpact:'Synthetic Lamp forbidden draft'})});
  await refuse('communicator','/api/app/audit-log');
  await refuse('communicator','/api/app/audit-log?format=csv');
  await refuse('communicator','/api/app/operators/invite',{method:'POST',body:'{}'});
  assert.deepEqual(await json(await appFetch(path)),before,'denied publishing, scheduling and writing preserve the complete draft and incident');
  assert.deepEqual(await json(await appFetch('/api/app/page-settings')),settings,'Viewer cannot change settings');
  const published=await call('communicator',`${path}/publish`,{method:'POST',body:JSON.stringify({channels:[]})});
  assert.equal(published.status,200,await published.clone().text());
  const after=(await json(await appFetch(path))).incident;
  assert.equal(after.updates.length,1);
  assert.equal(after.updates[0].customerImpact,draft.customerImpact);
  assert.equal(after.updates[0].authorOperatorId,actors.communicator.id);
  assert.equal(after.draft,null,'the same responder draft was consumed by publication');
  assert.equal((await json(await call('viewer',path))).incident.updates[0].customerImpact,draft.customerImpact,'Viewer can read the published incident');
  const maintenance=await call('communicator','/api/app/maintenance',{method:'POST',body:JSON.stringify({title:'Synthetic Lamp role maintenance',affectedAudience:'Synthetic Lamp customers',customerImpact:'Synthetic Lamp brief interruption',startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+90000000).toISOString(),componentIds:[component.id]})});
  assert.equal(maintenance.status,201,await maintenance.clone().text());
  await refuse('responder','/api/app/maintenance',{method:'POST',body:'{}'});
  const changed=await appFetch(`/api/app/operators/${actors.responder.id}/role`,{method:'POST',body:JSON.stringify({role:'viewer'})});
  assert.equal(changed.status,200,await changed.clone().text());
  assert.equal((await changed.json()).operator.role,'viewer');
  assert.equal((await call('responder','/api/app/session')).status,401,'role change invalidates the old native session');
  const replay=await call('responder',`${path}/publish`,{method:'POST',headers:{'If-Match':'synthetic-lamp-stale:0'},body:JSON.stringify({channels:[]})});
  assert.equal(replay.status,401,'captured publication cannot regain authority after demotion');
  const adminLog=await call('admin','/api/app/audit-log');
  assert.equal(adminLog.status,200,'Admin can inspect the same audit view');
  const adminSettings=await call('admin','/api/app/page-settings',{method:'PUT',body:JSON.stringify(settingsWrite)});
  assert.equal(adminSettings.status,200,await adminSettings.clone().text());
  const native=await call('viewer','/auth/operator/role',{method:'POST',body:JSON.stringify({operatorId:actors.viewer.id,role:'owner'})});
  assert.equal(native.status,403,'native auth administration cannot bypass product permissions');
  assert.equal((await json(await call('viewer','/api/app/session'))).operator.role,'viewer');
  denied.push({actorId:actors.viewer.id,path:'/auth/operator/role'});
  const audit=(await json(await appFetch('/api/app/audit-log?limit=100'))).entries;
  for(const refusal of denied)assert.ok(audit.some(row=>row.action==='access-denied'&&row.actorId===refusal.actorId&&row.entityId===refusal.path&&Number.isFinite(Date.parse(row.createdAt))),`attributed denial for ${refusal.path}`);
  const roleChange=audit.find(row=>row.action==='role-changed'&&row.entityId===actors.responder.id);
  assert.ok(roleChange?.actorId&&roleChange.actorName==='Contract Operator'&&Number.isFinite(Date.parse(roleChange.createdAt)));
  return {actors,incidentId:incident.id};
}
