export function createProofs({db,query,guard,personFence,routeFence,actorFence,findById,issue}) {
  const preview = async (hash,t,kind) => {
    const p=await query("SELECT r.* FROM proofs r JOIN people p ON p.id=r.person_id WHERE hash=? AND kind=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>? AND p.workspace='workspace-a' AND p.status='active' AND p.version=r.version AND p.email=r.email",hash,kind,t).first();
    return p?{kind:p.kind,operatorId:p.person_id,version:p.version,email:p.email,expiresAt:p.expires_at,returnTo:p.return_to}:null;
  };
  return {
    async limits(keys,t,window) {return Promise.all(keys.map(async key=>(await query('INSERT INTO limits(key,count,start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN start<=? THEN 1 ELSE count+1 END,start=CASE WHEN start<=? THEN ? ELSE start END RETURNING count',key,t,t-window,t-window,t).first()).count));},
    async token(r) {const p=await findById(r.operatorId);if(!p||p.version!==r.expectedVersion)return false;const f=personFence(p),route=routeFence(p);
      return (await query(`INSERT INTO proofs(id,hash,kind,person_id,version,email,return_to,expires_at) SELECT ?,?,'magic',?,?,?,?,? WHERE ${f.sql} AND ${route.sql}`,r.id,r.hash,p.id,p.version,p.email,r.returnTo,r.expiresAt,...f.args,...route.args).run()).meta.changes===1;},
    preview:(hash,t)=>preview(hash,t,'magic'),
    async consumeLink({digest,person:p,now:t,returnTo}) {
      const route=routeFence(p);
      return issue(p,'native',returnTo,[guard(route.sql,route.args),
        query("UPDATE proofs SET used_at=? WHERE hash=? AND kind='magic' AND person_id=? AND version=? AND email=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?",t,digest,p.id,p.version,p.email,t),guard('changes()=1')]);
    },
    revokeLink:(id,t)=>query('UPDATE proofs SET revoked_at=? WHERE id=?',t,id).run(),
    stepUpPreview:(hash,t)=>preview(hash,t,'step_up'),
    async stepUpChallenge(r,actor) {const f=actorFence(actor,r.now);
      return (await query(`INSERT INTO proofs(id,hash,kind,person_id,version,email,session_id,action,return_to,expires_at) SELECT ?,?,'step_up',?,?,?,?,?,?,? WHERE ${f.sql}`,r.id,r.hash,actor.operator.id,actor.operator.version,actor.operator.email,actor.id,r.action,r.returnTo,r.expiresAt,...f.args).run()).meta.changes===1;},
    async consumeStepUp(hash,actor,t) {const f=actorFence(actor,t);
      try {const results=await db.batch([guard(f.sql,f.args),
        query("UPDATE proofs SET used_at=? WHERE hash=? AND kind='step_up' AND person_id=? AND version=? AND session_id=? AND email=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>? RETURNING action,return_to AS returnTo",t,hash,actor.operator.id,actor.operator.version,actor.id,actor.operator.email,t),guard('changes()=1'),
        query('UPDATE sessions SET proof_at=?,proof_version=? WHERE id=?',t,actor.operator.version,actor.id),query('DELETE FROM guards')]);return results[1].results[0]??null;}catch{return null;}
    },
    revokeStepUp:(id,t)=>query('UPDATE proofs SET revoked_at=? WHERE id=?',t,id).run(),
    async steppedUp(actor,since,t) {const f=actorFence(actor,t);return !!await query(`SELECT 1 FROM sessions WHERE id=? AND proof_at>=? AND proof_at<=? AND proof_version=? AND ${f.sql}`,actor.id,since,t,actor.operator.version,...f.args).first();},
  };
}
