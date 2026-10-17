import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { UPDATE_LINK_FIELDS, assertUpdateComponentWebhook } from './update-component-flow.mjs';

/** A buyer's review policy mounted on the real routes, repositories, D1 and R2.
 * Only mail acceptance and the outbound webhook network are fixtures.
 */
export async function reviewUpdateFlow({ vite, bindings }) {
  const { createUlid } = await vite.ssrLoadModule('/src/core/shared/ids.ts');
  const { createSnapshotRepository, createPublicSnapshotService } = await vite.ssrLoadModule('/src/core/features/public-snapshot/index.ts');
  const { createSnapshotBlobStore } = await vite.ssrLoadModule('/src/core/platform/blobs/r2.ts');
  const { createComponentRepository, createComponentsService, registerComponentRoutes } = await vite.ssrLoadModule('/src/core/features/components/index.ts');
  const { createIncidentRepository, createIncidentsService, registerIncidentRoutes } = await vite.ssrLoadModule('/src/core/features/incidents/index.ts');
  const { notificationPublicationStatements, createDeliveryRepository, createDeliveriesService } = await vite.ssrLoadModule('/src/core/features/deliveries/index.ts');
  const db = bindings.DB, now = new Date().toISOString(), author = createUlid(), reviewer = createUlid();
  for (const [id, name] of [[author,'Author'],[reviewer,'Reviewer']]) await db.prepare('INSERT INTO operators(id,email,display_name,is_setup_operator,created_at,updated_at) VALUES (?,?,?,0,?,?)').bind(id,`${id.toLowerCase()}@example.test`,name,now,now).run();
  const snapshots = createPublicSnapshotService(createSnapshotRepository(db), createSnapshotBlobStore(bindings));
  const components = createComponentsService(createComponentRepository(db), snapshots.rebuild);
  const incidents = createIncidentsService(createIncidentRepository(db), components, snapshots.rebuild, {
    forIncidentUpdate: input => notificationPublicationStatements(db, { eventId:input.updateId,eventType:'incident-update',incidentUpdateId:input.updateId,componentIds:input.componentIds,channels:input.channels,queuedAt:input.queuedAt }),
  }, { requiresReview: () => true }, async () => {});
  let actor=author;
  const pending=[];
  const app=new Hono();
  app.use('*',async(c,next)=>{c.set('operator',{id:actor});await next();});
  registerComponentRoutes(app,components);registerIncidentRoutes(app,incidents);
  const call=async(path,method='GET',body,version)=>{
    const response=await app.request('https://app.example.test/api/app'+path,{method,headers:{'Content-Type':'application/json',...(version?{'If-Match':version}:{})},...(body?{body:JSON.stringify(body)}:{})},undefined,{waitUntil:job=>pending.push(job)});
    await Promise.all(pending.splice(0));
    return {status:response.status,body:await response.json()};
  };
  const component=(await call('/components','POST',{name:'Reviewed recovery API',description:'Customer API requests',groupId:null,internal:false,displayOrder:1000,note:''})).body.component;
  const incident=(await call('/incidents','POST',{title:'Reviewed API recovery',components:[{componentId:component.id,state:'Major outage',relationship:'Primary'}]})).body.incident;
  const read=async()=> (await call('/incidents/'+incident.id)).body.incident;
  const save=async(lifecycle,state)=>{
    const current=await read();actor=author;
    const result=await call(`/incidents/${incident.id}/draft`,'PUT',{...UPDATE_LINK_FIELDS,lifecycle,nextUpdateAt:lifecycle==='Resolved'?null:new Date(Date.now()+3600000).toISOString(),componentChanges:[{componentId:component.id,state}]},`${current.draft?.id??'-'}:${current.updates.length}`);
    assert.equal(result.status,200,JSON.stringify(result.body));return `${result.body.draft.id}:${current.updates.length}`;
  };
  const review=async version=>{actor=reviewer;const result=await call(`/incidents/${incident.id}/draft/review`,'POST',undefined,version);assert.equal(result.status,200,JSON.stringify(result.body));};
  let version=await save('Investigating','Major outage');
  const held=await call(`/incidents/${incident.id}/publish`,'POST',{channels:[]},version);
  assert.equal(held.status,409);assert.match(held.body.error,/requires review/);assert.equal((await read()).updates.length,0);
  await review(version);assert.equal((await call(`/incidents/${incident.id}/publish`,'POST',{channels:[]},version)).status,200);
  const readers=[];
  for(const channel of ['email','webhook']) {
    const id=createUlid();readers.push(id);
    await db.prepare("INSERT INTO subscribers(id,channel,destination,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,'active','selected',?,?,?)").bind(id,channel,channel==='email'?'recovery-reader@example.test':'https://hooks.example.test/recovery',createUlid(),now,now).run();
    await db.prepare('INSERT INTO subscriber_components(id,subscriber_id,component_id,created_at,updated_at) VALUES (?,?,?,?,?)').bind(createUlid(),id,component.id,now,now).run();
  }
  version=await save('Monitoring','Degraded performance');await review(version);
  assert.equal((await read()).draft.componentChanges[0].state,'Degraded performance');
  const published=await call(`/incidents/${incident.id}/publish`,'POST',{channels:['email','webhook']},version);assert.equal(published.status,200,JSON.stringify(published.body));
  const update=published.body.update;
  const rows=(await db.prepare('SELECT id,channel FROM notification_deliveries WHERE incident_update_id=? AND subscriber_id IN (?,?)').bind(update.id,...readers).all()).results;
  assert.deepEqual(rows.map(row=>row.channel).sort(),['email','webhook']);
  const accepted=[],received=[];
  const mail={configured:true,send:async message=>{accepted.push(message);return{providerMessageId:'reviewed-recovery-mail'};}};
  const delivery=createDeliveriesService(createDeliveryRepository(db),{mail,fromAddress:'status@example.test',subscriberTokenSecret:'review-flow-subscriber-secret',webhookSigningSecret:'review-flow-webhook-secret'});
  // Later changes cannot rewrite the event waiting at the delivery network edge.
  version=await save('Resolved','Major outage');await review(version);assert.equal((await call(`/incidents/${incident.id}/publish`,'POST',{channels:[]},version)).status,200);
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{if(new URL(input).origin==='https://hooks.example.test'){received.push(JSON.parse(init.body));return new Response('accepted',{status:200});}return nativeFetch(input,init);};
  try {for(const row of rows) await delivery.dispatchDelivery(row.id,'https://status.example.test');} finally {globalThis.fetch=nativeFetch;}
  assert.equal(accepted.length,1);assert.equal(received.length,1);
  assert.match(accepted[0].text,/Reviewed recovery API: Major outage → Degraded performance/);
  assert.ok(accepted[0].text.includes(UPDATE_LINK_FIELDS.customerImpact));
  assert.match(accepted[0].html,/<a href="https:\/\/help\.example\.com\/kb\/123" rel="nofollow noopener ugc">https:\/\/help\.example\.com\/kb\/123<\/a>\./);
  assert.doesNotMatch(accepted[0].html,/href="(?:https:\/\/x\.test|javascript:)/);
  assertUpdateComponentWebhook(received[0],{incident,component,stepDownUpdate:update,expectedChange:{componentId:component.id,name:component.name,previousState:'Major outage',newState:'Degraded performance',internal:false}});
}
