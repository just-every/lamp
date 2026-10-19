import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign, createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { nativeRequest, openNativeRuntime, origin, operator } from '../../dev-ingress/runtime.mjs';
import { appOrigin } from './hosts.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { devKey } from '../../helpers/dev-key.mjs';
import { notificationActivity, assertNoNewNotifications, moveInDoor } from '../../helpers/import-notifications.mjs';

const fixture = (source,family) => readdirSync(`tests/fixtures/${source}/${family}`).map(name=>({name,text:readFileSync(`tests/fixtures/${source}/${family}/${name}`,'utf8')}));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');

// Base ADOPTING.md "Copyable public HTTP conformance" (rer 0.2.61), unchanged.
export async function checkDoor({request, bytes, name, nativeSnapshot,
  assertApplied, assertUndone}) {
  const hash = b => createHash('sha256').update(b).digest('hex');
  const json = async (action, body, review, expected = 200) => {
    const response = await request(action, body, review);
    assert.equal(response.status, expected, `${action}: ${response.status}`);
    return response.json();
  };
  const until = async (action, body, review, state) => {
    for (let batch = 0; batch < 100; batch++) {
      const result = await json(action, body, review);
      if (result.job?.state === state) return result.job;
      assert.ok(['queued','applying','undoing'].includes(result.job?.state));
    }
    assert.fail(`${action} did not finish`);
  };
  assert.ok(bytes.length > 0);
  const before = await nativeSnapshot(), bundleSha256 = hash(bytes);
  const totalChunks = Math.ceil(bytes.length / 65536);
  let uploadId;
  for (let index = 0; index < totalChunks; index++) {
    const chunk = bytes.subarray(index * 65536, (index + 1) * 65536);
    const uploaded = await json('uploads', {uploadId, name, bundleSha256,
      totalBytes:bytes.length, totalChunks, index,
      chunkSha256:hash(chunk), base64:chunk.toString('base64')});
    uploadId = uploaded.uploadId;
  }
  const inventory = await json('uploads', {uploadId});
  assert.equal(inventory.complete, true);
  assert.equal(inventory.bundleSha256, bundleSha256);
  assert.equal(inventory.received.reduce((n,c) => n + c.size, 0), bytes.length);
  const plan = await json('plan', {uploadId});
  assert.equal(plan.bundleSha256, bundleSha256);
  assert.ok(plan.summary.sourceRecords > 0);
  assert.deepEqual(await nativeSnapshot(), before);
  const review = {fingerprint:plan.fingerprint,
    approvalRecordId:randomUUID(), approvedAt:new Date().toISOString()};
  const wrong = (plan.fingerprint[0] === '0' ? '1' : '0') + plan.fingerprint.slice(1);
  await json('apply', {planId:plan.planId, reviewedFingerprint:wrong}, review, 403);
  assert.deepEqual(await nativeSnapshot(), before);
  const job = await until('apply', {planId:plan.planId,
    reviewedFingerprint:plan.fingerprint}, review, 'completed');
  const status = await json('status', {planId:plan.planId});
  assert.equal(status.job.id, job.id);
  assert.equal(status.job.state, 'completed');
  const report = await json('reconcile', {planId:plan.planId});
  assert.equal(report.ok, true);
  assert.equal(report.fingerprint, plan.fingerprint);
  assert.equal(report.bundleSha256, bundleSha256);
  assert.equal(report.counts.sourceRecords, plan.summary.sourceRecords);
  assert.equal(report.counts.present + report.counts.explained, report.counts.sourceRecords);
  assert.equal(report.sourceIds.length, report.counts.sourceRecords);
  await assertApplied(before, await nativeSnapshot(), report);
  await until('undo', {planId:plan.planId}, undefined, 'undone');
  await assertUndone(before, await nativeSnapshot());
}

