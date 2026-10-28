import assert from 'node:assert/strict';
import { openFollowUpsRuntime, eventuallyFollowUp, pageOrigin } from './follow-ups-runtime.mjs';
import { seedSubscriberLimitFixture } from './subscriber-limits-flow.mjs';
import { recordedSlackOAuth, RECORDED_SLACK_WEBHOOK } from '../slack-subscriptions-helper.mjs';

/** NOTIFY-016 and INCIDENT-011: ordinary publication and scheduled doors,
 * with only provider endpoints replaced. No fabricated reminder or delivery rows. */
export async function operatorAlertsFlow() {
  const posts=[];
  const slack='https://hooks.slack.com/services/synthetic-lamp-4/synthetic-lamp-5/synthetic-lamp-6';
  const teams='https://synthetic-lamp-1.logic.azure.com/workflows/synthetic-lamp-2/triggers/manual/paths/invoke?sig=synthetic-lamp-3';
  const fixture=await openFollowUpsRuntime({extraBindings:{SLACK_CLIENT_ID:'synthetic-lamp-1',SLACK_CLIENT_SECRET:'synthetic-lamp-2',SLACK_SIGNING_SECRET:'synthetic-lamp-3'},providerEdge:async request=>{
    if(request.url==='https://slack.com/api/oauth.v2.access')return Response.json(recordedSlackOAuth);
    if([slack,teams,RECORDED_SLACK_WEBHOOK,'https://hooks.slack.com/services/synthetic-lamp-7/synthetic-lamp-8/synthetic-lamp-9'].includes(request.url)) {
      posts.push({url:request.url,body:await request.json()});
      return new Response(request.url===teams?'':'ok',{status:200});
    }
  }});
  const {post,api,runtime,db}=fixture;
  const flush=async time=>{
    const result=await (await runtime.getWorker()).scheduled({cron:'* * * * *',scheduledTime:time});
    assert.equal(result.outcome,'ok');
  };
  const visibleText=row=>row.url===teams?row.body.attachments[0].content.body.map(block=>block.text).join('\n').replace(/\\(.)/g,'$1'):row.body.text;
  const matchingPosts=pattern=>posts.filter(row=>pattern.test(JSON.stringify(row.body)));
  const matchingMail=pattern=>fixture.messages.filter(message=>message.to.includes('synthetic-lamp-owner@example.test')&&pattern.test(message.subject));
  try {
    const component=(await post('/api/app/components',{groupId:null,name:'Synthetic Lamp operator alerts',description:'',internal:false,displayOrder:0,note:''})).body.component;
    for(const [kind,url] of [['slack',slack],['teams',teams]]) {
      const added=await post('/api/app/channels',{kind,url,name:`Synthetic Lamp ${kind} operators`,componentIds:[component.id],operatorAlerts:true});
      assert.equal(added.status,201,added.text);
    }
    const publicationOnly=await post('/api/app/channels',{kind:'slack',url:'https://hooks.slack.com/services/synthetic-lamp-7/synthetic-lamp-8/synthetic-lamp-9',name:'Synthetic Lamp publication only',componentIds:[component.id]});
    assert.equal(publicationOnly.status,201,publicationOnly.text);
    assert.equal(publicationOnly.body.channel.operatorAlerts,false,'omitted alert preference defaults off');
    assert.equal((await fixture.raw(`/api/app/channels/${publicationOnly.body.channel.id}`,{method:'PATCH',body:JSON.stringify({operatorAlerts:true}),headers:{'content-type':'application/json'}})).status,401,'alert opt-in requires a signed operator');
    // The public Slack subscriber shares the transport but must never receive private alerts.
    const install=await runtime.dispatchFetch(pageOrigin+'/subscribe/slack',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({componentId:component.id})});
    assert.equal(install.status,200);
    const authorization=(await install.text()).match(/href="(https:\/\/slack\.com\/oauth\/v2\/authorize[^"]+)"/)[1].replaceAll('&amp;','&');
    const callback=new URL('/subscribe/slack/callback',pageOrigin);
    callback.searchParams.set('state',new URL(authorization).searchParams.get('state'));
    callback.searchParams.set('code','synthetic-lamp-1');
    assert.equal((await runtime.dispatchFetch(callback.href)).status,200);
    const created=await post('/api/app/incidents',{title:'Synthetic Lamp operator commitment',components:[{componentId:component.id,state:'Partially unavailable',relationship:'Primary'}]});
    assert.equal(created.status,201,created.text);
    const incident=created.body.incident,committed=Date.now()+3_600_000;
    const publish=async channels=>{
      const saved=await api(`/api/app/incidents/${incident.id}/draft`,{method:'PUT',body:JSON.stringify({lifecycle:'Investigating',affectedAudience:'Synthetic Lamp customers',customerImpact:'Requests are delayed.',whatStillWorks:'Reads work.',details:'Investigating.',nextUpdateAt:new Date(committed).toISOString()})});
      assert.equal(saved.status,200,saved.text);
      const result=await post(`/api/app/incidents/${incident.id}/publish`,{channels});
      assert.equal(result.status,200,result.text);
      return result.body.update;
    };
    const update=await publish([]);
    await flush(committed+60_000);
    await eventuallyFollowUp(()=>matchingPosts(/incident is overdue/),rows=>rows.length===2,'Slack and Teams each accept one overdue operator alert');
    await eventuallyFollowUp(()=>matchingMail(/incident is overdue/),rows=>rows.length===1,'one overdue email is accepted');
    await flush(committed+60_000);
    assert.equal(matchingPosts(/incident is overdue/).length,2,'a repeated scheduled tick sends no extra channel alert');
    assert.equal(matchingMail(/incident is overdue/).length,1);
    for(const row of matchingPosts(/incident is overdue/)) {
      assert.ok(visibleText(row).includes(incident.reference));
      assert.ok(JSON.stringify(row.body).includes(`/app/incidents/${incident.id}`));
    }
    assert.equal(posts.filter(row=>row.url===RECORDED_SLACK_WEBHOOK).length,0,'a self-service subscriber receives no operator alert');
    const receipts=(await db.prepare("SELECT state FROM integration_deliveries WHERE json_extract(envelope,'$.event')='operator.alert'").all()).results;
    assert.deepEqual(receipts.map(row=>row.state),['accepted','accepted']);

    // The same operator-alert path must not copy a failed subscriber's identifiers or provider error.
    const rejected='synthetic-lamp-rejected@example.test';
    const subscribed=await runtime.dispatchFetch(pageOrigin+'/subscribe',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:rejected,componentId:component.id})});
    assert.equal(subscribed.status,202);
    const invitation=fixture.messages.find(message=>message.to.includes(rejected));
    const confirm=invitation.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
    assert.equal((await runtime.dispatchFetch(confirm)).status,200);
    const rejectedRow=await db.prepare('SELECT id FROM subscriber_directory WHERE destination=?').bind(rejected).first();
    await publish(['email']);
    await eventuallyFollowUp(async()=> (await api('/api/app/overview/follow-ups')).body.followUps,rows=>rows.some(row=>row.kind==='notification-delivery'),'the provider rejection is committed before dispatching its operator alert');
    await flush(Date.now());
    await eventuallyFollowUp(()=>matchingPosts(/could not deliver a subscriber notification/),rows=>rows.length===2,'a permanent provider failure reaches each operator channel');
    for(const row of matchingPosts(/could not deliver a subscriber notification/)) {
      const body=JSON.stringify(row.body);
      assert.ok(body.includes('/app/deliveries'));
      assert.ok(!body.includes(rejected)&&!body.includes(rejectedRow.id));
      assert.ok(!body.includes('Synthetic Lamp provider rejected'),'provider error details remain private');
    }

    // Only bulk population is setup SQL; the public opt-in crosses the actual capacity threshold.
    const occupied=Number((await db.prepare("SELECT count(*) AS n FROM subscriber_directory WHERE state IN ('pending','active')").first()).n);
    await seedSubscriberLimitFixture(db,1,19_999-occupied);
    const crossing=await runtime.dispatchFetch(pageOrigin+'/subscribe',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:'synthetic-lamp-capacity@example.test'})});
    assert.equal(crossing.status,202);
    await flush(Date.now());
    await eventuallyFollowUp(()=>matchingPosts(/subscriptions reached 80%/),rows=>rows.length===2,'capacity alerts reach both configured operator channels');
    await flush(Date.now());
    assert.equal(matchingPosts(/subscriptions reached 80%/).length,2);
    assert.equal(matchingMail(/subscriptions reached 80%/).length,1);
    for(const row of matchingPosts(/subscriptions reached 80%/))assert.ok(JSON.stringify(row.body).includes('/app/subscribers'));
    assert.equal(posts.filter(row=>row.url===RECORDED_SLACK_WEBHOOK).length,0,'operator capacity alerts also exclude self-service subscribers');
    assert.equal(posts.filter(row=>row.url.includes('/synthetic-lamp-7/')).length,0,'publication-only channels never receive private alerts');
    // A queued alert must recheck consent when Cron is ready to send it.
    await seedSubscriberLimitFixture(db,30_000,1_999,'webhook');
    const webhook=await post('/api/app/subscribers',{channel:'webhook',destination:'https://receiver.example.test/synthetic-lamp-operator-capacity',contactEmail:'synthetic-lamp-capacity-webhook@example.test',componentIds:[component.id]});
    assert.equal(webhook.status,201,webhook.text);
    const optedSlack=(await api('/api/app/channels')).body.channels.find(channel=>channel.name==='Synthetic Lamp slack operators');
    const stopQueued=await api(`/api/app/channels/${optedSlack.id}`,{method:'PATCH',body:JSON.stringify({operatorAlerts:false})});
    assert.equal(stopQueued.status,200,stopQueued.text);
    await flush(Date.now());
    const webhookAlerts=matchingPosts(/Lamp webhook subscriptions reached 80%/);
    assert.equal(webhookAlerts.length,1,'opting out stops a queued alert before any Slack network send');
    assert.equal(webhookAlerts[0].url,teams,'the still-consenting Teams channel receives its alert');
    assert.ok(!JSON.stringify(webhookAlerts[0].body).includes('synthetic-lamp-capacity-webhook@example.test'));
    assert.equal(Number((await db.prepare("SELECT count(*) AS n FROM integration_deliveries WHERE json_extract(envelope,'$.event')='operator.alert' AND json_extract(envelope,'$.destinationId')=? AND state='rejected'").bind(optedSlack.id).first()).n),1,'the revoked queued consent has a terminal preflight refusal');
    const optIn=await api(`/api/app/channels/${publicationOnly.body.channel.id}`,{method:'PATCH',body:JSON.stringify({operatorAlerts:true})});
    assert.equal(optIn.status,200,optIn.text);
    assert.equal((await api('/api/app/channels')).body.channels.find(row=>row.id===publicationOnly.body.channel.id).operatorAlerts,true);
    const optOut=await api(`/api/app/channels/${publicationOnly.body.channel.id}`,{method:'PATCH',body:JSON.stringify({operatorAlerts:false})});
    assert.equal(optOut.status,200,optOut.text);
    assert.equal((await api('/api/app/channels')).body.channels.find(row=>row.id===publicationOnly.body.channel.id).operatorAlerts,false);
  } finally {await fixture.close();}
}
