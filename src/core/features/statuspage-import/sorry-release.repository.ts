import type { D1ImportContext, ImportPlan } from '../../../../modules/import-kit/src/d1/index.ts';
import { nowIso } from '../../shared/ids';
import { HELD_SORRY_DAYS } from './held-sorry';
import { retireSubscriberCustody, subjectsInCustody } from './custody';

/** Each import custody erasure is its own bounded D1 batch; a scheduled run takes a few. */
const CUSTODY_ERASURES_PER_RUN = 3;

export interface SorryReleaseApproval { liveOrigin?: string; hostnameLive?: boolean; watchWindowClosed?: boolean }

/** An owner attests to cutover; the server binds that action to Lamp's configured
 * public hostname. No mail or arbitrary network probe happens in this transaction. */
export async function releaseSorrySubscribers(db: D1Database, jobId: string, plan: ImportPlan, context: D1ImportContext, approval?: SorryReleaseApproval, configuredOrigin?: string) {
  if (!approval?.hostnameLive || !approval.watchWindowClosed || !approval.liveOrigin || !configuredOrigin) throw new Error('Confirm that the configured public hostname is live and the watch window has closed before sending invitations.');
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
      WHERE id IN (SELECT value FROM json_each(?)) AND state='deactivated' AND deactivation_reason IN ('held for Sorry cutover','held for Business cutover')
      AND ${fence.sql} AND EXISTS(SELECT 1 FROM sorry_import_releases WHERE job_id=? AND live_origin=?)
      AND EXISTS(SELECT 1 FROM ik_jobs WHERE id=? AND state='completed')`)
      .bind(timestamp, timestamp, JSON.stringify(ids), ...fence.params ?? [], jobId, url.origin, jobId),
  ]);
}

/** A held row the owner never released or undid is deleted, address and all,
 * HELD_SORRY_DAYS after its reviewed dry run, like an unconfirmed pending row.
 * Its retained import copies leave custody with it, a few per run. */
export async function expireHeldSorrySubscribers(db: D1Database, now = Date.now()) {
  const cutoff = new Date(now - HELD_SORRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const held = "state='deactivated' AND deactivation_reason IN ('held for Sorry cutover','held for Business cutover')";
  const expired = (await db.prepare(`SELECT id,destination FROM subscribers WHERE ${held} AND created_at < ?`).bind(cutoff).all<{ id: string; destination: string }>()).results;
  if (!expired.length) return;
  const custody = await subjectsInCustody(db, expired.map(row => ({ id: row.id, values: [row.destination] })));
  await db.prepare(`DELETE FROM subscribers WHERE ${held} AND created_at < ? AND id NOT IN (SELECT value FROM json_each(?))`).bind(cutoff, JSON.stringify(custody.map(subject => subject.id))).run();
  for (const subject of custody.slice(0, CUSTODY_ERASURES_PER_RUN)) {
    const deletion = { sql: `DELETE FROM subscribers WHERE id=? AND ${held} AND created_at < ?`, params: [subject.id, cutoff] };
    // Admitted while the row is still held past its deadline, and after its deletion.
    const marker = { sql: "DELETE FROM statuspage_import_targets WHERE kind='subscriber' AND id=?", params: [subject.id] };
    await retireSubscriberCustody(db, subject, [marker], [deletion], { principalId: 'lamp:held-expiry', authority: { sql: `NOT EXISTS(SELECT 1 FROM subscribers WHERE id=? AND NOT (${held} AND created_at < ?))`, params: [subject.id, cutoff] } });
  }
}
