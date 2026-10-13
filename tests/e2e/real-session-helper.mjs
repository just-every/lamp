import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {hashToken} from '@runeditrun/rer/internal/modules/operator-auth/crypto.mjs';
import {secret} from '../auth-adoption/runtime.mjs';
const run=promisify(execFile);
// A real Base session in real D1. Only fixtures hold this synthetic credential;
// the public email/confirmation journey is covered separately.
export async function insertRealOperatorSession({persistTo,configPath='wrangler.jsonc',pageSettings=true}={}) {
 const token=randomBytes(32).toString('base64url'),hash=await hashToken(secret,'session',token),now=Date.now();
 const proof=crypto.randomUUID();
 const sql=`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES ('01J00000000000000000000001','operator@example.test','Contract Operator','owner','active',${now}) ON CONFLICT(id) DO UPDATE SET status='active';
 INSERT INTO oa_bootstrap(singleton,claim_id,claimed_at) VALUES(1,'01J00000000000000000000001',${now}) ON CONFLICT DO NOTHING;
 INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,return_to,created_at,expires_at,consumed_at) SELECT '${proof}','proof-${proof}','magic',id,version,'/app',${now},${now+1200000},${now} FROM oa_operators WHERE id='01J00000000000000000000001';
 INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,source_token_id,created_at,expires_at) SELECT '${crypto.randomUUID()}','${hash}',id,version,'native','${proof}',${now},${now+86400000} FROM oa_operators WHERE id='01J00000000000000000000001';
 ${pageSettings?`INSERT INTO page_settings(id,page_name,tagline,accent_color,timezone,hostname,footer_credit_enabled,mail_from_address,feed_id,created_at,updated_at) VALUES ('default','Atlas Cloud Status','Current availability and incident communications for Atlas Cloud.','#16794C','America/Los_Angeles','status.atlascloud.example',1,'lamp@localhost.invalid','test-feed-identity-00000000000001','2026-08-31','2026-08-31') ON CONFLICT(id) DO NOTHING;
 INSERT OR IGNORE INTO setup_readiness(step,evidence_key,checked_at) VALUES('first-run','complete','2026-08-31');`:''}`;
 await run('pnpm',['exec','wrangler','d1','execute','DB','--local','--config',configPath,...(persistTo?['--persist-to',persistTo]:[]),'--command',sql],{cwd:process.cwd()});return token;
}
