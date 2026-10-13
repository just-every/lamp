import type { ImportPlan } from '../../../../modules/import-kit/src/d1/index';
import { readImportedPublicRecords, readImportedNamespaces } from './alias-repository';
import { pendingDeadline, type CutoverPreview } from './cutover';
import { resolvePublicAddresses, sourceFeedPaths } from './public-addresses';

/** Project surviving native targets, never promise a removed/edited-away destination. */
export async function readCutover(db: D1Database, jobId: string, plan: ImportPlan): Promise<CutoverPreview> {
  const [records, namespaces, targets, subscriptions] = await Promise.all([
    readImportedPublicRecords(db), readImportedNamespaces(db),
    db.prepare("SELECT id,reference,'incident' AS kind FROM incidents WHERE deleted_at IS NULL UNION ALL SELECT id,reference,'maintenance' AS kind FROM maintenance").all<{id: string; reference: string; kind: string}>(),
    db.prepare("SELECT s.created_at,i.sent_at FROM ik_provenance p JOIN subscribers s ON s.id=p.target_id LEFT JOIN statuspage_import_invites i ON i.subscriber_id=s.id WHERE p.job_id=? AND p.target_kind='subscriber' AND p.reversed=0 AND s.state='pending' AND s.channel='email'").bind(jobId).all<{created_at: string; sent_at: string | null}>(),
  ]);
  const jobPaths = new Set(plan.entries.filter(entry => !entry.erased).flatMap(entry => entry.effects).map(effect => effect.targetId));
  // Resolve globally before selecting this job, so cross-job collisions stay unavailable.
  const jobTargets = new Set(targets.results.filter(row => jobPaths.has(row.id)).map(row => `/${row.kind === 'incident' ? 'incidents' : 'maintenance'}/${row.reference}`));
  const all = resolvePublicAddresses(records.flatMap(record => {
    const native = targets.results.find(row => row.id === record.targetId && row.kind === record.targetKind);
    return native ? [{ ...record, target: `/${record.targetKind === 'incident' ? 'incidents' : 'maintenance'}/${native.reference}` }] : [];
  }));
  const rows = [...all.aliases].filter(([, row]) => jobTargets.has(row.target)).map(([path, row]) => ({ path, address: row.address, target: row.target }));
  const current = Date.now();
  const deadlines = subscriptions.results.map(row => pendingDeadline(row.created_at));
  return { rows: rows.slice(0, 25), total: rows.length, unavailable: all.unavailable, feeds: [...new Set(namespaces.flatMap(namespace => sourceFeedPaths[namespace] ?? []))], invitations: {
    eligible: subscriptions.results.filter(row => !row.sent_at && Date.parse(pendingDeadline(row.created_at)) > current).length,
    claimed: subscriptions.results.filter(row => row.sent_at).length,
    expired: deadlines.filter(deadline => Date.parse(deadline) <= current).length,
    deadline: deadlines.sort()[0] ?? null,
  } };
}
