import assert from "node:assert/strict";
import { openSubscriberManagementFixture } from "./subscriber-management-fixture.mjs";

/** Real migrated Worker, native token issuance and incident subscriber doors;
 * only the fixture's outbound email provider is replaced. */
export async function incidentSubscriptionApiFlow() {
  const address=name=>["synthetic-lamp-"+name,"example.test"].join("@");
  const fixture=await openSubscriberManagementFixture();
  const {post,api,raw,appOrigin,db,messages}=fixture;
  try {
    const component=await post("/api/app/components",{name:"Incident API",groupId:null,description:"",internal:false,displayOrder:0,note:""});
    assert.equal(component.status,201,component.text);
    const {incident}=await fixture.publish(component.body.component,"Follow this incident");
    const {incident:other}=await fixture.publish(component.body.component,"Another incident");
    const mint=async scopes=>{
      const result=await post("/api/app/management-tokens",{name:"Incident subscriber integration",scopes,expiresInSeconds:3600});
      assert.equal(result.status,201,result.text);return result.body;
    };
    const writer=await mint(["subscribers:write"]),reader=await mint(["subscribers:read"]),publicReader=await mint(["read"]),unscoped=await mint([]);
    const path=`/api/v1/incidents/${incident.id}/subscribers`,compat=`/v1/pages/default/incidents/${incident.id}/subscribers`;
    const call=(path,token,method="GET",body,oauth=false)=>raw(appOrigin+path,{method,headers:{Authorization:`${oauth?"OAuth":"Bearer"} ${token}`,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const state=async()=>({subscribers:(await db.prepare("SELECT * FROM subscribers ORDER BY id").all()).results,incident:(await db.prepare("SELECT * FROM incident_subscriptions ORDER BY subscriber_id").all()).results,tokens:(await api("/api/app/management-tokens")).body.tokens,audit:(await db.prepare("SELECT * FROM audit_entries ORDER BY id").all()).results,messages:messages.length});
    assert.equal((await call("/api/v1/components",publicReader.token)).status,200,"existing public read tokens retain public component access");
    const before=await state();
    assert.equal((await call(path,publicReader.token)).status,403,"an existing public-data read scope does not expose subscriber addresses");
    assert.equal((await call("/api/v1/components",reader.token)).status,403,"a subscriber reader gains no unrelated read permission");
    assert.equal((await call(path,reader.token,"POST",{channel:"email",email:address("denied")})).status,403);
    assert.equal((await call(compat,unscoped.token,"POST",{subscriber:{email:address("denied")}},true)).status,403);
    assert.equal((await call(path,writer.token)).status,403,"write scope does not grant address listing");
    assert.deepEqual(await state(),before,"scope refusals change no subscriber, audit, usage or outbound mail");
    const created=await call(path,writer.token,"POST",{channel:"email",email:address("native-incident"),includeReport:false});
    assert.equal(created.status,201,await created.clone().text());
    const native=await created.json();
    const listed=await call(path,reader.token);
    assert.equal(listed.status,200);assert.equal(listed.headers.get("cache-control"),"no-store");
    const rows=(await listed.json()).subscribers;
    assert.ok(rows.some(row=>row.id===native.subscriberId&&row.destination===address("native-incident")&&row.state==="pending"&&row.incident.includeReport===false));
    const compatibilityCreated=await call(compat,writer.token,"POST",{subscriber:{email:address("compat-incident"),mode:"email"}},true);
    assert.equal(compatibilityCreated.status,201,await compatibilityCreated.clone().text());
    const compatible=await compatibilityCreated.json();
    const compatibilityList=await call(compat,reader.token,"GET",undefined,true);
    assert.equal(compatibilityList.status,200);
    assert.ok((await compatibilityList.json()).some(row=>row.id===compatible.id&&row.email===address("compat-incident")&&row.pending));
    const beforeWrongIncident=await state();
    assert.equal((await call(`/api/v1/incidents/${other.id}/subscribers/${native.subscriberId}`,writer.token,"DELETE")).status,404);
    assert.deepEqual(await state(),beforeWrongIncident,"an incident cannot delete another incident's follower");
    assert.equal((await call(`${compat}/${compatible.id}`,writer.token,"DELETE",undefined,true)).status,204);
    assert.equal((await call(`${path}/${native.subscriberId}`,writer.token,"DELETE")).status,204);
    const emptied=await call(path,reader.token);assert.deepEqual((await emptied.json()).subscribers,[]);
    const erasedState=await state();
    assert.ok(!JSON.stringify(erasedState).includes(address("native-incident")),"deletion retains no native subscriber address in product records");
    const captured=messages.find(message=>message.to.includes(address("native-incident"))&&message.text.includes("/confirm-subscription/"));
    assert.ok(captured,"the journey captured a real issued confirmation before erasure");
    const capturedLinks=[...captured.text.matchAll(/https?:\/\/\S+\/(?:confirm-subscription|manage)\/\S+/g)].map(match=>match[0]);
    assert.ok(capturedLinks.length>=2);
    for(const link of capturedLinks)assert.equal((await raw(link)).status,404,"erasure revokes captured confirmation and management authority");
    assert.deepEqual(await state(),erasedState,"replaying captured authority cannot resurrect an erased incident follower");
    assert.equal((await post(`/api/app/management-tokens/${writer.credential.id}/revoke`,{})).status,200);
    const revoked=await state();
    assert.equal((await call(compat,writer.token,"POST",{subscriber:{email:address("revoked")}},true)).status,401);
    assert.equal((await call(`${path}/${native.subscriberId}`,writer.token,"DELETE")).status,401);
    assert.deepEqual(await state(),revoked,"revoked tokens change no records, usage or outgoing mail");
  } finally {await fixture.close();}
}
