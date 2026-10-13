import { targetGuards } from './target-guards.ts';
import { requestContext } from './budget.ts';
import { provenanceSet } from './provenance-set.ts';
/** Worker entry point. Requires nodejs_compat for shared crypto and byte helpers;
 * deliberately does not import the synchronous node:sqlite entry point. */
export type * from './types.ts';
export type * from './undo-types.ts';
export type * from '../types.ts';
export { d1ErasureSchema } from './erasure-schema.ts';
export { d1StagingSchema, d1LegacyStreamReceiptUpgrade } from './staging-schema.ts';
export { d1PreparationSchema } from './preparation-schema.ts';
export { prepareD1ImportStream, publishD1ImportPreparation, readD1ImportPreparation, type ImportPreparation } from './preparations.ts';
export { cancelD1ImportStaging } from './staging-lifecycle.ts';
export { requestContext as d1RequestContext } from './budget.ts';
export { upgradeD1ImportErasureIndex } from './erasure-index.ts';
export { d1Schema, initializeD1ImportStorage, preservedUndoEvolution } from './database.ts';
export { readD1ImportUndoReport } from './undo-report.ts';
export { planD1Import, createD1ImportJob, readD1ImportJob } from './jobs.ts';
export { applyD1ImportBatches } from './apply.ts';
export { undoD1Import, rollbackD1Import } from './reverse.ts';
export { eraseD1ImportTarget } from './erasure.ts';
export { readD1ImportOriginals } from './originals.ts';
export { canonicalJson, sha256 } from '../provenance/identity.ts';
export { PLAN_BYTES_LIMIT, PlanTooLargeError, planContentBytes } from '../plan/size.ts';
import type { D1ImportContext } from './types.ts';
import type { PersistedImport } from '../types.ts';
import { authorize, readAtomic, guard, sql } from './database.ts';
import type { D1Sql } from './types.ts';
import { readD1ImportJob } from './jobs.ts';
import { applyD1ImportBatches } from './apply.ts';
import { undoD1Import, rollbackD1Import } from './reverse.ts';
export async function resumeD1Import(id: string, context: D1ImportContext) {
  context = requestContext(context);
  const job = await readD1ImportJob(id, context);
  if (job.state === 'undoing' || job.state === 'undone') return undoD1Import(id, context);
  if (job.state === 'rolling_back' || job.state === 'rolled_back') return rollbackD1Import(id, context);
  return applyD1ImportBatches(id, context);
}
export async function readD1PersistedImport(context: D1ImportContext): Promise<PersistedImport> {
  context = requestContext(context);
  await authorize(context, 'read');
  const { targets, database } = context.storage;
  if (!targets.matchesMany && !targets.matchesCount) throw new Error('IMPORT_NATIVE_SET_GUARD_REQUIRED');
  const rows = await targets.list(database, context.destination);
  const { results } = await context.storage.database.prepare('SELECT * FROM ik_provenance WHERE reversed=0 AND (destination=? OR job_id IN (SELECT id FROM ik_jobs WHERE destination=?))').bind(context.destination, context.destination).all();
  const guards: D1Sql[] = [];
  const { decoded: provenance } = await provenanceSet(results, context, guards);
  if (targets.matchesMany) {
    const predicates = targets.matchesMany(rows, context.destination);
    if (!predicates.length) throw new Error('IMPORT_NATIVE_SET_GUARD_REQUIRED');
    guards.push(...predicates.map(guard));
  } else {
    guards.push(guard(targets.matchesCount!(rows.length, context.destination)));
    for (const row of rows) guards.push(...targetGuards(targets,row, row.destination, row.targetKind, row.targetId));
  }
  guards.push(guard(sql('(? = (SELECT COUNT(*) FROM ik_provenance WHERE reversed=0 AND (destination=? OR job_id IN (SELECT id FROM ik_jobs WHERE destination=?))))', results.length, context.destination, context.destination)));
  await readAtomic({ ...context, maxBatchBytes: Math.min(context.maxBatchBytes ?? 2 * 1024 * 1024, 2 * 1024 * 1024) }, guards);
  return { rows, provenance };
}

export { planD1ImportStream, createD1ImportStream, readD1ImportStream, resumeD1ImportStream, undoD1ImportStream, type ImportStreamPlan } from './streams.ts';
export { preflightD1ImportJob } from './creation.ts';
export type { D1CreatePreflightContext, D1CreatePreflight } from './creation.ts';

export { d1NativeStagingSchema } from './native-staging-schema.ts';
export { retainedSql } from './retained-values.ts';
export { cancelD1NativeStaging, cancelD1ErasureStaging } from './native-staging-lifecycle.ts';
export { d1CustodyStateSchema } from './custody-state-schema.ts';

export { d1StreamOriginSchema } from './stream-origin.ts';
