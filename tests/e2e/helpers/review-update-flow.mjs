import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { UPDATE_LINK_FIELDS, assertUpdateComponentWebhook } from './update-component-flow.mjs';
import { LINKED_URL, assertLinkedSlackText, assertLinkedUpdateHtml } from './update-link-evidence.mjs';

const SLACK_HOOK='https://hooks.slack.com/services/T0LAMPREVIEW/B0REVIEW/reviewSlackSecret01';

/** A buyer's review policy mounted on the real routes, repositories, D1 and R2.
 * Only SendGrid's API and the outbound webhook network are recorded edges.
 */
export async function reviewUpdateFlow({ vite, bindings }) {
  const { createUlid } = await vite.ssrLoadModule('/src/core/shared/ids.ts');
  const { createSnapshotRepository, createPublicSnapshotService } = await vite.ssrLoadModule('/src/core/features/public-snapshot/index.ts');
  const { createSnapshotBlobStore } = await vite.ssrLoadModule('/src/core/platform/blobs/r2.ts');
  const { createComponentRepository, createComponentsService, registerComponentRoutes } = await vite.ssrLoadModule('/src/core/features/components/index.ts');
  const { createIncidentRepository, createIncidentsService, registerIncidentRoutes } = await vite.ssrLoadModule('/src/core/features/incidents/index.ts');
  const { notificationPublicationStatements, createDeliveryRepository, createDeliveriesService } = await vite.ssrLoadModule('/src/core/features/deliveries/index.ts');
  const { SendGridMailSender } = await vite.ssrLoadModule('/src/core/platform/mail/sendgrid.ts');
  const { createMailSendRepository } = await vite.ssrLoadModule('/src/core/platform/mail/repository.ts');
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
  // A SUB-009 webhook subscriber may register a Slack incoming-webhook URL.
  for(const [channel,destination] of [['email','recovery-reader@example.test'],['webhook','https://hooks.example.test/recovery'],['webhook',SLACK_HOOK]]) {
    const id=createUlid();readers.push(id);
    await db.prepare("INSERT INTO subscribers(id,channel,destination,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,'active','selected',?,?,?)").bind(id,channel,destination,createUlid(),now,now).run();
    await db.prepare('INSERT INTO subscriber_components(id,subscriber_id,component_id,created_at,updated_at) VALUES (?,?,?,?,?)').bind(createUlid(),id,component.id,now,now).run();
  }
  version=await save('Monitoring','Degraded performance');await review(version);
  assert.equal((await read()).draft.componentChanges[0].state,'Degraded performance');
  const published=await call(`/incidents/${incident.id}/publish`,'POST',{channels:['email','webhook']},version);assert.equal(published.status,200,JSON.stringify(published.body));
  const update=published.body.update;
  const rows=(await db.prepare('SELECT id,channel FROM notification_deliveries WHERE incident_update_id=? AND subscriber_id IN (?,?,?)').bind(update.id,...readers).all()).results;
  assert.deepEqual(rows.map(row=>row.channel).sort(),['email','webhook','webhook']);
  const accepted=[],received=[];
  const mail=new SendGridMailSender({apiKey:'review-flow-sendgrid-key',fromAddress:'status@example.test'},createMailSendRepository(db));
  const delivery=createDeliveriesService(createDeliveryRepository(db),{mail,fromAddress:'status@example.test',subscriberTokenSecret:'review-flow-subscriber-secret',webhookSigningSecret:'review-flow-webhook-secret'});
  // Later changes cannot rewrite the event waiting at the delivery network edge.
  version=await save('Resolved','Major outage');await review(version);assert.equal((await call(`/incidents/${incident.id}/publish`,'POST',{channels:[]},version)).status,200);
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:input);
    if(url.href==='https://api.sendgrid.com/v3/mail/send'){accepted.push(JSON.parse(init.body));return new Response(null,{status:202,headers:{'x-message-id':'reviewed-recovery-mail'}});}
    if(url.origin==='https://hooks.example.test'||url.href===SLACK_HOOK){received.push({url:url.href,headers:init.headers,body:init.body});return new Response(url.origin==='https://hooks.slack.com'?'ok':'accepted',{status:200});}
    return nativeFetch(input,init);
  };
  try {for(const row of rows) await delivery.dispatchDelivery(row.id,'https://status.example.test');} finally {globalThis.fetch=nativeFetch;}
  assert.equal(accepted.length,1);assert.equal(received.length,2);
  // The request at SendGrid's edge: no click, open or analytics tracking.
  assert.deepEqual(accepted[0].tracking_settings,{click_tracking:{enable:false,enable_text:false},open_tracking:{enable:false},ganalytics:{enable:false},subscription_tracking:{enable:false}});
  const part=type=>accepted[0].content.find(content=>content.type===type).value;
  const text=part('text/plain'),html=part('text/html');
  assert.match(text,/Reviewed recovery API: Major outage → Degraded performance/);
  for(const field of Object.values(UPDATE_LINK_FIELDS)) assert.ok(text.includes(field),'the text part carries each field with its bare URLs');
  assert.ok(text.includes(`See ${LINKED_URL}.`));assert.doesNotMatch(text,/<a\b/);
  assertLinkedUpdateHtml(html,'email HTML part');
  for(const [,href] of html.matchAll(/href="([^"]*)"/g)) assert.match(href,/^https:\/\/(?:help\.example\.com|db-prod-3\.internal|10\.0\.0\.5|status\.example\.test)\//,'every email link points directly at its destination, with no redirect or tracking host');
  const signed=delivery=>{
    const {'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':signature}=delivery.headers;
    assert.equal(signature,`v1=${createHmac('sha256','review-flow-webhook-secret').update(`${id}.${timestamp}.${delivery.body}`).digest('base64url')}`,'the delivery signature verifies over the exact body');
    return JSON.parse(delivery.body);
  };
  assertUpdateComponentWebhook(signed(received.find(item=>item.url.startsWith('https://hooks.example.test/'))),{incident,component,stepDownUpdate:update,expectedChange:{componentId:component.id,name:component.name,previousState:'Major outage',newState:'Degraded performance',internal:false}});
  // Slack's endpoint receives Slack's own message form, whose rich-text elements reassemble every field unchanged.
  const slack=signed(received.find(item=>item.url===SLACK_HOOK));
  assertLinkedSlackText(slack.text,'Slack-URL webhook subscriber');
  const elements=slack.blocks.flatMap(block=>block.elements.flatMap(section=>section.elements));
  const reassembled=elements.map(element=>element.text).join('');
  for(const field of Object.values(UPDATE_LINK_FIELDS)) assert.ok(reassembled.includes(field),'Slack rich text keeps each field byte-for-byte');
  for(const element of elements.filter(element=>element.type==='link')) assert.equal(element.text,element.url);
  assert.ok(!elements.some(element=>element.type==='link'&&!element.url.startsWith('https://')));
}
