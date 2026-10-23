import assert from "node:assert/strict";
import { openSubscriberManagementFixture, eventuallySubscriber, pageOrigin } from "./subscriber-management-fixture.mjs";
import { moveInDoor } from "../../helpers/import-notifications.mjs";

/** Only bulk population is setup SQL. The limits, refusal, row accounting,
 * operator messages and recovery below are exercised through product doors. */
export async function seedSubscriberLimitFixture(db,start,count,channel="email") {
  const now=new Date().toISOString();
  await db.prepare(`WITH RECURSIVE sequence(n) AS (SELECT ? UNION ALL SELECT n+1 FROM sequence WHERE n<?)
    INSERT INTO subscribers(id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at)
    SELECT '01JLIMIT' || printf('%018d',n),?,CASE WHEN ?='email' THEN 'synthetic-lamp-limit-' || n || '@example.test'
      ELSE 'https://receiver.example.test/synthetic-lamp-limit-' || n END,NULL,'active','all','synthetic-lamp-limit-token-' || n,?,? FROM sequence`)
    .bind(start,start+count-1,channel,channel,now,now).run();
}
export const subscriberLimitSourceFiles=(count)=>[
  {name:"page.json",text:JSON.stringify({id:"synthetic-lamp-limit-page",name:"Synthetic Lamp source",viewers_must_be_team_members:false,ip_restrictions:null})},
  {name:"page-access-groups.json",text:"[]"},
  {name:"components.json",text:JSON.stringify([{id:"synthetic-lamp-limit-component",name:"Synthetic Lamp imported API",position:1,status:"operational",created_at:"2026-10-01T00:00:00.000Z"}])},
  {name:"subscribers.json",text:JSON.stringify(Array.from({length:count},(_,index)=>({id:`synthetic-lamp-limit-import-${index}`,mode:"email",email:`synthetic-lamp-limit-import-${index}@example.test`,components:[],created_at:"2026-10-01T00:00:00.000Z"})))},
];

