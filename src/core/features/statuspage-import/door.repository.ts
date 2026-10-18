import { Buffer } from 'node:buffer';
import { writeImportDoorSettings } from '../../../../modules/import-kit/src/door';
import { sha256, type D1Sql, type ImportPlan } from '../../../../modules/import-kit/src/d1/index';
import { AuthError, type Session } from '@runeditrun/rer/modules/operator-auth';
import type { OwnerClaimConfig } from '../../../../modules/owner-claim/index.mjs';
import { sessionAuthority } from '../../platform/auth/authority';
import type { AppBindings } from '../../app/types';

export function createImportDoorRepository(db: D1Database) {
  async function allowed(authority: D1Sql) {
    const row = await db.prepare(`SELECT (${authority.sql}) AS allowed`).bind(...authority.params ?? []).first<{allowed:number}>();
    return row?.allowed===1;
  }
  async function assertOwner(actor: Session) {
    if (!await allowed(sessionAuthority(actor))) throw new AuthError('owner_required',403);
  }
  return {
    allowed,
    /** The permanent door key for settings, lineage and history: the key the
     * installation first stored, before that RER's owner-claim installation id
     * when one is configured, otherwise Lamp's own fixed key. */
    async key(bindings: AppBindings) {
      const stored = await db.prepare('SELECT installation_id FROM ik_door_settings ORDER BY rowid LIMIT 1').first<{installation_id:string}>();
      return stored?.installation_id ?? (bindings.RER_OWNER_CLAIM_INSTALLATION_ID?.trim() || 'lamp');
    },
    /** Pins the door key with Business grants off, under the owner's authority. */
    async ensureSettings(key: string, authority: D1Sql) {
      if (!await db.prepare('SELECT 1 FROM ik_door_settings WHERE installation_id=?').bind(key).first()) await writeImportDoorSettings(db,key,{enabled:false},authority);
    },
    async ownerId(email: string) {
      const owner = await db.prepare("SELECT id FROM oa_operators WHERE email=? AND role='owner' AND status='active'").bind(email).first<{id:string}>();
      return owner?.id;
    },
    /** Every door import's principal: the installation's configured owner, so
     * the owner's own imports and Business's share one lineage and history. */
    async principalId(email: string) {
      const owner = await db.prepare("SELECT id FROM oa_operators WHERE email=? AND role='owner'").bind(email).first<{id:string}>();
      return owner?.id;
    },
    async settings(key: string, claim: OwnerClaimConfig | null, actor: Session) {
      await assertOwner(actor);
      if (!claim) return {configured:false,enabled:false,keys:[]};
      const [settings,revoked] = await Promise.all([
        db.prepare('SELECT enabled FROM ik_door_settings WHERE installation_id=?').bind(key).first<{enabled:number}>(),
        db.prepare('SELECT kid FROM ik_door_revoked_keys WHERE installation_id=?').bind(key).all<{kid:string}>(),
      ]);
      await assertOwner(actor);
      return {configured:true,enabled:settings?.enabled===1,keys:[...new Set([...Object.keys(claim.publicKeys),...revoked.results.map(row=>row.kid)])].sort().map(kid=>({kid,revoked:revoked.results.some(row=>row.kid===kid)}))};
    },
    async save(key: string, actor: Session, changes: {enabled:boolean;revokedKids?:string[]}) {
      await writeImportDoorSettings(db,key,changes,sessionAuthority(actor));
    },
    /** A complete door upload's bytes in this installation and namespace, as the door itself reads them. */
    async uploadBytes(installationId: string, namespace: string, uploadId: string) {
      const upload = await db.prepare('SELECT bundle_sha256,total_bytes,total_chunks FROM ik_door_uploads WHERE id=? AND installation_id=? AND namespace=?').bind(uploadId,installationId,namespace).first<{bundle_sha256:string;total_bytes:number;total_chunks:number}>();
      if (!upload) return null;
      const chunks = (await db.prepare('SELECT base64 FROM ik_door_chunks WHERE upload_id=? ORDER BY ordinal').bind(uploadId).all<{base64:string}>()).results;
      if (chunks.length!==upload.total_chunks) return null;
      const bytes = Buffer.concat(chunks.map(chunk=>Buffer.from(chunk.base64,'base64')));
      return bytes.length===upload.total_bytes && sha256(bytes)===upload.bundle_sha256 ? new Uint8Array(bytes) : null;
    },
    /** The usable plan the door holds of these exact bytes, which it answers
     * without reading them again, and whether its import started. */
    async planOf(installationId: string, namespace: string, bundleSha256: string) {
      const row = await db.prepare(`SELECT p.id,(p.job_id IS NOT NULL OR EXISTS(SELECT 1 FROM ik_jobs j WHERE j.operation_key='door:'||p.id)) AS started FROM ik_door_plans p
        WHERE installation_id=? AND namespace=? AND bundle_sha256=? AND complete=1 AND NOT EXISTS(SELECT 1 FROM ik_door_apply_failures f WHERE f.plan_id=p.id)`).bind(installationId,namespace,bundleSha256).first<{id:string;started:number}>();
      return row ? {id:row.id,started:row.started===1} : null;
    },
    /** A complete plan of the namespace nobody started importing, with its bundle. */
    async unstarted(installationId: string, namespace: string, planId: string) {
      return db.prepare(`SELECT p.id,p.bundle_sha256 FROM ik_door_plans p WHERE p.id=? AND p.installation_id=? AND p.namespace=? AND p.complete=1 AND p.job_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM ik_jobs j WHERE j.operation_key='door:'||p.id)`).bind(planId,installationId,namespace).first<{id:string;bundle_sha256:string}>();
    },
    /** The bytes of a complete upload of this bundle, as the door holds them for its plan. */
    async bundleBytes(installationId: string, namespace: string, bundleSha256: string) {
      const uploads = (await db.prepare('SELECT id FROM ik_door_uploads WHERE installation_id=? AND namespace=? AND bundle_sha256=? ORDER BY rowid').bind(installationId,namespace,bundleSha256).all<{id:string}>()).results;
      for (const upload of uploads) {
        const bytes = await this.uploadBytes(installationId,namespace,upload.id);
        if (bytes) return bytes;
      }
      return null;
    },
    /** The namespace's pending plan that nobody started applying, with its bundle. */
    async unstartedPending(installationId: string, namespace: string) {
      return db.prepare(`SELECT p.id,p.bundle_sha256 FROM ik_door_namespaces n JOIN ik_door_plans p ON p.id=n.pending_id
        WHERE n.installation_id=? AND n.namespace=? AND p.job_id IS NULL AND NOT EXISTS(SELECT 1 FROM ik_jobs j WHERE j.operation_key='door:'||p.id)`).bind(installationId,namespace).first<{id:string;bundle_sha256:string}>();
    },
    /** A saved door plan as the owner reviews it, and its import job when one started. */
    async planSnapshot(installationId: string, planId: string) {
      const row = await db.prepare('SELECT job_id FROM ik_door_plans WHERE id=? AND installation_id=? AND complete=1').bind(planId,installationId).first<{job_id:string|null}>();
      const chunks = (await db.prepare('SELECT body FROM ik_door_plan_chunks WHERE plan_id=? ORDER BY ordinal').bind(planId).all<{body:string}>()).results;
      if (!row || !chunks.length) return null;
      return {plan:(JSON.parse(chunks.map(chunk=>chunk.body).join('')) as {plan:ImportPlan}).plan,jobId:row.job_id};
    },
    /** Whether an import job was undone or rolled back. */
    async reversed(jobId: string) {
      return Boolean(await db.prepare("SELECT 1 FROM ik_jobs WHERE id=? AND state IN ('undone','rolled_back')").bind(jobId).first());
    },
    /** A namespace's snapshots undo newest first. */
    async assertNewest(planId: string) {
      const newer = await db.prepare(`SELECT 1 FROM ik_door_plans p JOIN ik_door_plans newer ON newer.installation_id=p.installation_id AND newer.namespace=p.namespace AND newer.rowid>p.rowid LEFT JOIN ik_jobs j ON j.id=newer.job_id WHERE p.id=? AND (newer.job_id IS NULL OR j.state NOT IN ('undone','rolled_back')) LIMIT 1`).bind(planId).first();
      if (newer) throw new Error('Undo the newest import of this source first.');
    },
  };
}
