import type { D1ImportContext, ImportPlan } from '../../../../modules/import-kit/src/d1/index.ts';
import { nowIso } from '../../shared/ids';
import { HELD_SORRY_DAYS } from './held-sorry';

export interface SorryReleaseApproval { liveOrigin?: string; hostnameLive?: boolean; watchWindowClosed?: boolean }

/** An owner attests to cutover; the server binds that action to Lamp's configured
 * public hostname. No mail or arbitrary network probe happens in this transaction. */
export async function releaseSorrySubscribers(db: D1Database, jobId: string, plan: ImportPlan, context: D1ImportContext, approval?: SorryReleaseApproval, configuredOrigin?: string) {
  if (!approval?.hostnameLive || !approval.watchWindowClosed || !approval.liveOrigin || !configuredOrigin) throw new Error('Confirm that the configured public hostname is live and the watch window has closed before sending Sorry invitations.');
  const url = new URL(approval.liveOrigin);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== new URL(configuredOrigin).origin) throw new Error('The invitation hostname must match Lamp’s configured public address.');
  const fence = context.authorization.predicate('apply', 'lamp');
  const ids = plan.entries.filter(entry => !entry.erased).flatMap(entry => entry.effects.filter(effect => effect.targetKind === 'subscriber').map(effect => effect.targetId));
  const timestamp = nowIso();
  await db.batch([
    db.prepare(`INSERT INTO sorry_import_releases(job_id,live_origin,operator_id,released_at)
      SELECT ?,?,?,? WHERE ${fence.sql} AND EXISTS(SELECT 1 FROM ik_jobs WHERE id=? AND state='completed')
      ON CONFLICT(job_id) DO NOTHING`).bind(jobId, url.origin, context.authorization.principalId, timestamp, ...fence.params ?? [], jobId),
    db.prepare(`UPDATE subscribers SET state='pending',deactivation_reason=NULL,created_at=?,updated_at=?
      WHERE id IN (SELECT value FROM json_each(?)) AND state='deactivated' AND deactivation_reason='held for Sorry cutover'
      AND ${fence.sql} AND EXISTS(SELECT 1 FROM sorry_import_releases WHERE job_id=? AND live_origin=?)
      AND EXISTS(SELECT 1 FROM ik_jobs WHERE id=? AND state='completed')`)
      .bind(timestamp, timestamp, JSON.stringify(ids), ...fence.params ?? [], jobId, url.origin, jobId),
  ]);
}

/** A held row the owner never released or undid is deleted, address and all,
 * HELD_SORRY_DAYS after its reviewed dry run, like an unconfirmed pending row. */
export async function expireHeldSorrySubscribers(db: D1Database, now = Date.now()) {
  await db.prepare("DELETE FROM subscribers WHERE state='deactivated' AND deactivation_reason='held for Sorry cutover' AND created_at < ?")
    .bind(new Date(now - HELD_SORRY_DAYS * 24 * 60 * 60 * 1000).toISOString()).run();
}
