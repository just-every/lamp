import assert from 'node:assert/strict';

/** Role changes use the app door; signed chat retains no old publish authority. */
export async function chatRoleFlow({r,slack,teams,update}) {
  const component=(await r.call('/api/app/components',{groupId:null,name:'Synthetic Lamp chat roles',description:'',internal:false,displayOrder:50,note:''})).body.component;
  const target=await r.db.prepare("SELECT id,email FROM oa_operators WHERE id<>? AND status='active' AND role='owner'").bind(r.operator).first();
  const credential=await r.signIn(target.email);
  for(const send of [slack,teams]) {
    const code=(await r.call('/api/app/chat-links',{},'POST',credential)).body.code;
    assert.equal((await send(null,{code})).status,200);
  }
  const open=await slack({action:'open',title:'Synthetic Lamp role replay',components:[{componentId:component.id,state:'Major outage',relationship:'Primary'}],update:update()});
  assert.equal(open.status,200);
  const {incidentId,version}=open.body.result;
  const preview=await slack({action:'preview',incidentId,version});
  assert.equal(preview.status,200);
  const captured=preview.body.result.publish;
  const change=async role=> {
    const response=await r.call(`/api/app/operators/${target.id}/role`,{role},'POST');
    assert.equal(response.status,200,JSON.stringify(response.body));
  };
  const snapshot=async()=>Promise.all(['incidents','incident_drafts','incident_updates'].map(async table=>(await r.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results));
  await change('responder');
  const before=await snapshot();
  for(const [name,send] of [['slack',slack],['teams',teams]]) {
    assert.equal((await send(captured)).status,403,`${name}: Responder cannot publish a previously previewed draft`);
    assert.deepEqual(await snapshot(),before);
    const audit=await r.db.prepare("SELECT operator_id,entity_id,created_at FROM audit_entries WHERE action='access-denied' AND entity_id=? ORDER BY id DESC LIMIT 1").bind(`/api/chat/${name}`).first();
    assert.equal(audit.operator_id,target.id);assert.ok(Number.isFinite(Date.parse(audit.created_at)));
  }
  await change('viewer');
  assert.equal((await teams({action:'open',title:'Synthetic Lamp forbidden draft',components:[{componentId:component.id,state:'Major outage',relationship:'Primary'}],update:update()})).status,403);
  assert.deepEqual(await snapshot(),before,'Viewer chat cannot open a draft');
  await change('communicator');
  assert.equal((await slack(captured)).status,409,'a captured preview stays retired after publication rights return');
  assert.deepEqual(await snapshot(),before);
  const saved=await slack({action:'save',incidentId,version,update:update()});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  const fresh=await slack({action:'preview',incidentId,version:saved.body.result.version});
  assert.equal(fresh.status,200,JSON.stringify(fresh.body));
  const published=await slack(fresh.body.result.publish);
  assert.equal(published.status,200,JSON.stringify(published.body));
  assert.equal((await r.db.prepare('SELECT COUNT(*) n FROM incident_updates WHERE incident_id=?').bind(incidentId).first()).n,1);
}