export async function subscriberLimitsFlow() {
  const fixture=await openSubscriberManagementFixture();
  const db=await fixture.runtime.getD1Database("DB");
  const capacity=async()=>{
    const response=await fixture.api("/api/app/subscribers?limit=1");assert.equal(response.status,200,response.text);return response.body.capacity;
  };
  const count=async()=>Number((await db.prepare("SELECT COUNT(*) AS count FROM subscribers WHERE state IN ('pending','active')").first()).count);
  const subscribe=email=>fixture.raw(`${pageOrigin}/subscribe`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Accept":"text/html"},body:new URLSearchParams({email})});
  const flush=async()=>{const worker=await fixture.runtime.getWorker();const result=await worker.scheduled({cron:"* * * * *"});assert.equal(result.outcome,"ok","the real scheduled handler completes");};
  const limitMessages=()=>fixture.messages.filter(message=>message.to.includes("synthetic-lamp-owner@example.test")&&/subscriptions reached/u.test(message.subject));
  const moveIn=moveInDoor((path,json,headers)=>fixture.api(path,{...(json?{method:"POST",body:JSON.stringify(json)}:{}),headers}));
  try {
    for(const size of [5_000,25_000]) {
      const started=performance.now();
      const fitting=await moveIn.preview({files:subscriberLimitSourceFiles(size)});
      assert.equal(fitting.status,200,JSON.stringify(fitting.body));
      assert.equal(fitting.body.report.counts.subscriber.read,size);
      assert.equal(fitting.body.report.counts.subscriber.rejected,0);
      assert.deepEqual(fitting.body.report.limits,[]);
      assert.equal(await count(),0,"a Business or Enterprise dry run creates no subscriptions");
      console.log(`SUB-020 ${size} subscribers fit a read-only dry run in ${((performance.now()-started)/1000).toFixed(3)}s`);
    }
    await seedSubscriberLimitFixture(db,1,19_999);
    const eighty=await subscribe("synthetic-lamp-capacity-eighty@example.test");assert.equal(eighty.status,202,await eighty.text());
    await flush();
    await eventuallySubscriber(()=>limitMessages(),messages=>messages.length===1,"the 80% alert crosses the ordinary mail provider boundary");
    await flush();assert.equal(limitMessages().length,1,"the same 80% crossing is not alerted twice");
    await seedSubscriberLimitFixture(db,20_001,4_999);
    const hundred=await subscribe("synthetic-lamp-capacity-hundred@example.test");assert.equal(hundred.status,202,await hundred.text());
    await flush();
    await eventuallySubscriber(()=>limitMessages(),messages=>messages.length===2,"the 100% alert crosses the ordinary mail provider boundary");
    assert.equal(limitMessages().filter(message=>/80%/u.test(message.subject)).length,1);
    assert.equal(limitMessages().filter(message=>/100%/u.test(message.subject)).length,1);
    assert.equal(await count(),25_000,"the direct fixture setup and two real public opt-ins reached the capacity fixture");
    const beforeMail=fixture.messages.length,beforeRows=await count();
    const denied=[];
    for(const email of ["synthetic-lamp-capacity-new@example.test","synthetic-lamp-capacity-hundred@example.test"]) {
      const response=await subscribe(email);assert.equal(response.status,409);const text=await response.text();
      assert.match(text,/cannot take new subscriptions on that channel right now/u);
      assert.match(text,/href="\/feed\.atom"/u);assert.match(text,/href="\/feed\.rss"/u);denied.push(text);
    }
    assert.equal(denied[0],denied[1],"a new and an existing address receive identical full-channel pages");
    assert.equal(await count(),beforeRows);assert.equal(fixture.messages.length,beforeMail,"a full channel sends neither confirmation nor management mail");
    const report=await capacity();assert.ok(report.some(row=>row.channel==="all"&&row.count===25_000&&row.count===row.limit));
    assert.ok(report.some(row=>row.channel==="email"&&row.count===25_000));
    let followUps=(await fixture.api("/api/app/overview/follow-ups")).body.followUps;
    assert.ok(followUps.some(row=>row.id==="subscriber-limit:all"&&row.link==="/app/subscribers"),"full capacity remains a Follow-up");
    // A setup adjustment supplies the separate 100-free-slot import fixture.
    await db.prepare("UPDATE subscribers SET state='deactivated',deactivation_reason='synthetic fixture capacity setup' WHERE id IN (SELECT id FROM subscribers WHERE id LIKE '01JLIMIT%' ORDER BY id LIMIT 100)").run();
    assert.equal(await count(),24_900);
    followUps=(await fixture.api("/api/app/overview/follow-ups")).body.followUps;
    assert.ok(!followUps.some(row=>row.id==="subscriber-limit:all"),"dropping below capacity removes the live obligation");
    const files=subscriberLimitSourceFiles(300),beforeImport=await count();
    const preview=await moveIn.preview({files});assert.equal(preview.status,200,JSON.stringify(preview.body));
    assert.ok(preview.body.report.limits.some(text=>text.includes("over the 25,000 limit by 200")),JSON.stringify({limits:preview.body.report.limits,counts:preview.body.report.counts,subscribers:preview.body.report.items.filter(row=>row.kind==="subscriber").slice(0,2)}));
    assert.equal(preview.body.report.counts.subscriber.rejected,200);
    assert.equal(preview.body.report.items.filter(row=>row.kind==="subscriber"&&row.outcome==="rejected"&&row.reason==="over the subscriber limit").length,200);
    const rejected=await moveIn.apply(preview.body);assert.equal(rejected.status,409,JSON.stringify(rejected.body));assert.equal(await count(),beforeImport,"an over-limit apply creates no prefix of the import");
    const narrowed=await moveIn.preview({files:files.filter(file=>file.name!=="subscribers.json")});assert.equal(narrowed.status,200,JSON.stringify(narrowed.body));assert.deepEqual(narrowed.body.report.limits,[]);
    const applied=await moveIn.apply(narrowed.body);assert.equal(applied.status,200,JSON.stringify(applied.body));assert.equal(applied.body.job.state,"completed");assert.equal(await count(),beforeImport,"leaving out the email channel makes a fresh import fit");
    const csv="email\r\n"+Array.from({length:300},(_,index)=>`synthetic-lamp-limit-csv-${index}@example.test\r\n`).join("");
    const csvPreview=await fixture.post("/api/app/subscribers/import/preview",{csv});assert.equal(csvPreview.status,200,csvPreview.text);
    assert.ok(csvPreview.body.limits.some(text=>text.includes("over the 25,000 limit by 200")));assert.equal(csvPreview.body.counts.refused,200);
    assert.equal(csvPreview.body.rows.filter(row=>row.reason==="over the subscriber limit").length,200);
    const csvDenied=await fixture.post("/api/app/subscribers/import/apply",{csv,reviewedFingerprint:csvPreview.body.fingerprint});assert.equal(csvDenied.status,409,csvDenied.text);assert.equal(await count(),beforeImport);
    const fitting="email\r\nsynthetic-lamp-limit-csv-fit@example.test\r\n";
    const fittingPreview=await fixture.post("/api/app/subscribers/import/preview",{csv:fitting});assert.equal(fittingPreview.status,200,fittingPreview.text);assert.deepEqual(fittingPreview.body.limits,[]);
    const fittingApply=await fixture.post("/api/app/subscribers/import/apply",{csv:fitting,reviewedFingerprint:fittingPreview.body.fingerprint});assert.equal(fittingApply.status,200,fittingApply.text);assert.equal(fittingApply.body.counts.created,1);
    await flush();assert.equal(limitMessages().length,2,"repeated imports and below-limit recovery do not repeat either crossing alert");
  } finally {await fixture.close();}
  await subscriberChannelLimitsFlow();
}

async function subscriberChannelLimitsFlow() {
  const fixture=await openSubscriberManagementFixture({extraBindings:{SLACK_CLIENT_ID:"synthetic-lamp-client-1",SLACK_CLIENT_SECRET:"synthetic-lamp-client-secret-1",SLACK_SIGNING_SECRET:"synthetic-lamp-slack-signing-1"}});
  const db=await fixture.runtime.getD1Database("DB");
  try {
    await seedSubscriberLimitFixture(db,1,2_500,"webhook");
    const before=fixture.messages.length;
    for(const destination of ["https://receiver.example.test/synthetic-lamp-capacity-new","https://receiver.example.test/synthetic-lamp-limit-1"]) {
      const denied=await fixture.post("/api/app/subscribers/webhook",{destination,contactEmail:"synthetic-lamp-limit-contact@example.test",componentIds:[]});
      assert.equal(denied.status,409,denied.text);
    }
    assert.equal(fixture.messages.length,before);
    assert.ok((await fixture.api("/api/app/overview/follow-ups")).body.followUps.some(row=>row.id==="subscriber-limit:webhook"));
    await db.prepare("UPDATE subscribers SET state='deactivated' WHERE id=(SELECT id FROM subscribers ORDER BY id LIMIT 1)").run();
    const admitted=await fixture.post("/api/app/subscribers",{channel:"webhook",destination:"https://receiver.example.test/synthetic-lamp-capacity-fit",contactEmail:"synthetic-lamp-limit-contact@example.test",componentIds:[]});
    assert.equal(admitted.status,201,admitted.text);assert.equal(admitted.body.subscriber.state,"pending","pending subscriptions consume the recovered slot");
    const fullAgain=await fixture.post("/api/app/subscribers/webhook",{destination:"https://receiver.example.test/synthetic-lamp-capacity-full",contactEmail:"synthetic-lamp-limit-contact-2@example.test",componentIds:[]});
    assert.equal(fullAgain.status,409,fullAgain.text);
    // Separate setup for the combined chat bucket, keeping total far below full.
    await db.prepare("DELETE FROM subscriber_intake").run();
    await db.prepare("DELETE FROM subscriber_tokens").run();
    await db.prepare("DELETE FROM subscribers").run();
    await seedSubscriberLimitFixture(db,1,500,"slack");await seedSubscriberLimitFixture(db,501,500,"teams");
    const form=(path,body)=>fixture.raw(pageOrigin+path,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Accept":"text/html"},body:new URLSearchParams(body)});
    const teams=await form("/subscribe/teams",{url:"https://synthetic-lamp.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/synthetic-lamp-1/triggers/manual/paths/invoke?sig=synthetic-lamp-1"});
    assert.equal(teams.status,409,await teams.text());
    const slack=await form("/subscribe/slack",{});assert.equal(slack.status,409,await slack.text());
    assert.ok((await fixture.api("/api/app/overview/follow-ups")).body.followUps.some(row=>row.id==="subscriber-limit:chat"));
    const report=(await fixture.api("/api/app/subscribers?limit=1")).body.capacity;
    const combined=report.find(row=>row.channel==="slack-and-teams");assert.equal(combined.count,combined.limit);
  } finally {await fixture.close();}
}
