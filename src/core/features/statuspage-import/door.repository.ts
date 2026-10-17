import { writeImportDoorSettings } from '../../../../modules/import-kit/src/door';
import { AuthError, type Session } from '@runeditrun/rer/modules/operator-auth';
import type { OwnerClaimConfig } from '../../../../modules/owner-claim/index.mjs';
import { sessionAuthority } from '../../platform/auth/authority';

export function createImportDoorRepository(db: D1Database) {
  async function assertOwner(actor: Session) {
    const fence = sessionAuthority(actor);
    const row = await db.prepare(`SELECT (${fence.sql}) AS allowed`).bind(...fence.params).first<{allowed:number}>();
    if (row?.allowed!==1) throw new AuthError('owner_required',403);
  }
  return {
    async ownerId(email: string) {
      const owner = await db.prepare("SELECT id FROM oa_operators WHERE email=? AND role='owner' AND status='active'").bind(email).first<{id:string}>();
      return owner?.id;
    },
    async settings(claim: OwnerClaimConfig | null, actor: Session) {
      await assertOwner(actor);
      if (!claim) return {configured:false,enabled:false,keys:[]};
      const [settings,revoked] = await Promise.all([
        db.prepare('SELECT enabled FROM ik_door_settings WHERE installation_id=?').bind(claim.installationId).first<{enabled:number}>(),
        db.prepare('SELECT kid FROM ik_door_revoked_keys WHERE installation_id=?').bind(claim.installationId).all<{kid:string}>(),
      ]);
      await assertOwner(actor);
      return {configured:true,enabled:settings?.enabled===1,keys:[...new Set([...Object.keys(claim.publicKeys),...revoked.results.map(row=>row.kid)])].sort().map(kid=>({kid,revoked:revoked.results.some(row=>row.kid===kid)}))};
    },
    async save(claim: OwnerClaimConfig, actor: Session, changes: {enabled:boolean;revokedKids?:string[]}) {
      await writeImportDoorSettings(db,claim.installationId,changes,sessionAuthority(actor));
    },
    async assertNewest(id: string) {
      const newer = await db.prepare(`SELECT 1 FROM ik_door_plans p JOIN ik_door_plans newer ON newer.installation_id=p.installation_id AND newer.namespace=p.namespace AND newer.rowid>p.rowid LEFT JOIN ik_jobs j ON j.id=newer.job_id WHERE p.job_id=? AND (newer.job_id IS NULL OR j.state NOT IN ('undone','rolled_back')) LIMIT 1`).bind(id).first();
      if (newer) throw new Error('Undo the newest Business snapshot first.');
    },
  };
}
