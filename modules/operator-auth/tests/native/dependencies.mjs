// Native transaction contribution to the shared dependency protocol.
export function dependencyAuthority({db,query,guard,actorFence,currentOwnerFence,now,accounts}) {
  function ownerFence(actor,t) {const f=actorFence(actor,t),o=currentOwnerFence(actor);return {sql:`${f.sql} AND ${o.sql} AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND proof_at>=? AND proof_at<=? AND proof_version=?)`,args:[...f.args,...o.args,actor.id,t-600000,t,actor.operator.version]};}
  return {
    async unclaimed() {return !await accounts.owner();},
    ownerFence,
    approvalFence({pending,now:t}) {
      return ownerFence({id:pending.approved_session,operator:{id:pending.approved_by,version:pending.approved_version}},t);
    },
    linkedStatements({contract,old,issuer,now:t}) {
      if(contract!=='oidc-provider@1')return [];
      return [query('UPDATE settings SET first_setup=0,generation=generation+1 WHERE id=1'),
        query("INSERT INTO audit VALUES('provider:link',NULL,?,?)",issuer,t),
        ...(old?[query("UPDATE sessions SET revoked_at=? WHERE kind='oidc' AND (provider='auth' OR issuer=?)",t,old.issuer),...(old.issuer!==issuer?[query("DELETE FROM domains WHERE provider='auth'")]:[])]:[])];
    },
    unlinkStatements({contract,actor,now:t}) {return [query("INSERT INTO audit VALUES('provider:unlink',?,?,?)",actor.operator.id,contract,t),
      ...(contract==='oidc-provider@1'?[query("UPDATE sessions SET revoked_at=? WHERE kind='oidc' AND provider='auth'",t),query("DELETE FROM domains WHERE provider='auth'"),query('UPDATE settings SET generation=generation+1 WHERE id=1')]:[])];},
    async consumeLogout({claims:c,link,now:t,fence}) {
      const rows=c.sid?(await query("SELECT DISTINCT s.subject,p.id FROM sessions s JOIN people p ON p.id=s.person_id WHERE issuer=? AND sid=? AND p.workspace='workspace-a'",c.iss,c.sid).all()).results:[];
      if(c.sid && (rows.length!==1 || c.sub && rows[0].subject!==c.sub))return false;
      const subject=c.sub??rows[0]?.subject;
      const person=await query("SELECT p.id,b.subject FROM bindings b JOIN people p ON p.id=b.person_id WHERE b.issuer=? AND b.subject=? AND p.workspace='workspace-a'",c.iss,subject).first();
      if(!person)return false;
      try {await db.batch([
        guard("EXISTS(SELECT 1 FROM rer_dependency_link WHERE interface='oidc-provider@1' AND issuer=? AND client_id=? AND metadata=? AND linked_at=? AND needs_relink=0)",[link.issuer,link.client_id,JSON.stringify(link.metadata),link.linked_at]),
        guard('EXISTS(SELECT 1 FROM bindings WHERE issuer=? AND subject=? AND person_id=?)',[c.iss,person.subject,person.id]),
        query('INSERT INTO logouts VALUES(?,?)',c.iss,c.jti),
        ...(fence?[query('UPDATE people SET version=version+1 WHERE id=?',person.id)]:[]),
        query('UPDATE sessions SET revoked_at=? WHERE issuer=? AND subject=? AND (? IS NULL OR sid=?)',t,c.iss,person.subject,c.sid??null,c.sid??null),query('DELETE FROM guards'),
      ]);return true;}catch{return false;}
    },
  };
}
