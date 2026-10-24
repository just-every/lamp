import assert from "node:assert/strict";
export async function tenMetricWeightFixture(appFetch) {
  const listed=await appFetch("/api/app/components");assert.equal(listed.status,200);
  const component=(await listed.json()).components.find(row=>!row.internal&&/^[0-9A-HJKMNP-TV-Z]{26}$/.test(row.id));assert.ok(component);
  const minute=Math.floor(Date.now()/60_000)*60_000;
  for(let series=0;series<10;series++) {
    const created=await appFetch("/api/app/metrics",{method:"POST",body:JSON.stringify({componentId:component.id,provider:"push",name:`synthetic-lamp-${101+series}`,unit:"ms"})});assert.equal(created.status,201,await created.clone().text());const metric=(await created.json()).metric;
    const points=Array.from({length:1440},(_,index)=>({at:minute-(1440-index)*60_000,value:Math.round((100+series+25*Math.sin(index/17))*100)/100}));
    const pushed=await appFetch(`/api/app/metrics/${metric.id}/points`,{method:"POST",body:JSON.stringify({points})});assert.equal(pushed.status,200,await pushed.clone().text());
  }
  const excess=await appFetch("/api/app/metrics",{method:"POST",body:JSON.stringify({componentId:component.id,provider:"push",name:"synthetic-lamp-111",unit:"ms"})});
  assert.equal(excess.status,400,"an eleventh metric is refused through the management door");
  assert.equal((await (await appFetch("/api/app/metrics")).json()).metrics.length,10,"capacity refusal creates no definition");
}
