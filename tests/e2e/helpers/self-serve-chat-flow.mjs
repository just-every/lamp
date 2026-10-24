import { chatPreferencesFlow } from './chat-preferences-flow.mjs';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openFollowUpsRuntime, appOrigin, eventuallyFollowUp } from './follow-ups-runtime.mjs';
import { recordedSlackOAuth, RECORDED_SLACK_WEBHOOK, prepareSlackSubscription,verifySlackPublication,removeSlackSubscription } from '../slack-subscriptions-helper.mjs';
import { subscriberTeamsUrl, prepareTeamsSubscription,verifyTeamsPublication } from '../teams-subscriptions-helper.mjs';

/** Complete public and authenticated application doors, with only the Slack
 * OAuth/webhook and Teams Workflows network edges replaced by recorded replies. */
export async function selfServeChatFlow(t){
  const received=[],signingSecret=randomBytes(32).toString('hex');
  let slackReply={status:200,body:'ok'},teamsStatus=202;
  const runtime=await openFollowUpsRuntime({pageHost:'localhost',extraBindings:{SLACK_CLIENT_ID:'synthetic-lamp-client',SLACK_CLIENT_SECRET:'synthetic-lamp-client-secret',SLACK_SIGNING_SECRET:signingSecret},providerEdge:async request=>{
    if(request.url==='https://slack.com/api/oauth.v2.access'){
      assert.equal(request.method,'POST');
      const exchange=new URLSearchParams(await request.text());
      assert.equal(exchange.get('client_id'),'synthetic-lamp-client');assert.equal(exchange.get('client_secret'),'synthetic-lamp-client-secret');assert.equal(exchange.get('code'),'synthetic-lamp-oauth-code');
      assert.equal(new URL(exchange.get('redirect_uri')).pathname,'/subscribe/slack/callback');
      return Response.json(recordedSlackOAuth);
    }
    if(request.url===RECORDED_SLACK_WEBHOOK||request.url===subscriberTeamsUrl){
      const url=new URL(request.url);received.push({path:url.pathname+url.search,body:await request.text()});
      return url.hostname==='hooks.slack.com'?new Response(slackReply.body,{status:slackReply.status}):new Response(null,{status:teamsStatus});
    }
  }});
  const publicOrigin=appOrigin.replace('127.0.0.1','localhost');
  const sql=async query=>(await runtime.db.prepare(query).all()).results;
  try{
    t.diagnostic('SUB-014 SUB-015 recorded Slack OAuth and Teams Workflows public subscriptions; no live provider call');
    const component=(await runtime.post('/api/app/components',{groupId:null,name:'Self-serve subscriptions',description:'',internal:false,displayOrder:0,note:''})).body.component;
    let slackManageUrl,teamsManageUrl;
    const id=await prepareSlackSubscription({componentId:component.id,publicOrigin,sql,onManage:url=>{slackManageUrl=url;}});
    await prepareTeamsSubscription({componentId:component.id,publicOrigin,received,sql,onManage:url=>{teamsManageUrl=url;}});
    const incident=await runtime.post('/api/app/incidents',{title:'Self-serve channel incident',components:[{componentId:component.id,state:'Partially unavailable',relationship:'Primary'}]});
    assert.equal(incident.status,201,incident.text);
    const incidentId=incident.body.incident.id;
    const draft={lifecycle:'Investigating',affectedAudience:'Channel subscribers.',customerImpact:'Requests are delayed.',whatStillWorks:'Reads continue.',details:'See https://help.example.com/kb/123.',nextUpdateAt:new Date(Date.now()+3600000).toISOString()};
    const publish=async details=>{
      const written=await runtime.api(`/api/app/incidents/${incidentId}/draft`,{method:'PUT',body:JSON.stringify({...draft,details})});assert.equal(written.status,200,written.text);
      const published=await runtime.post(`/api/app/incidents/${incidentId}/publish`,{channels:['chat']});assert.equal(published.status,200,published.text);
      const updateId=published.body.update.id;
      await eventuallyFollowUp(async()=> (await sql(`SELECT count(*) AS n FROM delivery_channel_posts p LEFT JOIN integration_deliveries d ON d.id=p.id AND d.namespace='lamp-channels' WHERE p.incident_update_id='${updateId}' AND (d.state IS NULL OR d.state IN ('queued','sending'))`))[0].n,n=>n===0,'committed chat recipients have terminal provider receipts');

    };
    await publish(draft.details);
    await eventuallyFollowUp(()=>received.filter(x=>x.path===new URL(RECORDED_SLACK_WEBHOOK).pathname).length,n=>n===1,'active Slack receives the next publication');
    verifySlackPublication({received});verifyTeamsPublication({received});
    await chatPreferencesFlow({runtime,publicOrigin,received,publish,component,manageUrls:[slackManageUrl,teamsManageUrl]});
    await removeSlackSubscription({publicOrigin,signingSecret,id,sql});
    const before=received.filter(x=>x.path===new URL(RECORDED_SLACK_WEBHOOK).pathname).length;
    await publish('Second publish after app uninstall.');
    assert.equal(received.filter(x=>x.path===new URL(RECORDED_SLACK_WEBHOOK).pathname).length,before,'uninstalled Slack receives no next publish');
    await prepareSlackSubscription({componentId:component.id,publicOrigin,sql,widths:[1440]});
    await removeSlackSubscription({publicOrigin,signingSecret,id,sql,eventType:'tokens_revoked'});
    await prepareSlackSubscription({componentId:component.id,publicOrigin,sql,widths:[1440]});
    slackReply={status:400,body:'channel_is_archived'};
    await publish('Third publish to an archived channel.');
    const archiveState=await sql(`SELECT state,deactivation_reason FROM subscriber_directory AS subscribers WHERE id='${id}'`);
    const archiveProof=archiveState[0]?.deactivation_reason==='channel_is_archived'?undefined:JSON.stringify({
      received:received.filter(x=>x.path===new URL(RECORDED_SLACK_WEBHOOK).pathname).map(x=>JSON.parse(x.body).text),
      posts:await sql(`SELECT id,incident_update_id FROM delivery_channel_posts AS channel_posts WHERE destination_id='${id}'`),
      deliveries:await sql(`SELECT id,state,attempts,next_at FROM integration_deliveries WHERE json_extract(envelope,'$.destinationId')='${id}'`),
      attempts:await sql(`SELECT delivery_id,number,outcome FROM integration_attempts WHERE delivery_id IN (SELECT id FROM integration_deliveries WHERE json_extract(envelope,'$.destinationId')='${id}')`),
    });
    assert.deepEqual(archiveState,[{state:'deactivated',deactivation_reason:'channel_is_archived'}],archiveProof);
    slackReply={status:200,body:'ok'};
    const archivedCount=received.filter(x=>x.path===new URL(RECORDED_SLACK_WEBHOOK).pathname).length;
    await publish('Fourth publish after channel archive.');
    assert.equal(received.filter(x=>x.path===new URL(RECORDED_SLACK_WEBHOOK).pathname).length,archivedCount);
    teamsStatus=400;
    for(let failure=1;failure<=10;failure++){
      await publish(`Teams destination refusal ${failure}.`);
      if(failure===10)await eventuallyFollowUp(async()=> (await sql("SELECT state FROM subscriber_directory AS subscribers WHERE channel='teams'"))[0].state,state=>state==='deactivated','terminal failure receipts deactivate the subscription');
      assert.equal((await sql("SELECT state FROM subscriber_directory AS subscribers WHERE channel='teams'"))[0].state,failure<10?'active':'deactivated','consecutive refused publications deactivate the failing subscription');
    }
    const failedTeams=received.filter(x=>x.path.startsWith(new URL(subscriberTeamsUrl).pathname)).length;
    await publish('Publication after Teams destination deactivation.');
    assert.equal(received.filter(x=>x.path.startsWith(new URL(subscriberTeamsUrl).pathname)).length,failedTeams,'deactivated Teams receives no next publish');
    const erased=await runtime.api(`/api/app/subscribers/${id}`,{method:'DELETE'});assert.equal(erased.status,204,erased.text);
    assert.deepEqual(await sql(`SELECT * FROM subscriber_chat_destinations WHERE subscriber_id='${id}'`),[],'subscriber deletion erases sealed URL and team mapping');
    assert.deepEqual(await sql(`SELECT * FROM delivery_channel_destinations AS channel_destinations WHERE id='${id}'`),[],'no channel copy retains the bearer URL');

  }finally{await runtime.close();}
}
