import assert from "node:assert/strict";
import { load } from "../../operator-readiness/runtime.mjs";
export async function preparePortableMetrics({env,native,cookie}) {
  // The native archive command is this flow's public door. Seed its source
  // installation, as for responder keys above; metric ingestion is exercised
  // through the real Worker in metricsFlow. The binding proxy has no Worker DO.
  const actor=await native.auth.getSession(native.request("/auth/session",{cookie}));assert.ok(actor);
  const [{createUlid},{sealUrl}]=await Promise.all([load("src/core/shared/ids.ts"),load("src/core/features/channels/sealing.ts")]);
  const componentId=createUlid(),sourceId=createUlid(),push={id:createUlid(),name:"synthetic-lamp-97"},pull={id:createUlid()};
  const now=new Date().toISOString(),point={at:Math.floor(Date.now()/60_000)*60_000-60_000,value:42};
  const aggregates=[
    {resolution:60,bucket:point.at,value_sum:42,samples:1},
    {resolution:3600,bucket:Math.floor((point.at-2*86400_000)/3600_000)*3600_000,value_sum:330,samples:7},
    {resolution:86400,bucket:Math.floor((point.at-40*86400_000)/86400_000)*86400_000,value_sum:9876,samples:123},
  ];
  const sealed=await sealUrl(JSON.stringify({key:"synthetic-lamp-99",applicationKey:"synthetic-lamp-100"}),pull.id,["synthetic-lamp-93"]);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO components(id,name,display_order,created_at,updated_at) VALUES(?,'synthetic-lamp-95',0,?,?)").bind(componentId,now,now),
    env.DB.prepare("INSERT INTO alert_sources(id,name,credential_kind,bearer_token_hash,deduplication_path,title_path,state_path,created_by_operator_id,preset,component_id,created_at,updated_at) VALUES(?,'synthetic-lamp-96','bearer-token','synthetic-lamp-94','id','title','state',?,'datadog',?,?,?)").bind(sourceId,actor.operator.id,componentId,now,now),
    env.DB.prepare("INSERT INTO public_metrics(id,component_id,name,unit,provider,last_reported_at,created_at,updated_at) VALUES(?,?,'synthetic-lamp-97','ms','push',?,?,?)").bind(push.id,componentId,point.at,now,now),
    env.DB.prepare("INSERT INTO public_metrics(id,component_id,source_id,name,unit,provider,query,sealed_credentials,created_at,updated_at) VALUES(?,?,?,'synthetic-lamp-98','ms','datadog','avg:synthetic.metric{*}',?,?,?)").bind(pull.id,componentId,sourceId,sealed,now,now),
    ...aggregates.map(row=>env.DB.prepare("INSERT INTO metric_points(metric_id,resolution,bucket,value_sum,samples,last_at) VALUES(?,?,?,?,?,?)").bind(push.id,row.resolution,row.bucket,row.value_sum,row.samples,row.bucket)),
  ]);
  return {push,pull,point,sealed,aggregates};
}
export async function assertPortableMetrics({expected,app,bindings,origin,cookie,db}) {
  const response=await app.fetch(new Request(origin+"/api/app/metrics",{headers:{Cookie:cookie}}),bindings);assert.equal(response.status,200);const text=await response.text(),metrics=JSON.parse(text).metrics;
  assert.equal(metrics.find(metric=>metric.id===expected.push.id).name,expected.push.name);assert.equal(metrics.find(metric=>metric.id===expected.pull.id).connected,false,"a restored metric query requires reconnecting its read-only key");
  for(const value of [expected.sealed,"synthetic-lamp-99","synthetic-lamp-100"])assert.ok(!text.includes(value));
  assert.equal((await db.prepare("SELECT sealed_credentials FROM public_metrics WHERE id=?").bind(expected.pull.id).first()).sealed_credentials,null);
  assert.deepEqual((await db.prepare("SELECT resolution,bucket,value_sum,samples FROM metric_points WHERE metric_id=? ORDER BY resolution,bucket").bind(expected.push.id).all()).results.map(row=>({...row})),expected.aggregates,"minute, hourly and daily sums and sample counts survive the native archive");
}
