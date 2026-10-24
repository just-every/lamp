import assert from "node:assert/strict";
import { load } from "../../operator-readiness/runtime.mjs";
export async function preparePortableMetrics({env,native,cookie,sessionSecret}) {
  await env.DB.prepare(`INSERT OR IGNORE INTO page_settings(id,page_name,tagline,accent_color,timezone,hostname,feed_id,mail_from_address,created_at,updated_at) VALUES('default','synthetic-lamp-90','Portable performance history','#16794c','UTC','status.example.test','synthetic-lamp-91','synthetic-lamp-92@example.test','2026-10-24','2026-10-24')`).run();
  const {createApp}=await load("src/core/app/server.ts");
  const bindings={...env,AUTH_ORIGIN:native.origin,LAMP_APP_HOST:new URL(native.origin).host,LAMP_PAGE_HOST:"status.example.test",SESSION_SECRET:sessionSecret,WEBHOOK_SIGNING_SECRET:"synthetic-lamp-93",SUBSCRIBER_TOKEN_SECRET:"synthetic-lamp-94",MAIL_FROM_ADDRESS:"synthetic-lamp-92@example.test"};
  const runtime=createApp(bindings);
  async function post(path,body) {
    const response=await runtime.app.fetch(new Request(native.origin+path,{method:"POST",headers:{Cookie:cookie,Origin:native.origin,"Content-Type":"application/json"},body:JSON.stringify(body)}),bindings);
    assert.ok([200,201].includes(response.status),await response.clone().text());return response.json();
  }
  const component=(await post("/api/app/components",{name:"synthetic-lamp-95",groupId:null,description:"Portable metrics",internal:false,displayOrder:0,note:""})).component;
  const source=(await post("/api/app/intake/sources",{name:"synthetic-lamp-96",preset:"datadog",componentId:component.id,credentialKind:"bearer-token"})).source;
  const push=(await post("/api/app/metrics",{name:"synthetic-lamp-97",unit:"ms",provider:"push",componentId:component.id})).metric;
  const point={at:Math.floor(Date.now()/60_000)*60_000-60_000,value:42};await post(`/api/app/metrics/${push.id}/points`,{points:[point]});
  const pull=(await post("/api/app/metrics",{name:"synthetic-lamp-98",unit:"ms",provider:"datadog",componentId:component.id,sourceId:source.id,query:"avg:synthetic.metric{*}",credentials:{key:"synthetic-lamp-99",applicationKey:"synthetic-lamp-100"}})).metric;
  const sealed=(await env.DB.prepare("SELECT sealed_credentials FROM public_metrics WHERE id=?").bind(pull.id).first()).sealed_credentials;assert.ok(sealed);
  return {push,pull,point,sealed};
}
export async function assertPortableMetrics({expected,app,bindings,origin,cookie,db}) {
  const response=await app.fetch(new Request(origin+"/api/app/metrics",{headers:{Cookie:cookie}}),bindings);assert.equal(response.status,200);const text=await response.text(),metrics=JSON.parse(text).metrics;
  assert.equal(metrics.find(metric=>metric.id===expected.push.id).name,expected.push.name);assert.equal(metrics.find(metric=>metric.id===expected.pull.id).connected,false,"a restored metric query requires reconnecting its read-only key");
  for(const value of [expected.sealed,"synthetic-lamp-99","synthetic-lamp-100"])assert.ok(!text.includes(value));
  assert.equal((await db.prepare("SELECT sealed_credentials FROM public_metrics WHERE id=?").bind(expected.pull.id).first()).sealed_credentials,null);
  assert.deepEqual((await db.prepare("SELECT bucket,value_sum,samples FROM metric_points WHERE metric_id=?").bind(expected.push.id).all()).results.map(row=>({...row})),[{bucket:expected.point.at,value_sum:42,samples:1}],"minute aggregates and coverage survive the native archive");
}
