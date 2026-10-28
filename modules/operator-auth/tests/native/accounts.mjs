// A minimal adopter fixture. Its D1 tables/cookies/roles are genuinely native;
// fake data is confined to this suite. The production module owns identity.
import { hashToken, opaqueToken } from '../../crypto.mjs';
import { safeReturnTo } from '../../policy.mjs';
import { providerPinFence } from '../../accounts/provider-pin.mjs';
import { createProofs } from './proofs.mjs';
import { dependencyAuthority } from './dependencies.mjs';
export const WORKSPACE = 'workspace-a';
const SECRET = ['fixture', 'native', 'session', 'secret', '32', 'bytes'].join('-');
export function fixture(db, now, config = {}) {
  const query = (sql, ...args) => db.prepare(sql).bind(...args);
  const ownerRole=config.ownerRole??'owner';
  const ownerSelection="FROM people WHERE workspace=? AND role=? AND status='active' ORDER BY id LIMIT 1";
  const currentOwnerFence = actor => ({sql:`?=(SELECT id ${ownerSelection})`,args:[actor.operator.id,WORKSPACE,ownerRole]});
  const personOf = p => p ? {id:p.id,email:p.email,role:p.role,status:p.status,version:p.version,owner:p.role===ownerRole,displayName:p.id,createdAt:p.created_at} : null;
  const findById = async id => personOf(await query('SELECT * FROM people WHERE id=? AND workspace=?',id,WORKSPACE).first());
  const guard = (sql, args=[]) => query(`INSERT INTO guards(value) VALUES(CASE WHEN ${sql} THEN 1 ELSE 0 END)`,...args);
  const personFence = p => ({sql:"EXISTS(SELECT 1 FROM people WHERE id=? AND workspace=? AND email=? AND version=? AND status='active')",args:[p.id,WORKSPACE,p.email,p.version]});
  const routeFence = p => ({sql:"(?=1 OR NOT EXISTS(SELECT 1 FROM domains WHERE domain=?))",args:[Number(p.owner),p.email.split('@')[1]]});
  const actorFence = (actor,t) => ({sql:"EXISTS(SELECT 1 FROM sessions s JOIN people p ON p.id=s.person_id WHERE s.id=? AND p.id=? AND p.workspace=? AND p.version=? AND s.version=p.version AND p.status='active' AND s.revoked_at IS NULL AND s.expires_at>? AND (s.kind!='oidc' OR (s.created_at+86400000>? AND EXISTS(SELECT 1 FROM settings WHERE id=1 AND idp_sign_in=1 AND generation=s.generation) AND (s.provider IS NULL OR EXISTS(SELECT 1 FROM oa_identity_providers ip WHERE ip.provider_id=s.provider AND ip.issuer=s.issuer AND ip.linked_at=s.linked_at AND ip.status='linked')) AND EXISTS(SELECT 1 FROM bindings b WHERE b.issuer=s.issuer AND b.subject=s.subject AND b.person_id=p.id))))",args:[actor.id,actor.operator.id,WORKSPACE,actor.operator.version,t,t]});
  const cookie = (token,age) => `native_staff=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
  const read = request => (request.headers.get('cookie')??'').split(';').map(v=>v.trim()).find(v=>v.startsWith('native_staff='))?.slice(13);
  async function issue(p,kind,returnTo,statements=[],principal) {
    const t=now(),id=crypto.randomUUID(),token=opaqueToken(),expiresAt=t+(kind==='review'?3600000:kind==='oidc'?86400000:604800000);
    const f=personFence(p);
    try { await db.batch([guard(f.sql,f.args),...statements,
      query('INSERT INTO sessions(id,person_id,token_hash,version,kind,created_at,expires_at,issuer,subject,sid,provider,linked_at,generation,proof_at,proof_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,p.id,await hashToken(SECRET,'session',token),p.version,kind,t,expiresAt,principal?.issuer??null,principal?.subject??null,principal?.sid??null,principal?.providerPin?.id??null,principal?.providerPin?.linkedAt??null,principal?.providerGeneration??null,kind==='native'?t:null,kind==='native'?p.version:null),
      query('DELETE FROM guards'),
    ]); } catch { return null; }
    return {session:{id,kind,createdAt:t,expiresAt},operator:p,cookie:cookie(token,Math.floor((expiresAt-t)/1000)),returnTo:safeReturnTo(returnTo)};
  }
  const accounts = {
    findById,
    async findByEmail(email) {return personOf(await query('SELECT * FROM people WHERE email=? AND workspace=?',email,WORKSPACE).first());},
    async findBinding({issuer,subject}) {return personOf(await query('SELECT p.* FROM people p JOIN bindings b ON b.person_id=p.id WHERE issuer=? AND subject=? AND workspace=?',issuer,subject,WORKSPACE).first());},
    async bind() {throw new Error('Use atomic binding and issuance');},
    async issueSession() {throw new Error('Use atomic binding and issuance');},
    async bindAndIssueSession({person:p,principal,returnTo}) {
      if (!Number.isSafeInteger(principal.providerGeneration) || principal.providerGeneration < 0) return null;
      const pin=providerPinFence(principal.providerPin);
      return issue(p,'oidc',returnTo,[
        guard('EXISTS(SELECT 1 FROM settings WHERE id=1 AND idp_sign_in=1 AND generation=?)',[principal.providerGeneration]),
        guard(pin.sql,pin.args),
        guard("(?=1 OR NOT EXISTS(SELECT 1 FROM domains WHERE domain=? AND provider!=?))",[Number(p.owner),p.email.split('@')[1],principal.provider??'']),
        query('INSERT INTO bindings(issuer,subject,person_id) VALUES(?,?,?) ON CONFLICT DO NOTHING',principal.issuer,principal.subject,p.id),
        guard('EXISTS(SELECT 1 FROM bindings WHERE issuer=? AND subject=? AND person_id=?)',[principal.issuer,principal.subject,p.id]),
        query('UPDATE people SET password=0 WHERE id=?',p.id),
        query("UPDATE sessions SET revoked_at=COALESCE(revoked_at,?) WHERE person_id=? AND kind='password'",now(),p.id),
      ],principal);
    },
    async getSession(request,{now:t}) {
      const token=read(request);if(!token)return null;
      const s=await query("SELECT s.* FROM sessions s JOIN people p ON p.id=s.person_id WHERE token_hash=? AND workspace=? AND p.status='active' AND p.version=s.version AND revoked_at IS NULL AND expires_at>?",await hashToken(SECRET,'session',token),WORKSPACE,t).first();
      if(!s)return null;
      if(s.kind==='oidc' && !await query('SELECT 1 FROM bindings WHERE issuer=? AND subject=? AND person_id=?',s.issuer,s.subject,s.person_id).first())return null;
      if(s.kind==='oidc' && !await query('SELECT 1 FROM settings WHERE id=1 AND idp_sign_in=1 AND generation=?',s.generation).first())return null;
      if(s.kind==='oidc' && s.provider && !await query("SELECT 1 FROM oa_identity_providers WHERE provider_id=? AND issuer=? AND linked_at=? AND status='linked'",s.provider,s.issuer,s.linked_at).first())return null;
      return {hash:s.token_hash,id:s.id,kind:s.kind,operatorId:s.person_id,operator:await findById(s.person_id),createdAt:s.created_at,expiresAt:s.expires_at,issuer:s.issuer,subject:s.subject};
    },
    async signOut(request,{now:t}) {const token=read(request);if(token)await query('UPDATE sessions SET revoked_at=? WHERE token_hash=? AND person_id IN(SELECT id FROM people WHERE workspace=?)',t,await hashToken(SECRET,'session',token),WORKSPACE).run();return {cookie:cookie('',0)};},
    async revokeSession(id) {await query('UPDATE sessions SET revoked_at=? WHERE id=? AND person_id IN(SELECT id FROM people WHERE workspace=?)',now(),id,WORKSPACE).run();},
    async owner() {return personOf(await query(`SELECT * ${ownerSelection}`,WORKSPACE,ownerRole).first());},
    async identityEnabled() {return !!(await query('SELECT idp_sign_in FROM settings WHERE id=1').first()).idp_sign_in;},
    async policyVersion() {return (await query('SELECT generation FROM settings WHERE id=1').first()).generation;},
    async requiredProvider(email) {return (await query('SELECT provider FROM domains WHERE domain=?',email.split('@')[1]).first())?.provider??null;},
    async currentBoundSubject({personId,issuer}) {const rows=(await query('SELECT subject FROM bindings WHERE issuer=? AND person_id=?',issuer,personId).all()).results;return rows.length===1?rows[0].subject:null;},
    async issueLocalSession({person:p,kind,returnTo}) {
      const r=routeFence(p);
      return issue(p,kind,returnTo,[guard(r.sql,r.args),...(kind==='password'?[guard('NOT EXISTS(SELECT 1 FROM bindings WHERE person_id=?)',[p.id]),guard('EXISTS(SELECT 1 FROM people WHERE id=? AND password=1)',[p.id])]:[])]);
    },
    async setIdentitySettings({actor,idpSignIn,now:t}) {
      const f=actorFence(actor,t),o=currentOwnerFence(actor);
      try {await db.batch([guard(f.sql,f.args),guard(o.sql,o.args),
        query('UPDATE settings SET idp_sign_in=?,first_setup=0,generation=generation+1 WHERE id=1',Number(idpSignIn)),
        query("UPDATE sessions SET revoked_at=? WHERE kind='oidc' AND ?=0",t,Number(idpSignIn)),
        query("INSERT INTO audit VALUES('idpSignIn',?,?,?)",actor.operator.id,String(idpSignIn),t),query('DELETE FROM guards')]);return true;}catch{return false;}
    },
    async checkCredentialFence(c) {const p=await findById(c.personId);return p?.status==='active' && p.version===c.fence;},
  };
  const helpers={db,query,guard,personFence,routeFence,actorFence,currentOwnerFence,findById,issue,now,accounts};
  if(config.bootstrap)accounts.bootstrap=async({email,returnTo})=>{
    const p={id:'native-claimed-owner',email,role:ownerRole,status:'active',version:1,owner:true,displayName:'Owner',createdAt:now()};
    const token=opaqueToken(),id=crypto.randomUUID(),createdAt=now(),expiresAt=createdAt+604800000;
    try {await db.batch([
      guard('NOT EXISTS(SELECT 1 FROM people WHERE workspace=?)',[WORKSPACE]),
      query('INSERT INTO people(id,workspace,email,role,created_at) VALUES(?,?,?,?,?)',p.id,WORKSPACE,email,ownerRole,createdAt),
      query('UPDATE settings SET first_setup=0 WHERE id=1'),
      query("INSERT INTO sessions(id,person_id,token_hash,version,kind,created_at,expires_at) VALUES(?,?,?,1,'native',?,?)",id,p.id,await hashToken(SECRET,'session',token),createdAt,expiresAt),query('DELETE FROM guards'),
    ]);}catch{return null;}
    return {session:{id,kind:'native',createdAt,expiresAt},operator:p,cookie:cookie(token,604800),returnTo:safeReturnTo(returnTo)};
  };
  accounts.dependencies=dependencyAuthority(helpers);
  if(config.noDependencies)delete accounts.dependencies;
  if(config.noLocal)delete accounts.issueLocalSession;
  if(config.noSettings)delete accounts.setIdentitySettings;
  const proofs=createProofs(helpers);
  if(config.partial)delete proofs.consumeLink;
  return {accounts,proofs};
}
