import { hashOpaqueToken } from '../../platform/security/opaque-tokens';
import type { D1Sql } from '../../../../modules/import-kit/src/d1/index';

interface InvitationClaim { id: string; jobId: string; destination: string; at: string; fence: D1Sql }
const eligible = "s.state='pending' AND s.channel='email' AND julianday(s.created_at)>julianday('now','-72 hours') AND NOT EXISTS(SELECT 1 FROM incident_subscriptions f WHERE f.subscriber_id=s.id AND (f.ended_at IS NOT NULL OR f.resolution_at IS NOT NULL))";

/** The invitation and shared daily address allowance are claimed together.
 * Suppressed scopes keep sent_at NULL so a later explicit action can try them. */
export async function claimImportInvitation(db: D1Database, input: InvitationClaim): Promise<boolean> {
  const allowance = await hashOpaqueToken(`confirmation-address:${input.destination}`);
  const cutoff = new Date(Date.parse(input.at) - 24 * 60 * 60 * 1000).toISOString();
  const due = `EXISTS(SELECT 1 FROM statuspage_import_invites i JOIN subscribers s ON s.id=i.subscriber_id JOIN subscriber_directory d ON d.id=s.id
    WHERE i.subscriber_id=? AND i.job_id=? AND i.sent_at IS NULL AND d.destination=? AND ${eligible})
    AND EXISTS(SELECT 1 FROM ik_jobs WHERE id=? AND state='completed') AND ${input.fence.sql}`;
  const params = [input.id, input.jobId, input.destination, input.jobId, ...input.fence.params ?? []];
  const results = await db.batch([
    // Remember the shared address key even when its allowance was already used,
    // so a later bounded action can reach recipients behind these scopes.
    db.prepare(`UPDATE statuspage_import_invites SET confirmation_address_hash=? WHERE subscriber_id=? AND job_id=? AND ${due}`)
      .bind(allowance, input.id, input.jobId, ...params),
    db.prepare(`INSERT INTO subscriber_confirmation_attempts(email_hash,last_sent_at,created_at,updated_at)
      SELECT ?,?,?,? WHERE ${due}
      ON CONFLICT(email_hash) DO UPDATE SET last_sent_at=excluded.last_sent_at,updated_at=excluded.updated_at
      WHERE subscriber_confirmation_attempts.last_sent_at<=?`)
      .bind(allowance, input.at, input.at, input.at, ...params, cutoff),
    // changes() refers to the immediately preceding allowance write in this
    // atomic batch. A denied allowance cannot claim another scope's invitation.
    db.prepare(`UPDATE statuspage_import_invites SET sent_at=? WHERE subscriber_id=? AND job_id=? AND sent_at IS NULL AND changes()=1 AND ${due}`)
      .bind(input.at, input.id, input.jobId, ...params),
  ]);
  return results[2].meta.changes === 1;
}

/** Release only a claim whose transport preparation proves nothing was sent. */
export async function releaseImportInvitation(db: D1Database, input: Omit<InvitationClaim, 'fence'>) {
  const allowance = await hashOpaqueToken(`confirmation-address:${input.destination}`);
  await db.batch([
    db.prepare('UPDATE statuspage_import_invites SET sent_at=NULL WHERE subscriber_id=? AND job_id=? AND sent_at=?').bind(input.id, input.jobId, input.at),
    db.prepare('DELETE FROM subscriber_confirmation_attempts WHERE email_hash=? AND last_sent_at=? AND changes()=1').bind(allowance, input.at),
  ]);
}
