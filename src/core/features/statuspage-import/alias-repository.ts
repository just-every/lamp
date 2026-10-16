import { loadPlans } from "../../../../modules/import-kit/src/d1/plans";
import type { ImportedPublicRecord } from "./public-addresses";

/** Read-only projection of the original journal, including conditional undo's
 * preserved records. No native target shape or old expected value is changed. */
export async function readImportedPublicRecords(db: D1Database): Promise<ImportedPublicRecord[]> {
  const rows = (await db.prepare("SELECT DISTINCT j.id,j.plan_json FROM ik_jobs j JOIN ik_provenance p ON p.job_id=j.id JOIN statuspage_import_targets t ON t.kind=p.target_kind AND t.id=p.target_id WHERE p.reversed=0 AND j.destination='lamp' AND j.namespace IN ('statuspage','betterstack','instatus','sorry') AND p.target_kind IN ('incident','maintenance') AND (EXISTS(SELECT 1 FROM incidents WHERE id=p.target_id AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM maintenance WHERE id=p.target_id))").all<{ id: string; plan_json: string }>()).results;
  const plans = await loadPlans(rows, db as never);
  const applied = (await db.prepare("SELECT p.job_id,p.ordinal,p.target_kind,p.target_id FROM ik_provenance p JOIN statuspage_import_targets t ON t.kind=p.target_kind AND t.id=p.target_id WHERE p.reversed=0 AND p.destination='lamp' AND p.target_kind IN ('incident','maintenance') AND (EXISTS(SELECT 1 FROM incidents WHERE id=p.target_id AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM maintenance WHERE id=p.target_id))").all<{ job_id: string; ordinal: number; target_kind: string; target_id: string }>()).results;
  return applied.flatMap((row) => {
    const entry = plans.get(row.job_id)?.entries[row.ordinal];
    if (!entry || entry.erased) return [];
    const raw = (entry.source.payload as { raw?: { shortlink?: unknown } }).raw;
    return [{ namespace: entry.source.namespace, sourceId: entry.source.sourceId, targetKind: row.target_kind, targetId: row.target_id, shortlink: raw?.shortlink, publicAddresses: (entry.source.payload as { publicAddresses?: string[] }).publicAddresses }];
  });
}

/** A completed import owns the source feed even if it contains no incidents.
 * After undo, a retained native target keeps that compatibility feed alive. */
export async function readImportedNamespaces(db: D1Database): Promise<string[]> {
  const rows = await db.prepare("SELECT DISTINCT j.namespace FROM ik_jobs j WHERE j.destination='lamp' AND j.namespace IN ('statuspage','betterstack','instatus','sorry') AND (j.state='completed' OR EXISTS(SELECT 1 FROM ik_provenance p JOIN statuspage_import_targets t ON t.kind=p.target_kind AND t.id=p.target_id WHERE p.job_id=j.id AND p.reversed=0))").all<{namespace: string}>();
  return rows.results.map((row) => row.namespace);
}
