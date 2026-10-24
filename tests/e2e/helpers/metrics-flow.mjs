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
    assert.equal((await post(`/api/app/metrics/${push.id}/points`,{points})).status,200);
    let html=await page();assert.ok(html.includes(`data-metric="${push.id}"`));assert.ok(html.includes("160 ms"),"a pushed series is rendered in the next snapshot");
    assert.match(html,/No data for 20 minutes/);const article=html.match(new RegExp(`<article[^>]*data-metric="${push.id}"[\\s\\S]*?</article>`))[0];
    assert.equal((article.match(/<path /g)??[]).length,2,"the twenty-minute gap splits the SVG into two unconnected paths");
    assert.ok(article.includes(new Date(points[19].at).toISOString()),"the gap names when reporting stopped");
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
    await tick(minute+32*86400_000);assert.deepEqual((await fixture.db.prepare("SELECT DISTINCT resolution FROM metric_points WHERE metric_id=?").bind(push.id).all()).results.map(row=>row.resolution),[86400]);
    await tick(minute+92*86400_000);assert.equal((await fixture.db.prepare("SELECT count(*) n FROM metric_points WHERE metric_id=?").bind(push.id).first()).n,0,"aggregates expire after ninety days");
    t.diagnostic("UPTIME-008/INTAKE-011: next-snapshot pushes, four real provider adapters at fake edges, twenty-minute disconnected gap, verified Uptime timings and aggregate retention passed.");
  } finally {await fixture.close();}
}
async function auditPublicCharts(origin) {
  const browser=await chromium.launch({headless:true,args:["--use-mock-keychain","--password-store=basic"]});
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
      const axe=await new AxeBuilder({page:active}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze();
      assert.deepEqual(axe.violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],`${width}: public charts have no serious axe finding`);
    }
    assert.deepEqual(errors,[],"public charts have no hydration mismatch or script error");await audited.close();
  }finally{await browser.close();}
}
