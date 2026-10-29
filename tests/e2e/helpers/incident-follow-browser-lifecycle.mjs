import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { eventuallySubscriber } from './subscriber-management-fixture.mjs';
const recipient=['synthetic-lamp-browser-lifetime','example.test'].join('@');
export const incidentBrowserReceiptKey=Buffer.from('synthetic-lamp-browser-receipts');

/** Keep the actual no-script recipient from permalink opt-in through delivery,
 * exclusions, resolution and the scheduled address-erasure deadline. */
export async function incidentFollowBrowserLifecycle({page,pageOrigin,api,post,raw,messages,runtime,db,incident,componentId}) {
  const inbox=()=>messages.filter(message=>message.to.includes(recipient));
  const tick=async at=>assert.equal((await(await runtime.getWorker()).scheduled({cron:'* * * * *',scheduledTime:at??Date.now()})).outcome,'ok');
  await page.goto(`${pageOrigin}/incidents/${incident.reference}`);
  const form=page.locator('form').filter({has:page.getByLabel('Email address',{exact:true})});
  await form.getByLabel('Email address',{exact:true}).fill(recipient);
  await form.getByRole('checkbox',{name:'Include the post-incident report',exact:true}).uncheck();
  const accepted=page.waitForResponse(response=>new URL(response.url()).pathname==='/subscribe/incident'&&response.request().method()==='POST');
  await form.getByRole('button',{name:'Get incident updates',exact:true}).click();assert.equal((await accepted).status(),202);
  const invitation=await eventuallySubscriber(()=>inbox().find(message=>message.text.includes('/confirm-subscription/')),Boolean,'the no-script lifetime recipient receives confirmation');
  const confirm=invitation.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0],manage=invitation.text.match(/https?:\/\/\S+\/manage\/\S+/)[0];
  assert.equal((await page.goto(confirm)).status(),200);
  const subscriber=(await api(`/api/app/incidents/${incident.id}/subscribers`)).body.subscribers.find(row=>row.destination===recipient);assert.ok(subscriber);
  const publish=async(record,wording,lifecycle='Identified')=>{
    const saved=await api(`/api/app/incidents/${record.id}/draft`,{method:'PUT',body:JSON.stringify({lifecycle,affectedAudience:'Customers using the API',customerImpact:wording,whatStillWorks:'The dashboard remains available.',details:'Operators have checked service recovery.',nextUpdateAt:lifecycle==='Resolved'?null:new Date(Date.now()+3600000).toISOString()})});assert.equal(saved.status,200,saved.text);
    const result=await post(`/api/app/incidents/${record.id}/publish`,{channels:['email'],overrideReason:'The owner verified service recovery.'});assert.equal(result.status,200,result.text);await tick();return result.body.update;
  };
  let sequence=0;
  const receive=async wording=>{
    const mail=await eventuallySubscriber(()=>inbox().find(message=>message.text.includes(wording)),Boolean,'the exact no-script recipient receives the published update');
    const providerId=`synthetic-lamp-ui-receipt-${messages.indexOf(mail)+1}`;
    const id=`synthetic-lamp-browser-event-${++sequence}`,at=String(Math.floor(Date.now()/1000));
    const body=JSON.stringify({type:'email.delivered',data:{email_id:providerId}}),signature=createHmac('sha256',incidentBrowserReceiptKey).update(`${id}.${at}.${body}`).digest('base64url');
    const receipt=await raw(`${pageOrigin}/api/intake/mail-events`,{method:'POST',headers:{'Content-Type':'application/json','svix-id':id,'svix-timestamp':at,'svix-signature':`v1,${signature}`},body});assert.equal(receipt.status,200,await receipt.text());
  };
  const next='The API is recovering for the no-script recipient.';
  await publish(incident,next);await receive(next);
  const before=inbox().length;
  const other=await post('/api/app/incidents',{title:'Another incident on the same API',components:[{componentId,state:'Partially unavailable',relationship:'Primary'}]});assert.equal(other.status,201,other.text);
  await publish(other.body.incident,'Other incident communication stays separate.');
  const maintenance=await post('/api/app/maintenance',{title:'Scheduled API maintenance',affectedAudience:'API customers',customerImpact:'Connections may briefly pause.',startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString(),componentIds:[componentId],autoStart:false});assert.equal(maintenance.status,201,maintenance.text);await tick();
  assert.equal(inbox().length,before,'the same-component incident and maintenance send no email to the incident follower');
  const resolution='The API is restored for the no-script recipient.';
  const resolved=await publish(incident,resolution,'Resolved');await receive(resolution);
  assert.equal((await raw(manage)).status,404,'resolution delivery revokes the original emailed authority');
  const endedCount=inbox().length;
  await publish(incident,'A later reopening cannot resurrect an ended subscription.');assert.equal(inbox().length,endedCount);
  await tick(Date.parse(resolved.publishedAt)+24*3600000);
  const erased=await db.prepare('SELECT destination,contact_email FROM subscriber_directory WHERE id=?').bind(subscriber.id).first();
  assert.ok(!erased||erased.destination===`deleted:${subscriber.id}`);assert.equal(erased?.contact_email??null,null);
  assert.equal(await db.prepare('SELECT subscriber_id FROM incident_subscriptions WHERE subscriber_id=?').bind(subscriber.id).first(),null,'the address-owning incident scope is deleted within twenty-four hours');
}
