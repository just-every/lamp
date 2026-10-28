import assert from "node:assert/strict";
/** Only paid/network edges are substituted. Requests come from the real Worker. */
export function metricsProviderEdge(calls) {
  return async request=>{
    const url=new URL(request.url);
    if(url.hostname==="cloudflare-dns.com") {
      assert.equal(request.headers.has("authorization"),false);
      return Response.json({Status:0,Answer:[{type:Number(url.searchParams.get("type")),data:url.searchParams.get("type")==="1"?"93.184.215.14":"2606:4700:4700::1111"}]});
    }
    if(url.hostname==="api.datadoghq.com") {
      assert.equal(request.method,"GET");assert.equal(url.pathname,"/api/v1/query");
      assert.equal(request.headers.get("DD-API-KEY"),"synthetic-lamp-26");assert.equal(request.headers.get("DD-APPLICATION-KEY"),"synthetic-lamp-27");
      assert.equal(url.searchParams.get("query"),"avg:synthetic.metric{*}.fill(null)");
      calls.push("datadog");const at=Number(url.searchParams.get("to"))*1000-60_000;
      return Response.json({status:"ok",series:[{interval:60_000,pointlist:[[at,42],[at-60_000,null]]}]});
    }
    if(url.hostname==="api.newrelic.com") {
      assert.equal(request.method,"POST");assert.equal(url.pathname,"/graphql");assert.equal(request.headers.get("API-Key"),"synthetic-lamp-28");
      const body=await request.json();assert.match(body.query,/^query LampMetric/);assert.equal(body.variables.accountId,123);
      assert.match(body.variables.nrql,/SELECT average\(duration\) \* 1000 AS value FROM Transaction SINCE \d+ UNTIL \d+ TIMESERIES 1 minute/);
      const to=Number(body.variables.nrql.match(/UNTIL (\d+)/)[1]);calls.push("newrelic");
      return Response.json({data:{actor:{account:{nrql:{results:[{beginTimeSeconds:(to-60_000)/1000,endTimeSeconds:to/1000,value:87}]}}}}});
    }
    if(url.hostname==="api.pingdom.com") {
      assert.equal(request.method,"GET");assert.equal(url.pathname,"/api/3.1/results/123");assert.equal(request.headers.get("Authorization"),"Bearer synthetic-lamp-29");
      const at=Number(url.searchParams.get("to"))-60;calls.push("pingdom");
      return Response.json({results:[{time:at+10,status:"up",responsetime:50},{time:at+20,status:"up",responsetime:70},{time:at-60,status:"down",responsetime:0}]});
    }
    if(url.hostname==="synthetic-lamp-30.example.test") {
      assert.equal(request.method,"GET");assert.equal(url.pathname,"/api/v1/query_range");assert.equal(request.headers.get("Authorization"),"Bearer synthetic-lamp-50");
      assert.equal(url.searchParams.get("query"),"avg(synthetic_latency)");assert.equal(url.searchParams.get("step"),"60");assert.equal(url.searchParams.get("lookback_delta"),"60s");
      const at=Number(url.searchParams.get("end"));calls.push("prometheus");
      return Response.json({status:"success",data:{resultType:"matrix",result:[{values:[[at-60,"NaN"],[at,"12.5"]]}]}});
    }
  };
}
