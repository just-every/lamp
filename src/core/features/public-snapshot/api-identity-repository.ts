import { loadPlans } from "../../../../modules/import-kit/src/d1/plans";
import { stableId } from "../statuspage-import/rows";

/** Original public identifiers come from the retained import journal, never a
 * guessed reverse mapping. Only the renderer's public records use this map. */
export async function loadPublicApiIds(db: D1Database): Promise<Record<string, string>> {
  const rows = (await db.prepare("SELECT DISTINCT j.id,j.plan_json FROM ik_jobs j JOIN ik_provenance p ON p.job_id=j.id WHERE j.namespace='statuspage' AND j.destination='lamp' AND p.reversed=0").all<{ id: string; plan_json: string }>()).results;
  const plans = await loadPlans(rows, db as never);
  const applied = (await db.prepare("SELECT p.job_id,p.ordinal,p.target_id FROM ik_provenance p JOIN ik_jobs j ON j.id=p.job_id WHERE j.namespace='statuspage' AND p.destination='lamp' AND p.reversed=0").all<{ job_id: string; ordinal: number; target_id: string }>()).results;
  const ids: Record<string, string> = {};
  for (const row of applied) {
    const entry = plans.get(row.job_id)?.entries[row.ordinal];
    if (!entry || entry.erased) continue;
    if (/^[a-z0-9]{12}$/.test(entry.source.sourceId)) ids[row.target_id] = entry.source.sourceId;
    const raw = (entry.source.payload as { raw?: { incident_updates?: Array<{ id: string; display_at?: string | null; created_at: string }> } }).raw;
    for (const update of raw?.incident_updates ?? []) {
      if (/^[a-z0-9]{12}$/.test(update.id)) ids[stableId(`incident-update:${update.id}`, update.display_at ?? update.created_at)] = update.id;
    }
  }
  return ids;
}
