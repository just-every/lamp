import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign, createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { nativeRequest, openNativeRuntime, origin, operator } from '../../dev-ingress/runtime.mjs';
import { appOrigin } from './hosts.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { devKey } from '../../helpers/dev-key.mjs';
import { notificationActivity, assertNoNewNotifications } from '../../helpers/import-notifications.mjs';

const fixture = (source,family) => readdirSync(`tests/fixtures/${source}/${family}`).map(name=>({name,text:readFileSync(`tests/fixtures/${source}/${family}/${name}`,'utf8')}));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');

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
    const owner=async(path,body,method=body?'POST':'GET')=> {
      const response=await nativeRequest(path,{cookie,method,...(body?{json:body}:{})});
      return {status:response.status,body:await response.json()};
    };
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
    const counts=async()=> Promise.all(['/api/app/components','/api/app/incidents','/api/app/maintenance','/api/app/subscribers'].map(async path=>{
      const result=await owner(path); assert.equal(result.status,200); return result.body;
    }));
    const before=await counts(),notifications=await notificationActivity(runtime);
    for (const source of ['statuspage','sorry']) {
      const bytes=Buffer.from(JSON.stringify({source,files:fixture(source,source==='sorry'?'authenticated':'small'),...(source==='sorry'?{pageId:'synthpage01',publicAccessAcknowledged:true}:{})}));
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
      assert.ok(history.find(job=>job.id===applied.body.job.id)?.approvalCaption.includes(fingerprint));
      const read=await owner(`/api/app/statuspage-import/jobs/${applied.body.job.id}`);
      assert.equal(read.status,200,JSON.stringify(read.body)); assert.equal(read.body.report.cutover.afterCutover,true);
      const subscribers=(await owner('/api/app/subscribers')).body.subscribers;
      assert.ok(subscribers.length>0); assert.ok(subscribers.every(row=>row.state==='deactivated'));
      assert.equal((await owner(`/api/app/statuspage-import/jobs/${applied.body.job.id}/send-invitations`,{})).status,409,'cutover approval is separate');
      await assertNoNewNotifications(runtime,notifications);
      if(process.env.LAMP_IMPORT_DOOR_VISUALS) {
        const {captureImportDoor}=await import('./import-door-visuals.mjs');
        await captureImportDoor({cookies:entered.cookies,source,jobId:applied.body.job.id,origin,directory:process.env.LAMP_IMPORT_DOOR_VISUALS});
      }
      await afterApply?.({ source, runtime, door, owner, planId, applied, cookies: entered.cookies });
      if(source==='sorry') {
        let ownerUndo;
        do {
          ownerUndo=await owner(`/api/app/statuspage-import/jobs/${applied.body.job.id}/undo`,{});
          assert.equal(ownerUndo.status,200,JSON.stringify(ownerUndo.body));
        } while(ownerUndo.body.job.state==='undoing');
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
