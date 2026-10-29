import { existsSync } from 'node:fs';
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { openFollowUpsRuntime,eventuallyFollowUp } from "./follow-ups-runtime.mjs";
import { metricsProviderEdge } from "./metrics-provider-edge.mjs";
export async function metricsFlow({t}) {
  const calls=[],fixture=await openFollowUpsRuntime({pageHost:"localhost",providerEdge:metricsProviderEdge(calls)});
  const {api,post,raw,publicOrigin}=fixture;
  const minute=Math.floor(Date.now()/60_000)*60_000;
  const made=await post("/api/app/components",{name:"synthetic-lamp-23",groupId:null,description:"API response times",internal:false,displayOrder:0,note:""});assert.equal(made.status,201,made.text);
  const componentId=made.body.component.id;
  const create=async input=>{const result=await post("/api/app/metrics",{componentId,name:"synthetic-lamp-24",unit:"ms",...input});assert.equal(result.status,201,result.text);return result.body.metric;};
  const page=async()=>{const response=await raw(publicOrigin+"/");assert.equal(response.status,200);return response.text();};
  const tick=async at=>{const result=await (await fixture.runtime.getWorker()).scheduled({cron:"* * * * *",scheduledTime:at});assert.equal(result.outcome,"ok");};
  try {
    const push=await create({provider:"push"});
    const points=Array.from({length:61},(_,index)=>({at:minute-(61-index)*60_000,value:100+index})).filter((_,index)=>index<20||index>=40);
    const mint=async scopes=>{const result=await post("/api/app/management-tokens",{name:"synthetic-lamp-56",scopes,expiresInSeconds:3600});assert.equal(result.status,201,result.text);assert.equal(result.body.credential.lastUsedAt,null);return result.body;};
    const writer=await mint(["metrics:write"]),unscoped=await mint([]);
    const reader=await mint(["read"]);
    const readComponents=token=>raw(fixture.appOrigin+"/api/v1/components",{headers:{Authorization:`Bearer ${token}`}});
    const readMetrics=token=>raw(fixture.appOrigin+"/api/v1/metrics",{headers:{Authorization:`Bearer ${token}`}});
    const beforeRead=(await api("/api/app/management-tokens")).body.tokens;
    assert.equal((await readComponents(unscoped.token)).status,403,"a token without read scope cannot list components");
    assert.equal((await readComponents(writer.token)).status,403,"metrics:write does not imply read");
    assert.equal((await readMetrics(unscoped.token)).status,403,"a token without read scope cannot list metrics");
    assert.equal((await readMetrics(writer.token)).status,403,"metrics:write does not grant metric reads");
    assert.deepEqual((await api("/api/app/management-tokens")).body.tokens,beforeRead,"refusals do not change last-used metadata");
    const readResult=await readComponents(reader.token);
    assert.equal(readResult.status,200);assert.equal(readResult.headers.get("cache-control"),"no-store");
    assert.deepEqual(await readResult.json(),(await api("/api/app/components")).body,"the read bearer returns the same components and groups as the operator door, without a cookie");
    const metricRead=await readMetrics(reader.token);
    assert.equal(metricRead.status,200);assert.equal(metricRead.headers.get("cache-control"),"no-store");
    assert.deepEqual(await metricRead.json(),(await api("/api/app/metrics")).body,"the read bearer returns sanitized metric definitions through the management door without a cookie");
    const readMetadata=(await api("/api/app/management-tokens")).body.tokens.find(token=>token.id===reader.credential.id);
    assert.deepEqual(readMetadata.scopes,["read"]);assert.ok(readMetadata.lastUsedAt>=reader.credential.expiresAt-3600_000);
    const storedRead=await fixture.db.prepare("SELECT token_hash FROM oa_credentials WHERE id=?").bind(reader.credential.id).first();
    assert.ok(storedRead.token_hash&&!storedRead.token_hash.includes(reader.token));
    assert.ok(!(await api("/api/app/management-tokens")).text.includes(reader.token),"the read bearer is shown once");
    assert.equal((await post(`/api/app/management-tokens/${reader.credential.id}/revoke`,{})).status,200);
    const afterReadRevoke=(await api("/api/app/management-tokens")).body.tokens;
    assert.equal((await readComponents(reader.token)).status,401,"revocation immediately refuses the read bearer");
    assert.equal((await readMetrics(reader.token)).status,401,"revocation immediately refuses metric reads");
    assert.deepEqual((await api("/api/app/management-tokens")).body.tokens,afterReadRevoke);

    const tokenPush=(token,submitted=points)=>raw(fixture.appOrigin+`/api/v1/metrics/${push.id}/points`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({points:submitted})});
    const tokenState=async()=>({points:(await fixture.db.prepare("SELECT * FROM metric_points ORDER BY metric_id,resolution,bucket").all()).results,audit:(await fixture.db.prepare("SELECT * FROM audit_entries ORDER BY id").all()).results,tokens:(await api("/api/app/management-tokens")).body.tokens});
    const beforeScope=await tokenState();
    assert.equal((await tokenPush(unscoped.token)).status,403,"a management token without metrics:write cannot push");
    assert.deepEqual(await tokenState(),beforeScope,"scope refusal changes no samples, audit entries or token usage metadata");
    assert.equal((await tokenPush(writer.token)).status,200,"a metrics:write bearer pushes through the versioned management API without an operator cookie");
    const listed=await api("/api/app/management-tokens");
    for(const credential of [writer,unscoped])assert.ok(!listed.text.includes(credential.token),"management tokens are shown only when issued");
    const used=listed.body.tokens.find(row=>row.id===writer.credential.id);
    assert.ok(used.lastUsedAt!==null,"authorized use records last-used time");
    assert.deepEqual(used.scopes,["metrics:write"]);
    const pushAudits=(await fixture.db.prepare("SELECT entity_id,operator_id,payload_json FROM audit_entries WHERE action='metric.points-pushed'").all()).results;
    assert.deepEqual(pushAudits.map(row=>({metricId:row.entity_id,issuerId:row.operator_id,payload:JSON.parse(row.payload_json)})),[{metricId:push.id,issuerId:writer.credential.issuerId,payload:{tokenId:writer.credential.id}}],"the successful bearer write is attributed to its token and issuing operator");
    const storedCredential=await fixture.db.prepare("SELECT token_hash FROM oa_credentials WHERE id=?").bind(writer.credential.id).first();
    assert.ok(storedCredential.token_hash && storedCredential.token_hash!==writer.token,"the bearer credential is stored only as a hash");
    let html=await page();assert.ok(html.includes(`data-metric="${push.id}"`));assert.ok(html.includes("160 ms"),"a pushed series is rendered in the next snapshot");
    assert.match(html,/No data for 20 minutes/);const article=html.match(new RegExp(`<article[^>]*data-metric="${push.id}"[\\s\\S]*?</article>`))[0];
    assert.equal((article.match(/<path /g)??[]).length,2,"the twenty-minute gap splits the SVG into two unconnected paths");
    assert.ok(article.includes(new Date(points[19].at).toISOString()),"the gap names when reporting stopped");
    assert.ok(article.includes(new Date(points[20].at).toISOString()),"the gap names the instant reporting resumed");
    const revoke=await post(`/api/app/management-tokens/${writer.credential.id}/revoke`,{});assert.equal(revoke.status,200,revoke.text);
    const beforeRevoke=await tokenState();
    assert.equal((await tokenPush(writer.token,[{at:minute,value:999}])).status,401,"a revoked management token is refused immediately");
    assert.deepEqual(await tokenState(),beforeRevoke,"revocation refusal changes no samples, audit or usage metadata");
    const stopped=await create({provider:"push",name:"synthetic-lamp-54"});
    const stoppedAt=minute-21*60_000;
    assert.equal((await post(`/api/app/metrics/${stopped.id}/points`,{points:[{at:stoppedAt-60_000,value:10},{at:stoppedAt,value:12}]})).status,200);
    const stoppedArticle=(await page()).match(new RegExp(`<article[^>]*data-metric="${stopped.id}"[\\s\\S]*?</article>`))[0];
    assert.match(stoppedArticle,/No data since the source stopped reporting/);
    assert.ok(stoppedArticle.includes(new Date(stoppedAt).toISOString()),"a stopped source names the last reported instant");
    assert.equal((await fixture.db.prepare("SELECT count(*) n FROM metric_points WHERE metric_id=?").bind(stopped.id).first()).n,2,"a trailing reporting gap creates no interpolated points");
    const before=(await fixture.db.prepare("SELECT * FROM metric_points ORDER BY metric_id,resolution,bucket").all()).results;
    assert.equal((await raw(fixture.appOrigin+`/api/app/metrics/${push.id}/points`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({points:[{at:minute,value:999}]})})).status,401);
    assert.deepEqual((await fixture.db.prepare("SELECT * FROM metric_points ORDER BY metric_id,resolution,bucket").all()).results,before,"an unauthenticated push changes no series");
    const metricReader=await mint(["read"]);
    const feeds=[];
    for(const [provider,key,query,value] of [["datadog","synthetic-lamp-26","avg:synthetic.metric{*}",42],["newrelic","synthetic-lamp-28","SELECT average(duration) * 1000 AS value FROM Transaction",87],["pingdom","synthetic-lamp-29","123",60],["prometheus","synthetic-lamp-50","avg(synthetic_latency)",12.5]]) {
      let sourceId=null;
      if(provider!=="prometheus") {
        const source=await post("/api/app/intake/sources",{name:`synthetic-lamp-${31+feeds.length}`,preset:provider,componentId,credentialKind:"bearer-token"});assert.equal(source.status,201,source.text);sourceId=source.body.source.id;
      }
      const metric=await create({provider,sourceId,name:`synthetic-lamp-${35+feeds.length}`,query,...(provider==="newrelic"?{accountId:"123"}:{}),...(provider==="prometheus"?{endpoint:"https://synthetic-lamp-30.example.test"}:{}),credentials:{key,...(provider==="datadog"?{applicationKey:"synthetic-lamp-27"}:{})}});
      const listed=(await api("/api/app/metrics")).text;
      for(const secret of [key,"synthetic-lamp-27"])assert.ok(!listed.includes(secret),"read-only keys are never returned");
      const sealed=(await fixture.db.prepare("SELECT sealed_credentials FROM public_metrics WHERE id=?").bind(metric.id).first()).sealed_credentials;assert.ok(sealed&&!sealed.includes(key),"only sealed credentials are stored");
      const metricListing=await readMetrics(metricReader.token);assert.equal(metricListing.status,200);
      const metricListingText=await metricListing.text();
      assert.deepEqual(JSON.parse(metricListingText),(await api("/api/app/metrics")).body);
      for(const secret of [key,"synthetic-lamp-27",sealed])assert.ok(!metricListingText.includes(secret),"management metric reads return neither plaintext nor sealed provider credentials");
      feeds.push({metric,provider,value});
    }
    await tick(Date.now());
    await eventuallyFollowUp(async()=>await api("/api/app/metrics"),result=>feeds.every(({metric})=>result.body.metrics.find(row=>row.id===metric.id)?.lastReportedAt!==null),"all four read-only provider queries report aggregates");
    html=await page();
    for(const {metric,provider,value} of feeds) {assert.ok(calls.includes(provider));const shown=html.match(new RegExp(`<article[^>]*data-metric="${metric.id}"[\\s\\S]*?</article>`))?.[0];assert.ok(shown,provider);assert.ok(shown.includes(`${value} ms`),`${provider} query fixture fills a public chart`);assert.ok(shown.includes("<svg"));}
    const uptime=await post("/api/app/intake/sources",{name:"synthetic-lamp-40",preset:"uptime",credentialKind:"hmac-sha256",signingSecret:"synthetic-lamp-41",monitorMappings:[{monitorId:"synthetic-lamp-42",componentId}]});assert.equal(uptime.status,201,uptime.text);
    const timing=await create({provider:"uptime",sourceId:uptime.body.source.id,query:"synthetic-lamp-42",name:"synthetic-lamp-43"});
    const event={schemaVersion:2,id:"synthetic-lamp-44",kind:"trigger",eventType:"uptime.incident.firing",incidentKey:"synthetic-lamp-45",state:"firing",title:"synthetic-lamp-46",monitorId:"synthetic-lamp-42",observedAt:minute-60_000,probes:[],webhookContext:{responseTimeMs:123}};
    async function send(payload,secret="synthetic-lamp-41") {const body=JSON.stringify(payload),timestamp=new Date().toISOString();return raw(publicOrigin+uptime.body.source.endpointPath,{method:"POST",headers:{"Content-Type":"application/json","X-Lamp-Timestamp":timestamp,"X-Lamp-Signature":createHmac("sha256",secret).update(`${timestamp}.${body}`).digest("base64url")},body});}
    assert.equal((await send(event,"synthetic-lamp-47")).status,401);assert.equal((await api("/api/app/metrics")).body.metrics.find(row=>row.id===timing.id).lastReportedAt,null);
    assert.equal((await send(event)).status,202);assert.ok((await page()).includes("123 ms"),"authenticated paired Uptime event timings fill the chart");
    const savedPoints=(await fixture.db.prepare("SELECT * FROM metric_points WHERE metric_id=? ORDER BY bucket").bind(timing.id).all()).results;
    assert.equal((await send({...event,id:"synthetic-lamp-48",observedAt:minute,webhookContext:{}})).status,202);
    assert.deepEqual((await fixture.db.prepare("SELECT * FROM metric_points WHERE metric_id=? ORDER BY bucket").bind(timing.id).all()).results,savedPoints,"Uptime events with no timing fabricate no sample");
    await auditPublicCharts(publicOrigin);
    for(const {metric} of feeds)assert.equal((await api(`/api/app/metrics/${metric.id}`,{method:"DELETE"})).status,200);
    assert.equal((await api(`/api/app/metrics/${timing.id}`,{method:"DELETE"})).status,200);
    await tick(minute+26*3600_000);
    const hourly=(await fixture.db.prepare("SELECT resolution,SUM(value_sum) total,SUM(samples) samples FROM metric_points WHERE metric_id=? GROUP BY resolution").bind(push.id).all()).results;
    assert.deepEqual(hourly.map(row=>row.resolution),[3600]);assert.equal(hourly[0].samples,points.length);assert.equal(hourly[0].total,points.reduce((sum,p)=>sum+p.value,0),"hourly rollups retain weighted sums and coverage");
    await tick(minute+32*86400_000);
    const daily=(await fixture.db.prepare("SELECT resolution,SUM(value_sum) total,SUM(samples) samples FROM metric_points WHERE metric_id=? GROUP BY resolution").bind(push.id).all()).results;
    assert.deepEqual(daily.map(row=>row.resolution),[86400]);
    assert.equal(daily[0].samples,points.length,"daily rollups retain the uneven hourly sample counts");
    assert.equal(daily[0].total,points.reduce((sum,p)=>sum+p.value,0),"daily rollups preserve sums rather than averaging hourly means");
    await tick(minute+92*86400_000);assert.equal((await fixture.db.prepare("SELECT count(*) n FROM metric_points WHERE metric_id=?").bind(push.id).first()).n,0,"aggregates expire after ninety days");
    // Historical aggregates are fixture state; maintenance is exercised through
    // the same real scheduled Worker door as the minute-to-hour-to-day journey.
    const boundary=await create({provider:"push",name:"synthetic-lamp-55"});
    const day=86400_000,hour=3600_000;
    const boundaryNow=Math.floor((minute+100*day)/day)*day+12*hour;
    const minuteCutoff=boundaryNow-day,hourCutoff=boundaryNow-30*day,dayCutoff=Math.floor((boundaryNow-90*day)/day)*day;
    const seeded=[
      {resolution:60,bucket:minuteCutoff+60_000,total:11,samples:1},
      {resolution:60,bucket:minuteCutoff-60_000,total:17,samples:1},
      {resolution:3600,bucket:hourCutoff+hour,total:21,samples:2},
      {resolution:3600,bucket:hourCutoff-hour,total:30,samples:2},
      {resolution:3600,bucket:hourCutoff-2*hour,total:90,samples:3},
      {resolution:86400,bucket:dayCutoff+day,total:77,samples:7},
      {resolution:86400,bucket:dayCutoff-day,total:88,samples:8},
    ];
    await fixture.db.batch(seeded.map(row=>fixture.db.prepare("INSERT INTO metric_points(metric_id,resolution,bucket,value_sum,samples,last_at) VALUES(?,?,?,?,?,?)").bind(boundary.id,row.resolution,row.bucket,row.total,row.samples,row.bucket)));
    await tick(boundaryNow);
    const retained=(await fixture.db.prepare("SELECT resolution,bucket,value_sum,samples FROM metric_points WHERE metric_id=? ORDER BY resolution,bucket").bind(boundary.id).all()).results;
    const at=(resolution,bucket)=>retained.find(row=>row.resolution===resolution&&row.bucket===bucket);
    assert.deepEqual(at(60,minuteCutoff+60_000),{resolution:60,bucket:minuteCutoff+60_000,value_sum:11,samples:1},"a minute just inside the last-day boundary remains minute resolution");
    assert.equal(at(60,minuteCutoff-60_000),undefined,"a minute just outside the last-day boundary is absent at minute resolution");
    assert.deepEqual(at(3600,Math.floor((minuteCutoff-60_000)/hour)*hour),{resolution:3600,bucket:Math.floor((minuteCutoff-60_000)/hour)*hour,value_sum:17,samples:1},"the expired minute rolls into its hour without loss");
    assert.deepEqual(at(3600,hourCutoff+hour),{resolution:3600,bucket:hourCutoff+hour,value_sum:21,samples:2},"an hour just inside thirty days remains hourly");
    assert.equal(at(3600,hourCutoff-hour),undefined,"an hour just outside thirty days is absent at hourly resolution");
    const rolledDay=Math.floor((hourCutoff-hour)/day)*day;
    assert.deepEqual(at(86400,rolledDay),{resolution:86400,bucket:rolledDay,value_sum:120,samples:5},"unequal hourly sample counts combine into a weighted daily sum and count");
    assert.deepEqual(at(86400,dayCutoff+day),{resolution:86400,bucket:dayCutoff+day,value_sum:77,samples:7},"a day just inside ninety days remains daily");
    assert.equal(at(86400,dayCutoff-day),undefined,"a day just outside ninety days expires");
    assert.equal(retained.length,5,"only the expected retained and rolled aggregates remain");
    t.diagnostic("UPTIME-008/INTAKE-011: next-snapshot pushes, four real provider adapters at fake edges, twenty-minute disconnected gap, verified Uptime timings and aggregate retention passed.");
  } finally {await fixture.close();}
}
async function auditPublicCharts(origin) {
  const browser=await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),headless:true,args:["--no-sandbox","--use-mock-keychain","--password-store=basic"]});
  try {
    const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();
    if(process.env.LAMP_SCREENSHOTS)await mkdir(process.env.LAMP_SCREENSHOTS,{recursive:true});
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:width===390?844:1000});await page.goto(origin);
      assert.equal(await page.locator("[data-metric-chart]").count(),7,"all populated charts are inline with script disabled");
      assert.ok(await page.getByText("No data for 20 minutes.",{exact:false}).count());
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: charts do not overflow`);
      if(process.env.LAMP_SCREENSHOTS)await page.getByRole("region",{name:"Performance",exact:true}).screenshot({path:`${process.env.LAMP_SCREENSHOTS}/${width}-public-metrics.png`});
    }
    await context.close();
    const audited=await browser.newContext(),active=await audited.newPage(),errors=[];
    active.on("pageerror",error=>errors.push(error.message));
    active.on("console",message=>{if(message.type()==="error"&&/hydrat|did not match|server rendered/i.test(message.text()))errors.push(message.text());});
    for(const width of [1440,390]) {
      await active.setViewportSize({width,height:width===390?844:1000});await active.goto(origin);
      assert.ok(await active.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: script-enabled charts do not overflow`);
      const axe=await new AxeBuilder({page:active}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze();
      assert.deepEqual(axe.violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],`${width}: public charts have no serious axe finding`);
    }
    assert.deepEqual(errors,[],"public charts have no hydration mismatch or script error");await audited.close();
  }finally{await browser.close();}
}
