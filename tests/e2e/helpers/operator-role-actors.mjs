import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from '@runeditrun/rer/internal/modules/operator-auth/crypto.mjs';
import { secret } from '../../auth-adoption/runtime.mjs';

/** Real native sessions; only the fixture's sign-in mail edge is bypassed. */
export async function operatorRoleActors({persistTo,configPath='wrangler.jsonc'}) {
  const actors = {}, statements = [], now = Date.now();
  const literal = value => `'${String(value).replaceAll("'","''")}'`;
  for (const role of ['admin','communicator','responder','viewer']) {
    const id=randomUUID(), token=randomBytes(32).toString('base64url'), proof=randomUUID();
    const hash=await hashToken(secret,'session',token);
    const displayName=`Synthetic Lamp ${role}`;
    const email=['synthetic-lamp-'+id,'example.test'].join('@');
    statements.push(`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES(${literal(id)},${literal(email)},${literal(displayName)},'${role==='admin'?'admin':'member'}','active',${now})`);
    if(role!=='admin')statements.push(`INSERT INTO operator_roles(operator_id,role) VALUES(${literal(id)},'${role}')`);
    statements.push(`INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,return_to,created_at,expires_at,consumed_at) SELECT '${proof}','synthetic-lamp-${proof}','magic',id,version,'/app',${now},${now+1200000},${now} FROM oa_operators WHERE id='${id}'`);
    statements.push(`INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,source_token_id,created_at,expires_at) SELECT '${randomUUID()}','${hash}',id,version,'native','${proof}',${now},${now+86400000} FROM oa_operators WHERE id='${id}'`);
    actors[role]={id,token,displayName};
  }
  execFileSync('pnpm',['exec','wrangler','d1','execute','DB','--local','--config',configPath,'--persist-to',persistTo,'--command',statements.join(';')],{stdio:'pipe'});
  return actors;
}