export async function businessImportDoorFlow({ afterApply, afterSources } = {}) {
  const {privateKey,publicKey} = generateKeyPairSync('ec',{namedCurve:'P-256'});
  const kid='synthetic-business',installationId=randomUUID(),issuer='https://business.example.test';
  const vars={RER_OWNER_CLAIM_PUBLIC_KEYS:JSON.stringify({[kid]:publicKey.export({format:'jwk'})}),RER_OWNER_CLAIM_ISSUER:issuer,RER_OWNER_CLAIM_INSTALLATION_ID:installationId};
  appOrigin(new URL(origin).port,vars);
  const runtime=await openNativeRuntime();
  try {
    await runtime.start(); await runtime.seedOperator();
    const entered=await signInAs({origin,key:devKey});
    const cookie=entered.header;
    const owner=async(path,body,method=body?'POST':'GET',headers)=> {
      const response=await nativeRequest(path,{cookie,method,...(body?{json:body}:{}),...(headers?{headers}:{})});
      return {status:response.status,body:await response.json()};
    };
    const moveIn=moveInDoor((path,body,headers)=>owner(path,body,undefined,headers));
    const grant=(action,namespace,extra={})=> {
      const iat=Math.floor(Date.now()/1000);
      const payload={v:1,iss:issuer,aud:origin,installationId,email:operator,jti:randomUUID(),iat,exp:iat+300,action,namespace,maxBytes:8*1024*1024,maxChunks:128,maxRecords:5000,...extra};
      const input=`${json64({alg:'ES256',typ:'rer-import-grant+jwt',kid})}.${json64(payload)}`;
      return `${input}.${sign('sha256',Buffer.from(input),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')}`;
    };
    const door=async(action,namespace,body,extra={},token=grant(action,namespace,extra))=> {
      const response=await nativeRequest(`/api/rer/import/${action}`,{method:'POST',json:body,headers:{Authorization:`Bearer ${token}`}});
      return {status:response.status,body:await response.json()};
    };
    assert.equal((await door('uploads','statuspage',{})).status,404);
    assert.equal((await nativeRequest('/api/app/import-door/settings',{method:'PUT',json:{enabled:true}})).status,401);
    assert.equal((await owner('/api/app/import-door/settings')).body.enabled,false);
    assert.equal((await owner('/api/app/import-door/settings',{enabled:true},'PUT')).status,200);
    assert.deepEqual(await door('uploads','pagerduty',{}),{status:403,body:{error:'unknown_import_source'}},'only Lamp\'s listed sources have a door namespace');
    assert.deepEqual(await moveIn.door('pagerduty','uploads',{}),{status:400,body:{error:'unknown_import_source'}},'the owner\'s Move in shares that allow-list');
    const counts=async()=> Promise.all(['/api/app/components','/api/app/incidents','/api/app/maintenance','/api/app/subscribers'].map(async path=>{
      const result=await owner(path); assert.equal(result.status,200); return result.body;
    }));
    const before=await counts(),notifications=await notificationActivity(runtime);
    // Base's public conformance through the grant mount, with a fresh action-bound grant per call.
    const small=fixture('statuspage','small'),names=file=>JSON.parse(small.find(f=>f.name===file).text);
    await checkDoor({
      request:(action,body,review)=>nativeRequest(`/api/rer/import/${action}`,{method:'POST',json:body,headers:{Authorization:`Bearer ${grant(action,'statuspage',review??{})}`}}),
      bytes:Buffer.from(JSON.stringify({source:'statuspage',files:small,pageId:'conformance'})),name:'statuspage-conformance.json',
      nativeSnapshot:counts,
      assertApplied:async([components,incidents,,subscribers],[afterComponents,afterIncidents,,afterSubscribers],report)=>{
        assert.deepEqual(afterComponents.components.map(row=>row.name).filter(name=>!components.components.some(row=>row.name===name)).sort(),names('components.json').map(row=>row.name).sort());
        assert.deepEqual(afterIncidents.incidents.map(row=>row.title).filter(title=>!incidents.incidents.some(row=>row.title===title)).sort(),names('incidents.json').map(row=>row.name).sort());
        const added=afterSubscribers.subscribers.filter(row=>!subscribers.subscribers.some(old=>old.id===row.id));
        assert.equal(added.length,names('subscribers.json').length); assert.ok(added.every(row=>row.state==='deactivated'),'held until cutover');
        assert.ok(report.counts.nativeTargets>=names('components.json').length+names('incidents.json').length);
      },
      assertUndone:async(snapshot,after)=>assert.deepEqual(after,snapshot),
    });
    // Every source Move in offers has its door namespace.
    for (const source of ['statuspage','sorry','betterstack','instatus']) {
      const bytes=Buffer.from(JSON.stringify({source,files:fixture(source,source==='sorry'?'authenticated':'small'),...(source==='statuspage'?{}:source==='betterstack'?{publicAccessAcknowledged:true}:{pageId:'synthpage01',publicAccessAcknowledged:true})}));
      let uploadId;
      for(let offset=0,index=0;offset<bytes.length;offset+=65536,index++) {
        const chunk=bytes.subarray(offset,offset+65536);
        const result=await door('uploads',source,{...(uploadId?{uploadId}:{}),name:`${source}-export.json`,bundleSha256:hash(bytes),totalBytes:bytes.length,totalChunks:Math.ceil(bytes.length/65536),index,chunkSha256:hash(chunk),base64:chunk.toString('base64')});
        assert.equal(result.status,200,JSON.stringify(result.body)); uploadId=result.body.uploadId;
      }
      const planned=await door('plan',source,{uploadId}); assert.equal(planned.status,200,JSON.stringify(planned.body));
      assert.deepEqual(await counts(),before,'planning makes no native writes');
      const {planId,fingerprint}=planned.body,approval={fingerprint,approvalRecordId:randomUUID(),approvedAt:new Date().toISOString()};
      assert.equal((await door('apply',source,{planId,reviewedFingerprint:'0'.repeat(64)},approval)).status,403);
      assert.deepEqual(await counts(),before);
      let applied;
      for(let round=0;round<40;round++) {
        applied=await door('apply',source,{planId,reviewedFingerprint:fingerprint},approval);
        assert.equal(applied.status,200,JSON.stringify(applied.body));
        if(applied.body.job.state==='completed') break;
      }
      assert.equal(applied.body.job.state,'completed');
      const reconciled=await door('reconcile',source,{planId});
      assert.equal(reconciled.status,200,JSON.stringify(reconciled.body)); assert.equal(reconciled.body.ok,true);
      assert.ok(reconciled.body.counts.nativeTargets>0);
      const status=await door('status',source,{planId});
      assert.equal(status.body.approval.owner,operator);
      const history=(await owner('/api/app/statuspage-import/jobs')).body.jobs;
      assert.match(history.find(job=>job.id===applied.body.job.id)?.approvalCaption ?? '',new RegExp(`^approved via Business by ${operator} at .+, fingerprint ${fingerprint}$`));
      const read=await owner(`/api/app/statuspage-import/jobs/${applied.body.job.id}`);
      assert.equal(read.status,200,JSON.stringify(read.body)); assert.equal(read.body.report.cutover.afterCutover,true);
      const subscribers=(await owner('/api/app/subscribers')).body.subscribers;
      assert.ok(subscribers.length>0); assert.ok(subscribers.every(row=>row.state==='deactivated'),'held until cutover');
      assert.equal((await owner(`/api/app/statuspage-import/jobs/${applied.body.job.id}/send-invitations`,{})).status,409,'cutover approval is separate');
      await assertNoNewNotifications(runtime,notifications);
      if(process.env.LAMP_IMPORT_DOOR_VISUALS) {
        const {captureImportDoor}=await import('./import-door-visuals.mjs');
        await captureImportDoor({cookies:entered.cookies,source,jobId:applied.body.job.id,origin,directory:process.env.LAMP_IMPORT_DOOR_VISUALS});
      }
      await afterApply?.({ source, runtime, door, owner, planId, applied, cookies: entered.cookies });
      if(source==='sorry') {
        const ownerUndo=await moveIn.undo(history.find(job=>job.id===applied.body.job.id));
        assert.equal(ownerUndo.status,200,JSON.stringify(ownerUndo.body));
        assert.equal(ownerUndo.body.job.state,'undone','ordinary owner history can undo Business imports');
      }
      let undone;
      for(let round=0;round<40;round++) {
        undone=await door('undo',source,{planId}); assert.equal(undone.status,200,JSON.stringify(undone.body));
        if(undone.body.job.state==='undone') break;
      }
      assert.equal(undone.body.job.state,'undone'); assert.deepEqual(await counts(),before);
    }
    await afterSources?.({ runtime, door, owner });
    // The owner's own Move in lands in the same history, approved by the owner,
    // and imports again the very export Business imported and undid.
    const beforeOwn=await counts();
    const own=await moveIn.preview({source:'instatus',files:fixture('instatus','small'),pageId:'synthpage01',publicAccessAcknowledged:true});
    assert.equal(own.status,200,JSON.stringify(own.body));
    const ownImport=await moveIn.apply(own.body);
    assert.equal(ownImport.status,200,JSON.stringify(ownImport.body)); assert.equal(ownImport.body.job.state,'completed');
    const together=(await owner('/api/app/statuspage-import/jobs')).body.jobs;
    assert.match(together.find(job=>job.id===ownImport.body.job.id).approvalCaption,new RegExp(`^approved by ${operator} at .+, fingerprint ${own.body.fingerprint}$`));
    assert.ok(together.some(job=>job.approvalCaption?.startsWith(`approved via Business by ${operator}`)),'Business imports stay in the same history');
    assert.equal((await moveIn.undo(ownImport.body.door)).body.job.state,'undone');
    assert.deepEqual(await counts(),beforeOwn);
    const token=grant('uploads','statuspage');
    assert.equal((await owner('/api/app/import-door/settings',{enabled:true,revokedKids:[kid]},'PUT')).status,200);
    assert.equal((await door('uploads','statuspage',{}, {},token)).status,403);
    assert.equal((await owner('/api/app/import-door/settings',{enabled:false},'PUT')).status,200);
    assert.equal((await door('uploads','statuspage',{})).status,404);
    assert.equal((await owner('/api/app/import-door/settings')).body.keys[0].revoked,true);
    await assertNoNewNotifications(runtime,notifications);
    if(process.env.LAMP_IMPORT_DOOR_VISUALS) {
      const {captureImportDoor}=await import('./import-door-visuals.mjs');
      await captureImportDoor({cookies:entered.cookies,origin,directory:process.env.LAMP_IMPORT_DOOR_VISUALS,revoked:true});
    }
  } finally {await runtime.close();}
}
