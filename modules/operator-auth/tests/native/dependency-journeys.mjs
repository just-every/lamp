import assert from 'node:assert/strict';

const post=(r,path,input={},cookie)=>r.call(path,{method:'POST',input,cookie});
export async function approveLink(r,issuer,cookie) {
  const result=await post(r,'/auth/dependencies/relink',{issuer},cookie);
  assert.equal(result.status,200,await result.clone().text());
}
export async function rawLink(r,issuer) {
  assert.equal((await r.call('/.well-known/rer-dependencies')).status,200);
  assert.equal((await r.call('/.well-known/rer-link/jwks/oidc-provider@1')).status,200);
  const grant=await post(r,'/__fake/link-code');assert.equal(grant.status,200);
  return post(r,'/.well-known/rer-link/callback',{issuer,code:(await grant.json()).code});
}
const tables=['rer_dependency_link','rer_dependency_keys','rer_dependency_pending','oa_identity_providers','settings','audit'];
async function snapshot(r) {
  return Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await r.db.prepare(`SELECT * FROM ${table}`).all()).results])));
}

// Public owner approval and callback, real native authority and D1 transactions;
// only the provider's network response is paused for concurrent owner actions.
export async function nativeApprovalJourney(r,issuer,cookie,ownerRole) {
  await r.db.prepare('UPDATE settings SET idp_sign_in=0,first_setup=1').run();
  await approveLink(r,issuer,cookie);
  assert.equal((await rawLink(r,issuer)).status,200);
  assert.deepEqual(await r.db.prepare('SELECT idp_sign_in,first_setup FROM settings').first(),{idp_sign_in:0,first_setup:0},'ordinary approval never enables a stale setup flag');
  assert.equal((await post(r,'/auth/oidc/auth/start')).status,403);
  assert.equal((await post(r,'/auth/settings/identity',{idpSignIn:true},cookie)).status,200);

  const actor=await (await r.call('/auth/session',{cookie})).json();
  const person=await r.db.prepare('SELECT * FROM people WHERE id=?').bind(actor.operator.id).first();
  const session=await r.db.prepare('SELECT * FROM sessions WHERE id=?').bind(actor.id).first();
  const changes={
    'owner role':()=>r.db.prepare("UPDATE people SET role='contact' WHERE id=?").bind(person.id).run(),
    'owner tenant':()=>r.db.prepare("UPDATE people SET workspace='workspace-b' WHERE id=?").bind(person.id).run(),
    'owner version':()=>r.db.prepare('UPDATE people SET version=version+1 WHERE id=?').bind(person.id).run(),
    'owner inactive':()=>r.db.prepare("UPDATE people SET status='inactive' WHERE id=?").bind(person.id).run(),
    'session expiry':()=>r.db.prepare('UPDATE sessions SET expires_at=? WHERE id=?').bind(Date.now()-1,actor.id).run(),
    'session revocation':()=>post(r,'/auth/signout',{},cookie),
    'email proof expiry':()=>r.db.prepare('UPDATE sessions SET proof_at=? WHERE id=?').bind(Date.now()-600001,actor.id).run(),
    'approval expiry':()=>r.db.prepare('UPDATE rer_dependency_pending SET expires_at=?').bind(Date.now()-1).run(),
    'approval issuer':()=>r.db.prepare("UPDATE rer_dependency_pending SET issuer='https://another.example'").run(),
    'approval callbacks':()=>r.db.prepare("UPDATE rer_dependency_pending SET callbacks='[]'").run(),
  };
  for(const timing of ['before callback','during redemption'])for(const [name,change] of Object.entries(changes)) {
    await approveLink(r,issuer,cookie);
    let pending;
    if(timing==='during redemption') {
      await post(r,'/__fake/link-pause');pending=rawLink(r,issuer);
      await post(r,'/__fake/link-ready');
    }
    let before;
    try {await change();before=await snapshot(r);}finally{if(pending)await post(r,'/__fake/link-release');}
    const result=await (pending??rawLink(r,issuer));
    assert.equal(result.status,timing==='before callback'?403:503,`${ownerRole}: ${name} ${timing}`);
    assert.deepEqual(await snapshot(r),before,`${name} preserves link, key, approval, pin, policy and audit`);
    await r.db.batch([
      r.db.prepare('UPDATE people SET role=?,workspace=?,version=?,status=? WHERE id=?').bind(person.role,person.workspace,person.version,person.status,person.id),
      r.db.prepare('UPDATE sessions SET expires_at=?,revoked_at=?,proof_at=? WHERE id=?').bind(session.expires_at,session.revoked_at,session.proof_at,session.id),
    ]);
  }

  // The native contribution deliberately knows no pending-attempt SQL. Shared
  // fencing must protect both ordinary replacement and the captured actor tuple.
  for(const replacement of ['fresh approval','approval actor','approval session','approval version']) {
    await approveLink(r,issuer,cookie);
    const original=await r.db.prepare('SELECT * FROM rer_dependency_pending').first();
    await post(r,'/__fake/link-pause');const pending=rawLink(r,issuer);await post(r,'/__fake/link-ready');
    let before;
    try {
      if(replacement==='fresh approval') {
        await approveLink(r,issuer,cookie);
        assert.notEqual((await r.db.prepare('SELECT attempt_id FROM rer_dependency_pending').first()).attempt_id,original.attempt_id);
      } else {
        const field={'approval actor':'approved_by','approval session':'approved_session','approval version':'approved_version'}[replacement];
        await r.db.prepare(`UPDATE rer_dependency_pending SET ${field}=?`).bind(field==='approved_version'?original.approved_version+1:'replacement').run();
      }
      before=await snapshot(r);
    }finally{await post(r,'/__fake/link-release');}
    assert.equal((await pending).status,503,replacement+' invalidates the in-flight callback');
    assert.deepEqual(await snapshot(r),before,'replacement approval and all authority survive refusal');
    if(replacement==='fresh approval')assert.equal((await rawLink(r,issuer)).status,200,'the replacement authorizes only its own fresh callback');
  }
}

