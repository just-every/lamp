import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const wranglerRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');
const {build}=wranglerRequire('esbuild');
import { authFixture, secret, setupToken } from '../../auth-adoption/runtime.mjs';
import { sesCredentials,sesTopic,sesCertificateUrl,postmarkSecret,sesSigningFixture,verifySesRequest,normalizeSesMessage,snsBounce } from './mail-provider-fixtures.mjs';
import { migrate,executeSql } from '../../reference-storage/runtime.mjs';
import { withDraftVersion } from '../draft-version-helper.mjs';

/** Every business mutation uses the real authenticated/public HTTP router. The
 * only replacements are provider HTTP responses and this test's Date clock. */
export async function mailFailoverFlow({ t, vite, secondaryProvider='mailgun' }) {
  const built=await build({entryPoints:['src/core/platform/blobs/snapshot-cache.ts'],bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers','node:*']});
  const snapshotRuntime=new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0].text,port:0,inspectorPort:0,compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],durableObjects:{SNAPSHOT_CACHE:{className:'SnapshotCache',useSQLite:true}},d1Databases:['DB'],r2Buckets:['SNAPSHOTS'],queueProducers:{JOBS:'synthetic-lamp-failover-jobs'}}));
  const ownBindings=await snapshotRuntime.getBindings();
  await migrate(ownBindings.DB);
  await executeSql(ownBindings.DB,`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('01J00000000000000000000091','synthetic-lamp-owner@example.test','Synthetic Lamp owner','owner','active',${Date.now()});
    INSERT INTO page_settings(id,page_name,tagline,accent_color,timezone,hostname,feed_id,mail_from_address,created_at,updated_at) VALUES('default','Synthetic Lamp failover','Provider routing fixture','#16794C','UTC','status.example.test','synthetic-lamp-failover-feed-1','lamp@example.test','2026-10-01','2026-10-01');`);
  const { createApp } = await vite.ssrLoadModule('/src/core/app/server.ts');
  const { runScheduled,runQueue } = await vite.ssrLoadModule('/src/core/app/worker-lifecycle.ts');
  const appOrigin='https://app.example.test', pageOrigin='https://status.example.test';
  const address=`synthetic-lamp-mail-secondary-${secondaryProvider}@example.test`;
  const sns=secondaryProvider==='ses'?await sesSigningFixture():null;
  const signingKey='synthetic-lamp-mailgun-signing-key-1';
  const bindings={...ownBindings,AUTH_ORIGIN:appOrigin,LAMP_APP_HOST:'app.example.test',LAMP_PAGE_HOST:'status.example.test',SESSION_SECRET:secret,SETUP_TOKEN:setupToken,
    SETUP_OPERATOR_EMAIL:'synthetic-lamp-owner@example.test',SUBSCRIBER_TOKEN_SECRET:'synthetic-lamp-failover-token-secret-1',WEBHOOK_SIGNING_SECRET:'synthetic-lamp-failover-webhook-secret-1',
    MAIL_FROM_ADDRESS:'lamp@example.test',MAIL_PROVIDER:'resend',MAIL_PROVIDER_API_KEY:'synthetic-lamp-resend-api-key-1',
    MAIL_SECONDARY_PROVIDER:secondaryProvider,MAIL_SECONDARY_API_KEY:secondaryProvider==='ses'?JSON.stringify(sesCredentials):`synthetic-lamp-${secondaryProvider}-api-key-1`,MAILGUN_WEBHOOK_SIGNING_KEY:signingKey,
    SES_REGION:'us-east-1',SES_CONFIGURATION_SET:'synthetic-lamp-config-1',SES_EVENT_TOPIC_ARN:sesTopic,POSTMARK_WEBHOOK_SECRET:postmarkSecret,POSTMARK_ACCOUNT_API_KEY:'synthetic-lamp-postmark-account-key-1'};
  const cookie=await authFixture(ownBindings.DB,{owner:'synthetic-lamp-owner@example.test'}).signIn();
  const runtime=createApp(bindings);
  const background=[];
  const execution={waitUntil:promise=>background.push(Promise.resolve(promise).then(()=>({status:"fulfilled"}),reason=>({status:"rejected",reason}))),passThroughOnException(){}};
  const primary=[],secondary=[];
  let outage=false,sesTracking=false,sesMetrics='DISABLED',sesConfigurationReads=0;
  const realFetch=globalThis.fetch;
  let now=Date.now();
  t.mock.timers.enable({apis:['Date'],now});
  globalThis.fetch=async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url);
    if(url.origin==='https://api.resend.com'&&url.pathname==='/emails'){
      const body=await request.json();primary.push({body,key:request.headers.get('idempotency-key')});
      if(outage&&body.to.includes(address))return Response.json({message:'Synthetic provider outage'},{status:503});
      return Response.json({id:`synthetic-lamp-resend-${primary.length}`});
    }
    if(url.origin==='https://api.resend.com'&&url.pathname==='/domains')return Response.json({data:[{id:'synthetic-lamp-domain',name:'example.test',status:'verified'}],has_more:false});
    if(url.origin==='https://api.mailgun.net'&&url.pathname==='/v3/example.test/messages'){
      assert.equal(request.headers.get('authorization'),`Basic ${Buffer.from('api:synthetic-lamp-mailgun-api-key-1').toString('base64')}`);
      const body=new URLSearchParams(await request.text());
      assert.equal(body.get('o:tracking'),'no');assert.equal(body.get('o:tracking-clicks'),'no');assert.equal(body.get('o:tracking-opens'),'no');
      secondary.push({to:body.get('to'),text:body.get('text'),messageId:body.get('h:Message-ID'),id:body.get('v:lamp_message_id')});
      return Response.json({id:`<synthetic-lamp-mailgun-${secondary.length}@example.test>`});
    }
    if(url.origin==='https://email.us-east-1.amazonaws.com'&&url.pathname==='/v2/email/outbound-emails'){
      const raw=await request.text();verifySesRequest(request,raw);secondary.push(normalizeSesMessage(JSON.parse(raw)));
      return Response.json({MessageId:`synthetic-lamp-ses-${secondary.length}`});
    }
    if(url.origin==='https://api.mailgun.net'&&url.pathname==='/v4/domains/example.test'){assert.equal(request.headers.get('authorization'),`Basic ${Buffer.from('api:synthetic-lamp-mailgun-api-key-1').toString('base64')}`);return Response.json({domain:{name:'example.test',state:'active'},sending_dns_records:[{valid:'valid'}]});}
    if(url.origin==='https://email.us-east-1.amazonaws.com'&&url.pathname==='/v2/email/configuration-sets/synthetic-lamp-config-1'){
      verifySesRequest(request,'');return Response.json(sesMetrics===null?{}:{VdmOptions:{DashboardOptions:{EngagementMetrics:sesMetrics}}});
    }
    if(url.origin==='https://email.us-east-1.amazonaws.com'&&url.pathname==='/v2/email/configuration-sets/synthetic-lamp-config-1/event-destinations'){
      verifySesRequest(request,'');sesConfigurationReads++;
      return Response.json({EventDestinations:[{Enabled:true,MatchingEventTypes:['DELIVERY','BOUNCE','COMPLAINT',...(sesTracking?['OPEN','CLICK']:[])],SnsDestination:{TopicArn:sesTopic}}]});
    }
    if(url.origin==='https://email.us-east-1.amazonaws.com'&&url.pathname==='/v2/email/identities/example.test'){
      verifySesRequest(request,'');return Response.json({VerifiedForSendingStatus:true,DkimAttributes:{Status:'SUCCESS'}});
    }
    if(url.origin==='https://api.postmarkapp.com'&&url.pathname==='/domains'){
      assert.equal(request.headers.get('x-postmark-account-token'),'synthetic-lamp-postmark-account-key-1');return Response.json({Domains:[{Name:'example.test',DKIMVerified:true}]});
    }
    if(url.href===sesCertificateUrl&&sns)return new Response(sns.certificate,{headers:{'Content-Type':'application/x-pem-file'}});
    if(url.origin==='https://api.postmarkapp.com'&&url.pathname==='/email'){
      assert.equal(request.headers.get('x-postmark-server-token'),'synthetic-lamp-postmark-api-key-1');
      const body=await request.json();assert.equal(body.TrackOpens,false);assert.equal(body.TrackLinks,'None');
      secondary.push({to:body.To,text:body.TextBody,messageId:body.Headers.find(row=>row.Name==='Message-ID')?.Value,id:body.Metadata.lamp_message_id});
      return Response.json({ErrorCode:0,MessageID:`synthetic-lamp-postmark-${secondary.length}`});
    }
    if(url.origin===pageOrigin)return runtime.app.fetch(request,bindings,execution);
    throw new Error(`Unexpected provider edge: ${url.origin}${url.pathname}`);
  };
  const raw=(path,init={})=>runtime.app.fetch(new Request(new URL(path,appOrigin),{...init,headers:{Host:'app.example.test',Origin:appOrigin,Cookie:cookie,...init.headers}}),bindings,execution);
  const api=async(path,init={})=>{
    init=await withDraftVersion(path,init,read=>raw(read));
    const response=await raw(path,{...init,headers:{...(init.body?{'Content-Type':'application/json'}:{}),...init.headers}}),text=await response.text();
    return {status:response.status,body:text?JSON.parse(text):null,text};
  };
  const post=(path,body)=>api(path,{method:'POST',body:JSON.stringify(body)});
  const scheduled=async()=>{
    const pending=[];
    await runScheduled(bindings,{waitUntil:promise=>pending.push(promise)},Date.now());
    await Promise.all(pending);
  };
  try {
    const initial=await api('/api/app/mail-settings');assert.equal(initial.status,200,initial.text);
    assert.equal(initial.body.secondaryProvider,null,'secondary delivery is off until an owner chooses it');
    assert.equal(initial.body.configuredSecondaryProvider,secondaryProvider);
    assert.equal((await api('/api/app/mail-settings',{method:'PATCH',body:JSON.stringify({secondaryProvider:'unconnected-provider'})})).status,400);
    const enabled=await api('/api/app/mail-settings',{method:'PATCH',body:JSON.stringify({secondaryProvider})});assert.equal(enabled.status,200,enabled.text);
    assert.equal(enabled.body.secondaryProvider,secondaryProvider);
    const componentResponse=await post('/api/app/components',{groupId:null,name:'Synthetic Lamp failover API',description:'',internal:false,displayOrder:0,note:''});
    assert.equal(componentResponse.status,201,componentResponse.text);
    const component=componentResponse.body.component;
    const subscribed=await runtime.app.fetch(new Request(`${pageOrigin}/subscribe`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:address,componentId:component.id})}),bindings,execution);
    assert.equal(subscribed.status,202,await subscribed.text());
    const confirmation=primary.find(row=>row.body.to.includes(address)&&row.body.text.includes('/confirm-subscription/'));
    assert.ok(confirmation,'the real primary adapter sent the public confirmation');
    const confirmationUrl=confirmation.body.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
    assert.equal((await runtime.app.fetch(new Request(confirmationUrl),bindings,execution)).status,200);
    outage=true;
    const created=await post('/api/app/incidents',{title:'Synthetic Lamp failover incident',components:[{componentId:component.id,state:'Partially unavailable',relationship:'Primary'}]});
    assert.equal(created.status,201,created.text);
    const draft=await api(`/api/app/incidents/${created.body.incident.id}/draft`,{method:'PUT',body:JSON.stringify({lifecycle:'Investigating',affectedAudience:'Synthetic readers',customerImpact:'Requests are delayed.',whatStillWorks:'Reads continue.',details:'The operator is investigating.',nextUpdateAt:new Date(Date.now()+3600000).toISOString()})});
    assert.equal(draft.status,200,draft.text);
    const published=await post(`/api/app/incidents/${created.body.incident.id}/publish`,{channels:['email']});
    assert.equal(published.status,200,published.text);
    await Promise.all(background.splice(0));
    await scheduled();
    assert.equal(secondary.filter(body=>body.to===address).length,0,'no secondary send before five minutes');
    const queuedLog=(await api(`/api/app/deliveries?incidentUpdateId=${published.body.update.id}`)).body.deliveries.find(row=>row.destination===address);
    const stored=await ownBindings.DB.prepare('SELECT mail_payload_json AS payload FROM notification_delivery_records WHERE id=?').bind(queuedLog.id).first();
    const {frozenAt,...frozenMessage}=JSON.parse(stored.payload);
    for(let replay=0;replay<6;replay++){
      let retried=false;
      await assert.rejects(runQueue({messages:[{body:{type:'delivery-dispatch',eventId:published.body.update.id},ack(){assert.fail('a rejected primary must not acknowledge the Queue event');},retry(){retried=true;}}]},bindings),/Synthetic provider outage/);
      assert.equal(retried,true);
    }
    const beforeDeadline=(await api(`/api/app/deliveries?incidentUpdateId=${published.body.update.id}`)).body.deliveries.find(row=>row.destination===address);
    assert.equal(beforeDeadline.outcome,'queued','fast Queue replays cannot exhaust delivery before its five-minute failover deadline');
    t.mock.timers.tick(60_000);
    await scheduled();
    assert.equal(secondary.filter(body=>body.to===address).length,0);
    t.mock.timers.tick(5*60_000);
    await scheduled();
    const accepted=secondary.filter(body=>body.to===address);
    assert.equal(accepted.length,1,'one secondary acceptance within seven controlled minutes');
    const failed=primary.filter(row=>row.body.to.includes(address)&&row.key.startsWith('notification/'));
    assert.ok(failed.length>=2);
    assert.equal(accepted[0].messageId,failed[0].body.headers['Message-ID'],'the frozen Message-ID survives provider failover');
    assert.equal(accepted[0].text,failed[0].body.text);
    const log=await api(`/api/app/deliveries?incidentUpdateId=${published.body.update.id}`);
    assert.equal(log.status,200,log.text);
    const row=log.body.deliveries.find(row=>row.destination===address);
    assert.equal(row.acceptingProvider,secondaryProvider);
    assert.ok(row.providerAcceptedAt);
    const ownerDisabled=await api('/api/app/mail-settings',{method:'PATCH',body:JSON.stringify({secondaryProvider:null})});assert.equal(ownerDisabled.status,200,ownerDisabled.text);
    outage=false;
    const before=primary.filter(row=>row.body.to.includes(address)&&row.key.startsWith('notification/')).length;
    t.mock.timers.tick(60_000);await scheduled();
    assert.equal(secondary.filter(body=>body.to===address).length,1);
    assert.equal(primary.filter(row=>row.body.to.includes(address)&&row.key.startsWith('notification/')).length,before,'restoring the primary does not resend');
    let event,headers={'Content-Type':'application/json'};
    if(secondaryProvider==='mailgun'){
      event={signature:{timestamp:String(Math.floor(Date.now()/1000)),token:'synthetic-lamp-mailgun-token-1',signature:''},'event-data':{id:'synthetic-lamp-mailgun-bounce-1',event:'failed',severity:'permanent','delivery-status':{code:550},'user-variables':{lamp_message_id:accepted[0].id}}};
      event.signature.signature=createHmac('sha256',signingKey).update(event.signature.timestamp+event.signature.token).digest('hex');
    }else if(secondaryProvider==='ses')event=snsBounce(accepted[0].id,sns);
    else{event={RecordType:'Bounce',ID:'synthetic-lamp-postmark-bounce-1',MessageID:'synthetic-lamp-postmark-1',Type:'HardBounce',Metadata:{lamp_message_id:accepted[0].id}};headers.Authorization=`Basic ${Buffer.from(`lamp:${postmarkSecret}`).toString('base64')}`;}
    const receipt=(body,requestHeaders=headers)=>runtime.app.fetch(new Request(`${pageOrigin}/api/intake/mail-events/${secondaryProvider}`,{method:'POST',headers:requestHeaders,body:JSON.stringify(body)}),bindings,execution);
    const invalid=secondaryProvider==='mailgun'?{...event,signature:{...event.signature,signature:'0'.repeat(64)}}:secondaryProvider==='ses'?{...event,Signature:'0'.repeat(64)}:event;
    assert.equal((await receipt(invalid,secondaryProvider==='postmark'?{'Content-Type':'application/json'}:headers)).status,401);
    if(secondaryProvider==='mailgun'){
      const temporary={...event,'event-data':{...event['event-data'],id:'synthetic-lamp-mailgun-temporary-1',severity:'temporary','delivery-status':{code:450}}};
      assert.equal((await receipt(temporary)).status,200);
      const pending=(await api(`/api/app/deliveries?incidentUpdateId=${published.body.update.id}`)).body.deliveries.find(row=>row.destination===address);
      assert.equal(pending.subscriberState,'active');assert.equal(pending.outcome,'queued','Mailgun temporary delivery attempts do not become final bounce outcomes');
    }
    assert.equal((await receipt(event)).status,200);
    let subscriber;
    for(let offset=0;!subscriber;offset+=100){
      const subscribers=await api(`/api/app/subscribers?limit=100&offset=${offset}`);assert.equal(subscribers.status,200,subscribers.text);
      subscriber=subscribers.body.subscribers.find(row=>row.destination===address);if(!subscribers.body.hasMore)break;
    }
    assert.ok(subscriber);
    assert.equal(subscriber.state,'deactivated');assert.equal(subscriber.deactivationReason,'hard bounce');
    assert.equal((await receipt(event)).status,200,'a verified provider replay has no duplicate effect');
    const disabled=await api('/api/app/mail-settings',{method:'PATCH',body:JSON.stringify({secondaryProvider:null})});assert.equal(disabled.status,200,disabled.text);
    const {MAIL_SECONDARY_PROVIDER:configuredSecondary,MAIL_SECONDARY_API_KEY:configuredSecondaryKey,...directBindings}=bindings;
    const primaryBindings={...directBindings,MAIL_PROVIDER:secondaryProvider,MAIL_PROVIDER_API_KEY:configuredSecondaryKey};
    const direct=createApp(primaryBindings);
    const senderCheck=await direct.app.fetch(new Request(`${appOrigin}/api/app/overview`,{headers:{Origin:appOrigin,Cookie:cookie}}),primaryBindings,execution);
    assert.equal(senderCheck.status,200,await senderCheck.clone().text());
    assert.equal((await senderCheck.json()).overview.live.sender.state,'verified',`${secondaryProvider} sender authentication is read through its real provider API at the public operator door`);
  } finally { globalThis.fetch=realFetch;t.mock.timers.reset();await snapshotRuntime.dispose();await sns?.close(); }
}
