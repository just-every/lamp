import type { D1ImportContext, D1RelatedErasure, D1Sql } from './types.ts';
import { sql } from './database.ts';
import { loadPlans } from './plans.ts';
import { readOriginals } from './originals.ts';
import { exactRows } from './sets.ts';

export interface RelatedSelection { identities: Set<string>; originals: Map<string, Set<string>>; guards: D1Sql[] }

/** Visit every retained plan and original in the destination once. The exact job
 * set and fingerprints are fenced, so a job created or changed after this scan
 * aborts the erasure instead of keeping an unscanned copy. */
export async function relatedSelection(context: D1ImportContext, related: D1RelatedErasure): Promise<RelatedSelection> {
  const db = context.storage.database;
  const { results: rows } = await db.prepare('SELECT * FROM ik_jobs WHERE destination=? ORDER BY id').bind(context.destination).all<any>();
  const identities = new Set<string>(), originals = new Map<string, Set<string>>();
  for (const row of rows) {
    const plan = (await loadPlans([row], db, context.storage.targets.planCodec)).get(row.id)!;
    if (related.source) for (const entry of plan.entries) if (!entry.erased && related.source(entry.source)) identities.add(entry.identity);
    if (!related.original) continue;
    for (const original of await readOriginals(plan, row.id, context)) {
      if (original.kind !== 'artifact' || original.original.status !== 'retained') continue;
      if (!related.original(Buffer.from(original.original.base64, 'base64'), { name: original.name, sha256: original.sha256 })) continue;
      if (!originals.has(row.id)) originals.set(row.id, new Set());
      originals.get(row.id)!.add(original.sha256);
    }
  }
  return { identities, originals, guards: exactRows('ik_jobs', ['id', 'fingerprint'], rows.map(row => ({ id: row.id, fingerprint: row.fingerprint })), sql('destination=?', context.destination)) };
}