export async function providerApprovalJourney(r,issuer,cookie) {
  assert.equal((await r.stepUp(cookie,'providers:relink')).status,303);
  const actor=await (await r.call('/auth/session',{cookie})).json();
  const session=await r.db.prepare('SELECT * FROM sessions WHERE id=?').bind(actor.id).first();
  const settings=await r.db.prepare('SELECT * FROM settings').first();
  const pin=await r.db.prepare("SELECT * FROM oa_identity_providers WHERE provider_id='auth'").first();
  const changes={
    'disabled identity':()=>r.db.prepare('UPDATE settings SET idp_sign_in=0').run(),
    'stale policy generation':()=>r.db.prepare('UPDATE settings SET generation=generation+1').run(),
    'changed provider pin':()=>r.db.prepare("UPDATE oa_identity_providers SET linked_at=linked_at+1 WHERE provider_id='auth'").run(),
    'unlinked provider pin':()=>r.db.prepare("UPDATE oa_identity_providers SET status='unlinked' WHERE provider_id='auth'").run(),
    'provider session older than 24h':()=>r.db.prepare('UPDATE sessions SET created_at=? WHERE id=?').bind(Date.now()-86400001,actor.id).run(),
  };
  for(const [name,change] of Object.entries(changes)) {
    await approveLink(r,issuer,cookie);
    await post(r,'/__fake/link-pause');const pending=rawLink(r,issuer);await post(r,'/__fake/link-ready');
    let before;
    try {await change();before=await snapshot(r);}finally{await post(r,'/__fake/link-release');}
    assert.equal((await pending).status,503,name+' defeats callback commit');
    assert.deepEqual(await snapshot(r),before,name+' leaves authority unchanged');
    assert.equal((await rawLink(r,issuer)).status,403,name+' also defeats callback preflight');
    await r.db.batch([
      r.db.prepare('UPDATE settings SET idp_sign_in=?,generation=?').bind(settings.idp_sign_in,settings.generation),
      r.db.prepare("UPDATE oa_identity_providers SET linked_at=?,status=? WHERE provider_id='auth'").bind(pin.linked_at,pin.status),
      r.db.prepare('UPDATE sessions SET created_at=? WHERE id=?').bind(session.created_at,session.id),
    ]);
  }
}
