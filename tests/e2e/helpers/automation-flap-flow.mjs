import assert from "node:assert/strict";
import { openFollowUpsRuntime } from "./follow-ups-runtime.mjs";

/** One controlled alert journey covers transient failure, held recovery and
 * attributed undo through public and authenticated operator doors. */
export async function automationFlapFlow({ t }) {
  const fixture = await openFollowUpsRuntime({workerEntry:"tests/e2e/helpers/automation-clock-worker.ts"});
  const {api,post,raw,publicOrigin,appOrigin} = fixture;
  const put = (path,body) => api(path,{method:"PUT",body:JSON.stringify(body)});
  let clock = Date.now()+1000;
  const advance = async seconds => {
    clock += seconds*1000;
    assert.equal((await raw(appOrigin+"/test/clock",{method:"PUT",body:JSON.stringify({now:clock})})).status,204);
  };
  const tick = async () => {
    const result=await (await fixture.runtime.getWorker()).scheduled({cron:"* * * * *",scheduledTime:clock});
    assert.equal(result.outcome,"ok");
  };
  const publicState = async id => {
    const response=await raw(publicOrigin+"/api/public/v1/components");
    assert.equal(response.status,200,await response.clone().text());
    return (await response.json()).data.find(row=>row.id===id).state;
  };
  const components = async () => (await api("/api/app/components")).body.components;
  const runs = async () => (await api("/api/app/intake/rule-runs")).body.runs;
  const incident = async id => (await api(`/api/app/incidents/${id}`)).body.incident;
  const history = async id => (await api(`/api/app/components/${id}/history`)).body.history;
  const notifications = async () => (await fixture.db.prepare("SELECT * FROM notification_delivery_records ORDER BY id").all()).results;
  const payload = (key,recovered=false,revision=0) => ({check_id:key,check_name:"Synthetic Lamp flap monitor",current_state:recovered?"UP":"DOWN",previous_state:recovered?"DOWN":"UP",description:"Synthetic Lamp controlled alert",revision});
  const send = async (source,key,recovered=false,revision=0,token=source.token) => {
    const response=await raw(publicOrigin+source.endpointPath,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(payload(key,recovered,revision))});
    return {status:response.status,body:await response.json()};
  };
  const make = async name => {
    const response=await post("/api/app/components",{name,groupId:null,description:"",internal:false,displayOrder:0,note:""});
    assert.equal(response.status,201,response.text);
    const target=response.body.component;
    const made=await post("/api/app/intake/sources",{name,preset:"pingdom",componentId:target.id,credentialKind:"bearer-token"});
    assert.equal(made.status,201,made.text);
    return {target,source:made.body.source};
  };
  try {
    await advance(0);
    const {target,source}=await make("Synthetic Lamp guarded API");
    const rulePath=`/api/app/intake/rules/${source.id}/${target.id}`;
    const saved=await put(rulePath,{name:"Synthetic Lamp default flap guard",mode:"claim",state:"Major outage"});
    assert.equal(saved.status,200,saved.text);
    const rule=saved.body.rule;
    const before=await history(target.id),beforeDeliveries=await notifications();
    assert.equal((await send(source,"short-firing")).status,202);
    await advance(60);
    assert.equal((await send(source,"short-firing",true)).status,202);
    await advance(180);await tick();
    assert.equal(await publicState(target.id),"Operational","a 60-second firing is never made public after recovery");
    assert.deepEqual(await history(target.id),before,"a canceled firing adds no public state history");
    assert.equal((await runs()).filter(run=>run.ruleId===rule.id).length,0);
    assert.deepEqual(await notifications(),beforeDeliveries);

    assert.equal((await send(source,"sustained-firing")).status,202);
    await advance(119);await tick();
    assert.equal(await publicState(target.id),"Operational","the default firing delay has not elapsed");
    await advance(61);await tick();
    assert.equal(await publicState(target.id),"Major outage","a three-minute firing is publicly claimed");
    const run=(await runs()).find(row=>row.ruleId===rule.id&&!row.releasedAt);
    assert.ok(run);
    const claimedHistory=await history(target.id);
    assert.equal((await send(source,"sustained-firing",true)).status,202);
    await advance(120);
    assert.equal((await send(source,"sustained-firing",false,1)).status,202);
    await advance(181);await tick();
    assert.equal(await publicState(target.id),"Major outage","refiring two minutes into the five-minute recovery hold retains the claim");
    assert.deepEqual(await history(target.id),claimedHistory,"a recovered then refiring alert does not flap public history");
    assert.equal((await runs()).filter(row=>row.ruleId===rule.id).length,1,"refiring retains the same automatic incident");
    assert.equal((await send(source,"sustained-firing",true,2)).status,202);
    await advance(299);await tick();
    assert.equal(await publicState(target.id),"Major outage");
    await advance(1);await tick();
    assert.equal(await publicState(target.id),"Operational","a complete recovery hold releases the claim");
    assert.deepEqual(await notifications(),beforeDeliveries,"claim-only delay and hold remain silent");

    const template=await post("/api/app/incident-templates",{name:"Synthetic Lamp undo template",lifecycle:"Investigating",affectedAudience:"Synthetic Lamp API customers",customerImpact:"Synthetic Lamp API requests are delayed.",whatStillWorks:"Existing connections remain available.",details:"Recovery is being checked.",nextUpdateOffsetMinutes:60,components:[{componentId:target.id,state:"Major outage",relationship:"Primary"}],channels:[],resolvedUpdate:{affectedAudience:"Synthetic Lamp API customers",customerImpact:"Synthetic Lamp API requests have recovered.",whatStillWorks:"All services are available.",details:"Checks passed."}});
    assert.equal(template.status,201,template.text);
    await fixture.signIn(undefined,{fresh:true});
    const responderEmail=["synthetic-lamp-guard-responder","example.test"].join("@");
    assert.equal((await post("/api/app/operators/invite",{email:responderEmail,displayName:"Synthetic Lamp guarded responder"})).status,202);
    await fixture.signIn(responderEmail);
    const responder=(await api("/api/app/session")).body.operator;
    await fixture.signIn();
    assert.equal((await post(`/api/app/operators/${responder.id}/role`,{role:"responder"})).status,200);
    for(const mode of ["claim","claim-and-publish"]) {
      await advance(1);
      const configured=await put(rulePath,{name:`Synthetic Lamp undo ${mode}`,mode,state:"Major outage",templateId:mode==="claim-and-publish"?template.body.template.id:null,firingDelaySeconds:0,recoveryHoldSeconds:300});
      assert.equal(configured.status,200,configured.text);
      const key=`undo-${mode}`;
      const firing=await send(source,key);
      assert.equal(firing.status,202,JSON.stringify(firing.body));
      assert.equal(await publicState(target.id),"Major outage");
      const active=(await runs()).find(row=>row.ruleId===rule.id&&!row.releasedAt);
      const priorIncident=await incident(active.incidentId),priorHistory=await history(target.id);
      assert.equal(priorIncident.updates.length,mode==="claim-and-publish"?1:0);
      const path=`/api/app/intake/rule-runs/${active.id}/undo`;
      const refused=await raw(appOrigin+path,{method:"POST",headers:{Origin:appOrigin,"Content-Type":"application/json"},body:"{}"});
      assert.equal(refused.status,401);
      assert.deepEqual(await incident(active.incidentId),priorIncident,"anonymous Undo changes nothing");
      assert.deepEqual(await history(target.id),priorHistory);
      await fixture.signIn(responderEmail,{fresh:true});
      assert.equal((await post(path)).status,403,"a responder cannot undo owner-approved automatic publication or claims");
      assert.equal((await put(rulePath,{name:"Denied rule edit",mode:"claim",state:"Operational"})).status,403);
      await fixture.signIn();
      assert.deepEqual(await incident(active.incidentId),priorIncident,"role refusals preserve the complete incident");
      assert.deepEqual(await history(target.id),priorHistory);
      await advance(1);
      const undone=await post(path);
      assert.equal(undone.status,200,undone.text);
      assert.equal(await publicState(target.id),"Operational","one Undo restores the previous aggregate state");
      const restored=await incident(active.incidentId),restoredHistory=await history(target.id);
      assert.deepEqual(restored.updates,priorIncident.updates,"Undo never removes or rewrites earlier publications");
      assert.equal(restoredHistory.length,priorHistory.length+1);
      for(const entry of priorHistory)assert.ok(restoredHistory.some(row=>row.id===entry.id),"prior component history remains");
      const transition=restoredHistory.find(row=>!priorHistory.some(old=>old.id===row.id));
      assert.equal(transition.newState,"Operational");assert.ok(transition.operatorId);
      const note=restored.internalNotes.find(row=>!priorIncident.internalNotes.some(old=>old.id===row.id));
      assert.match(note.body,/undone/i);assert.equal(note.authorOperatorId,transition.operatorId);
      for(const entry of priorIncident.internalNotes)assert.ok(restored.internalNotes.some(row=>row.id===entry.id));
      assert.equal((await post(path)).status,409,"Undo cannot append a second reversal");
      assert.equal((await send(source,key,false,3)).status,202);
      await advance(360);await tick();
      assert.equal(await publicState(target.id),"Operational","captured firing and scheduled replay cannot reverse an Undo");
      assert.deepEqual((await incident(active.incidentId)).updates,priorIncident.updates);
      assert.equal((await send(source,key,true,4)).status,202);
    }
    const pending=await make("Synthetic Lamp erased guard");
    assert.equal((await put(`/api/app/intake/rules/${pending.source.id}/${pending.target.id}`,{name:"Synthetic Lamp erased pending rule",mode:"claim",state:"Major outage"})).status,200);
    assert.equal((await send(pending.source,"erased-pending")).status,202);
    assert.equal((await api(`/api/app/intake/sources/${pending.source.id}`,{method:"DELETE"})).status,200);
    await advance(180);await tick();
    assert.equal((await send(pending.source,"erased-pending",false,5)).status,404);
    assert.equal(await publicState(pending.target.id),"Operational","erased source authority cannot be resurrected by a due timer or captured request");
    assert.ok((await components()).some(row=>row.id===pending.target.id));
    await fixture.signIn(undefined,{fresh:true});
    assert.equal((await post(`/api/app/operators/${responder.id}/role`,{role:"owner"})).status,200);
    const revoked=await make("Synthetic Lamp revoked approval");
    await fixture.signIn(responderEmail,{fresh:true});
    const revokedPath=`/api/app/intake/rules/${revoked.source.id}/${revoked.target.id}`;
    assert.equal((await put(revokedPath,{name:"Synthetic Lamp approval to revoke",mode:"claim",state:"Major outage"})).status,200);
    assert.equal((await send(revoked.source,"revoked-approval")).status,202);
    await fixture.signIn();
    assert.equal((await post(`/api/app/operators/${responder.id}/revoke-access`)).status,204);
    await advance(180);await tick();
    assert.equal(await publicState(revoked.target.id),"Operational","revoking the approving operator blocks a pending automatic claim");
    const held=(await api("/api/app/intake/rules")).body.rules.find(row=>row.sourceId===revoked.source.id);
    assert.match(held.degradationReason,/authority/);
    await fixture.signIn(responderEmail);
    assert.equal((await put(revokedPath,{name:"Captured unauthorized change",mode:"claim",state:"Major outage",firingDelaySeconds:0})).status,401,"revoked session cannot renew its automation approval");
    await fixture.signIn();
    assert.equal((await api(`/api/app/operators/${responder.id}`,{method:"DELETE"})).status,204);
    assert.equal((await send(revoked.source,"revoked-approval",false,6)).status,202);
    await advance(180);await tick();
    assert.equal(await publicState(revoked.target.id),"Operational","erasure and captured alert replay cannot restore an erased approver's authority");
    assert.equal((await api("/api/app/intake/rules")).body.rules.find(row=>row.sourceId===revoked.source.id).approvedByName,"Erased operator");
    t.diagnostic("AUTO-002: controlled 60-second firing, three-minute firing, two-minute refire during five-minute hold, full recovery, silent claim, attributed claim and publication Undo, replay refusal and pending-source erasure pass.");
  } finally { await fixture.close(); }
}
