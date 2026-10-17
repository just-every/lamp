import assert from "node:assert/strict";

/** Composable public-route journey. Registers no test and starts no process. */
export async function maintenanceCommunicationFlow({ appFetch, pageUrl, querySql, publicFetch=fetch }) {
  const request=async(path,{method="GET",body,status=200}={})=>{const response=await appFetch(path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(response.status,status,`${method} ${path}: ${await response.clone().text()}`);return response.json();};
  const read=async(path)=>{const response=await publicFetch(`${pageUrl}${path}`);assert.equal(response.status,200,path);return response.text();};
  const waitFor=async(path,predicate)=>{let text;const deadline=Date.now()+10_000;do{text=await read(path);if(predicate(text))return text;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);assert.ok(predicate(text),`${path} never exposed the committed generation`);};
  const scheduler=async()=>assert.equal((await publicFetch(`${pageUrl}/cdn-cgi/local/scheduled`)).status,200);
  const rows=async()=> (await request("/api/app/maintenance")).maintenance;
  const {component}=await request("/api/app/components",{method:"POST",status:201,body:{name:"Maintenance communication service",description:"Maintenance wording and calendar journey",groupId:null,internal:false,displayOrder:1011,note:""}});
  const wording={affectedAudience:"Dashboard customers",customerImpact:"Dashboard is read-only; API writes queue and replay",whatStillWorks:"Reads and existing sessions continue",details:`Progress is published at https://example.com/progress . ${"Calendar 😀 wording; ".repeat(15)}`};
  const future=Date.now()+48*3600_000;
  const body={title:"Maintenance communication and calendar",startsAt:new Date(future).toISOString(),endsAt:new Date(future+30*60_000).toISOString(),componentIds:[component.id],...wording,autoStart:false,autoComplete:false,remindPrior:true,channels:[]};
  await request("/api/app/maintenance",{method:"POST",status:400,body:{title:body.title,startsAt:body.startsAt,endsAt:body.endsAt,componentIds:body.componentIds}});
  const payload={...body,state:"Scheduled",correctsNoticeId:null};
  const {draft}=await request("/api/app/maintenance/drafts/communication-proof",{method:"PUT",body:{version:0,payload}});
  assert.deepEqual((await request("/api/app/maintenance/drafts/communication-proof")).draft.payload,payload);
  await request("/api/app/maintenance/drafts/communication-proof",{method:"PUT",status:409,body:{version:0,payload}});
  const {preview}=await request("/api/app/maintenance/preview",{method:"POST",body:payload});
  assert.ok(preview.plainText.includes(wording.customerImpact));assert.ok(preview.html.includes("Customer impact"));
  assert.ok(!(await read("/feed.atom")).includes(body.title),"draft and preview remain private");
  const {maintenance}=await request("/api/app/maintenance",{method:"POST",status:201,body:{...body,draftId:draft.id,draftVersion:draft.version}});
  const consumed=(await request("/api/app/maintenance/drafts/communication-proof")).draft;assert.equal(consumed.payload.customerImpact,"");assert.ok(consumed.version>draft.version,"consumption clears wording and advances the version, preventing stale resurrection");
  await request("/api/app/maintenance/drafts/communication-proof",{method:"PUT",status:409,body:{version:draft.version,payload}});
  const path=`/maintenance/${maintenance.reference}`;
  await waitFor(path,text=>text.includes(wording.customerImpact));
  for(const surface of ["/","/feed.atom","/feed.rss","/api/v2/scheduled-maintenances/upcoming.json","/api/public/v1/maintenance"]){assert.ok((await read(surface)).includes(wording.customerImpact),surface);}
  let ics=await read("/maintenance.ics");
  assert.ok(ics.includes("\r\n"));assert.ok(!ics.replaceAll("\r\n","").includes("\n"));
  for(const line of ics.split("\r\n"))assert.ok(Buffer.byteLength(line,"utf8")<=75,"calendar folds at UTF-8 octets");
  const unfold=text=>text.replace(/\r\n[ \t]/g,"");
  const event=text=>unfold(text).split("BEGIN:VEVENT\r\n").find(value=>value.includes(`UID:lamp-maintenance-${maintenance.id}@`));
  const original=event(ics);assert.ok(original);const description=original.match(/^DESCRIPTION:(.*)$/m)?.[1].replace(/\\([\\;,nN])/g,(_match,value)=>/[nN]/.test(value)?"\n":value);assert.ok(description?.includes(wording.customerImpact),"calendar text escapes decode to the complete customer wording");const uid=original.match(/^UID:(.+)$/m)[1].trim();
  const nextWindow={startsAt:new Date(future+3600_000).toISOString(),endsAt:new Date(future+5400_000).toISOString()};
  await request(`/api/app/maintenance/${maintenance.id}/window`,{method:"PUT",body:nextWindow});
  ics=await waitFor("/maintenance.ics",text=>event(text)?.includes("SEQUENCE:1"));assert.ok(event(ics).includes(`UID:${uid}`));
  await request(`/api/app/maintenance/${maintenance.id}/cancel`,{method:"POST"});
  ics=await waitFor("/maintenance.ics",text=>event(text)?.includes("STATUS:CANCELLED"));assert.ok(event(ics).includes(`UID:${uid}`));assert.ok(event(ics).includes("SEQUENCE:2"));
  const {maintenance:active}=await request("/api/app/maintenance",{method:"POST",status:201,body:{...body,title:"Manual maintenance remains active",startsAt:new Date(Date.now()-60*60_000).toISOString(),endsAt:new Date(Date.now()-20*60_000).toISOString()}});
  await scheduler();await scheduler();assert.equal((await rows()).find(row=>row.id===active.id).state,"Scheduled","auto-start off keeps overdue windows Scheduled");
  assert.equal(querySql(`SELECT COUNT(*) AS n FROM notification_outbox WHERE kind='operator-alert' AND aggregate_id='maintenance-start-due/${active.id}/${active.startsAt}'`)[0].n,1,"repeated Cron queues one start-due operator alert");
  const update=async(state,customerImpact,extra={})=>request(`/api/app/maintenance/${active.id}/updates`,{method:"POST",body:{...wording,state,customerImpact,channels:[],correctsNoticeId:null,...extra}});
  const {maintenance:started}=await update("In progress","Migration running, about 10 more minutes");
  assert.equal(started.state,"In progress");
  await scheduler();await scheduler();const held=(await rows()).find(row=>row.id===active.id);assert.equal(held.state,"In progress");assert.equal(held.overrunning,true);assert.equal(held.notices.some(notice=>notice.kind==="completed"),false);
  assert.equal(querySql(`SELECT COUNT(*) AS n FROM notification_outbox WHERE kind='operator-alert' AND aggregate_id='maintenance-overrun/${active.id}/${active.endsAt}'`)[0].n,1,"repeated Cron and list reads queue one overrun alert");
  const {maintenance:verifying}=await update("Verifying","Migration is complete; checking writes");assert.equal(verifying.state,"Verifying");
  await waitFor("/api/v2/scheduled-maintenances/active.json",text=>text.includes("verifying")&&text.includes("checking writes"));
  const componentView=JSON.parse(await read("/api/v2/components.json")).components.find(row=>row.name===component.name);assert.equal(componentView.status,"under_maintenance");
  const originalNotice=verifying.notices.find(notice=>notice.kind==="verifying");
  const {maintenance:corrected}=await update("Verifying","Checking reads and writes",{correctsNoticeId:originalNotice.id});assert.equal(corrected.notices.find(notice=>notice.id===originalNotice.id).body,originalNotice.body);assert.ok(corrected.notices.some(notice=>notice.correctsNoticeId===originalNotice.id));
  await update("Completed","Maintenance completed and verified");await scheduler();await scheduler();const completed=(await rows()).find(row=>row.id===active.id);assert.equal(completed.notices.filter(notice=>notice.kind==="completed").length,1);
  await waitFor(`/maintenance/${active.reference}`,text=>text.includes("Maintenance completed and verified"));
  assert.equal(JSON.parse(await read("/api/v2/components.json")).components.find(row=>row.name===component.name).status,"operational");
  const deliveries=[];let offset=0;for(;;){const page=await request(`/api/app/deliveries?limit=100&offset=${offset}`);deliveries.push(...page.deliveries);if(!page.hasMore)break;offset+=page.limit;}
  assert.ok(deliveries.every(delivery=>![maintenance.id,active.id].includes(delivery.maintenanceId)),"all-off notices commit no subscriber recipients");
  return {maintenance,active,component};
}
