import { fetchSorryPublicResponses } from "./sorry";
import { releaseSorrySubscribers, type SorryReleaseApproval } from "./sorry-release.repository";
import { readCutover } from "./cutover.repository";
import { loadPlans } from "../../../../modules/import-kit/src/d1/plans";
import { readImportedPublicRecords } from "./alias-repository";
import { sourcePublicAddresses, inspectSourcePublicAddresses, resolvePublicAddresses } from "./public-addresses";
import type { Session } from '@runeditrun/rer/modules/operator-auth';
import { sessionAuthority } from '../../platform/auth/authority';
import { isMailPreparationError } from '../../platform/mail/sender';
import { applyD1ImportBatches, canonicalJson, createD1ImportJob, readD1ImportJob, readD1ImportUndoReport, resumeD1Import, undoD1Import, type D1ImportContext, type ImportJob, type ImportPlan } from "../../../../modules/import-kit/src/d1/index.ts";
import { stored } from "../../../../modules/import-kit/src/d1/jobs.ts";
import { nowIso } from "../../shared/ids";
import { planMoveIn, reportFromPlan, type MoveInReport } from "./planning";
import type { Snapshot } from "./rows";
import type { SavedFile } from "./source";
import { sourceAdapter, type SourceInput } from "./adapters";
import { statuspageTargets } from "./targets";

const DESTINATION = "lamp";
const NAMESPACE = "statuspage";
const REVIEW_WINDOW_MS = 30 * 60 * 1000;
const INVITES_PER_REQUEST = 50;

export type MoveInActor = Session;
export interface MoveInResult { job: ImportJob; report: MoveInReport; invites: { sent: number; remaining: number }; undo?: Awaited<ReturnType<typeof readD1ImportUndoReport>> }
export interface MoveInHooks {
  inviteSubscriber(subscriberId: string, claimSend: () => Promise<boolean>): Promise<boolean>;
  publicDataChanged(): Promise<void>;
  publicOrigin?(): Promise<string>;
}

/** The kit evaluates this in D1 before and after every batch: a signed-out or
 * removed operator stops an import at its next batch. */
function importContext(db: D1Database, actor: MoveInActor, namespace = "statuspage"): D1ImportContext {
  return {
    destination: DESTINATION, namespace, mappingVersion: "1",
    storage: { database: db as never, targets: statuspageTargets },
    batchSize: 4, maxBatches: 3, reversalPolicy: "preserve-conflicts",
    authorization: {
      principalId: actor.operator.id,
      predicate: () => sessionAuthority(actor),
    },
  };
}

const artifactIdentity = (plan: ImportPlan | { artifacts: Array<{ name: string; sha256: string }> }) => {
  const artifacts = "source" in plan ? plan.source.artifacts : plan.artifacts;
  return canonicalJson(artifacts.map((artifact) => ({ name: artifact.name, sha256: artifact.sha256 })).sort((a, b) => a.name.localeCompare(b.name)));
};

export function createStatuspageImportService(db: D1Database, hooks: MoveInHooks, options: { apiOrigin?: string } = {}) {
  async function contextForJob(id: string, actor: MoveInActor) {
    const row = await db.prepare("SELECT namespace FROM ik_jobs WHERE id=? AND destination=? AND principal_id=?").bind(id, DESTINATION, actor.operator.id).first<{ namespace: string }>();
    if (!row || !["statuspage", "betterstack", "instatus", "sorry"].includes(row.namespace)) throw new Error("Import not found.");
    return importContext(db, actor, row.namespace);
  }
  async function assertAuthority(context: D1ImportContext) {
    const fence = context.authorization.predicate('read', DESTINATION);
    const row = await db.prepare(`SELECT (${fence.sql}) AS allowed`).bind(...fence.params ?? []).first<{ allowed: number }>();
    if (row?.allowed !== 1) throw new Error('NOT_AUTHORIZED');
  }

  async function snapshot(context: D1ImportContext): Promise<Snapshot> {
    await assertAuthority(context);
    const [groups, components, counters, allocated, destinations] = await db.batch<Record<string, unknown>>([
      db.prepare("SELECT coalesce(max(display_order), -1) AS value FROM component_groups"),
      db.prepare("SELECT coalesce(max(display_order), -1) AS value FROM components"),
      db.prepare("SELECT namespace, last_number FROM reference_counters"),
      db.prepare("SELECT reference FROM reference_allocations"),
      db.prepare("SELECT destination FROM subscribers"),
    ]);
    await assertAuthority(context);
    const last = Object.fromEntries(counters.results.map((row) => [row.namespace, Number(row.last_number)]));
    return {
      maxGroupOrder: Number(groups.results[0].value), maxComponentOrder: Number(components.results[0].value),
      lastReference: { INC: last.INC ?? 0, SCH: last.SCH ?? 0 },
      allocated: new Set(allocated.results.map((row) => String(row.reference))),
      destinations: new Set(destinations.results.map((row) => String(row.destination))),
    };
  }

  /** A source already applied by this operator is reported as already here; it is never planned twice. */
  async function existingPlan(identity: string, context: D1ImportContext) {
    await assertAuthority(context);
    const rows = (await db.prepare("SELECT id FROM ik_jobs WHERE principal_id=? AND destination=? AND namespace=? ORDER BY rowid DESC").bind(context.authorization.principalId, DESTINATION, context.namespace).all<{ id: string }>()).results;
    for (const row of rows) {
      const { job, plan } = await stored(row.id, context);
      await assertAuthority(context);
      if (artifactIdentity(plan) !== identity || job.state === "undone" || job.state === "rolled_back") continue;
      return { job, plan };
    }
    await assertAuthority(context);
    return null;
  }

  /** Equal operators share native data, but each source record lands once. */
  async function sourceClear(plan: ImportPlan) {
    // Exclude this operation so the import kit's post-write authority check
    // accepts its own new job, while serializing competing alias reservations.
    const otherJobs = "SELECT count(*) AS n FROM ik_jobs WHERE destination='lamp' AND namespace IN ('statuspage','betterstack','instatus','sorry') AND NOT (principal_id=? AND fingerprint=?)";
    const observed = await db.prepare(otherJobs).bind(plan.principalId, plan.fingerprint).first<{n: number}>();
    const pending = (await db.prepare("SELECT id,plan_json FROM ik_jobs WHERE destination='lamp' AND namespace IN ('statuspage','betterstack','instatus','sorry') AND state NOT IN ('undone','rolled_back')").all<{id: string; plan_json: string}>()).results;
    const occupied = new Map<string, string>();
    for (const stored of (await loadPlans(pending, db as never)).values()) {
      for (const entry of stored.entries.filter((entry) => !entry.erased && entry.effects.length && ["incident", "maintenance"].includes(entry.source.kind))) {
        const raw = (entry.source.payload as { raw?: { shortlink?: unknown } }).raw;
        // Old jobs can contain addresses that were not validated at their import.
        for (const { path } of inspectSourcePublicAddresses(entry.source.sourceId, raw?.shortlink, entry.source.namespace, (entry.source.payload as { publicAddresses?: string[] }).publicAddresses).addresses) occupied.set(path, `${entry.source.namespace}:${entry.source.kind}:${entry.source.sourceId}`);
      }
    }
    for (const record of await readImportedPublicRecords(db)) {
      for (const { path } of inspectSourcePublicAddresses(record.sourceId, record.shortlink, record.namespace, record.publicAddresses).addresses) occupied.set(path, `${record.namespace}:${record.targetKind}:${record.sourceId}`);
    }
    for (const entry of plan.entries.filter((entry) => entry.effects.length && ["incident", "maintenance"].includes(entry.source.kind))) {
      const raw = (entry.source.payload as { raw?: { shortlink?: unknown } }).raw;
      for (const { path } of sourcePublicAddresses(entry.source.sourceId, raw?.shortlink, entry.source.namespace, (entry.source.payload as { publicAddresses?: string[] }).publicAddresses)) {
        const previous = occupied.get(path);
        if (previous && previous !== `${entry.source.namespace}:${entry.source.kind}:${entry.source.sourceId}`) throw new Error(`Public address ${path} conflicts with imported ${previous}.`);
        occupied.set(path, `${entry.source.namespace}:${entry.source.kind}:${entry.source.sourceId}`);
      }
    }
    const clear = {
      sql: `(SELECT count(*) FROM ik_jobs WHERE destination='lamp' AND namespace IN ('statuspage','betterstack','instatus','sorry') AND NOT (principal_id=? AND fingerprint=?))=? AND NOT EXISTS (SELECT 1 FROM ik_d1_plan_index i JOIN ik_jobs j ON j.id=i.job_id WHERE j.destination=? AND j.namespace=? AND i.source_identity IN (SELECT value FROM json_each(?)) AND j.state NOT IN ('undone','rolled_back') AND NOT (j.principal_id=? AND j.fingerprint=?))`,
      params: [plan.principalId, plan.fingerprint, observed?.n ?? 0, DESTINATION, plan.namespace, JSON.stringify(plan.entries.map((entry) => entry.identity)), plan.principalId, plan.fingerprint],
    };
    const result = await db.prepare(`SELECT ${clear.sql} AS clear`).bind(...clear.params).first<{ clear: number }>();
    if (result?.clear !== 1) throw new Error("Some of these records were imported already. Undo that import first, or import only new saved responses.");
    return clear;
  }

  /** Re-applying a reviewed source after an undo is a new application of it. */
  async function applicationContext(context: D1ImportContext, plan: ImportPlan): Promise<D1ImportContext> {
    const clear = await sourceClear(plan);
    const history = "SELECT count(*) FROM ik_jobs WHERE destination=? AND namespace=? AND mapping_version=? AND principal_id=? AND fingerprint=? AND state IN ('undone','rolled_back')";
    const params = [DESTINATION, context.namespace, "1", context.authorization.principalId, plan.fingerprint];
    const generation = Number((await db.prepare(history.replace("count(*)", "count(*) AS generation")).bind(...params).first<{ generation: number }>())?.generation ?? 0);
    return {
      ...context, reviewedFingerprint: plan.fingerprint, operationKey: generation ? `${plan.fingerprint}:application:${generation}` : plan.fingerprint,
      authorization: { ...context.authorization, predicate(action, destination) {
        const authority = context.authorization.predicate(action, destination);
        if (action !== "create") return authority;
        return { sql: `(${authority.sql}) AND (${clear.sql}) AND (${history})=?`, params: [...authority.params ?? [], ...clear.params, ...params, generation] };
      } },
    };
  }

  function reviewedInstant(asOf: string) {
    const instant = Date.parse(asOf);
    if (!Number.isFinite(instant) || instant > Date.now() + 60_000 || instant < Date.now() - REVIEW_WINDOW_MS) throw new Error("This dry run has expired. Run the dry run again.");
    return new Date(instant).toISOString();
  }

  async function sendInvites(jobId: string, plan: ImportPlan, context: D1ImportContext) {
    const fence = context.authorization.predicate('apply', DESTINATION);
    await assertAuthority(context);
    const subscriberIds = plan.entries.flatMap((entry) => entry.effects.filter((effect) => effect.targetKind === "subscriber").map((effect) => effect.targetId));
    if (subscriberIds.length) await db.batch(subscriberIds.map((id) => db.prepare(`INSERT OR IGNORE INTO statuspage_import_invites (subscriber_id, job_id, sent_at) SELECT ?, ?, NULL WHERE ${fence.sql}`).bind(id, jobId, ...fence.params ?? [])));
    const due = (await db.prepare("SELECT i.subscriber_id AS id FROM statuspage_import_invites i JOIN subscribers s ON s.id=i.subscriber_id WHERE i.job_id=? AND i.sent_at IS NULL AND s.state='pending' AND s.channel='email' AND julianday(s.created_at) > julianday('now','-72 hours') ORDER BY i.subscriber_id LIMIT ?").bind(jobId, INVITES_PER_REQUEST).all<{ id: string }>()).results;
    let sent = 0;
    for (const { id } of due) {
      let claimedAt: string | undefined;
      try {
        if (await hooks.inviteSubscriber(id, async () => {
          // The final authority and eligibility check is atomic with the claim.
          const timestamp = nowIso();
          const claimed = await db.prepare(`UPDATE statuspage_import_invites SET sent_at=?
            WHERE subscriber_id=? AND job_id=? AND sent_at IS NULL AND ${fence.sql}
            AND EXISTS (SELECT 1 FROM subscribers s WHERE s.id=subscriber_id AND s.state='pending' AND s.channel='email' AND julianday(s.created_at) > julianday('now','-72 hours'))
            AND EXISTS (SELECT 1 FROM ik_jobs WHERE id=? AND state='completed')`)
            .bind(timestamp, id, jobId, ...fence.params ?? [], jobId).run();
          if (claimed.meta.changes === 1) { claimedAt = timestamp; return true; }
          await assertAuthority(context);
          return false;
        })) sent += 1;
      } catch (error) {
        // A transport rejection/timeout or arbitrary extension error is not
        // evidence that nothing was sent. Release only this invocation's claim
        // when the adapter explicitly proves it never reached transport.
        if (claimedAt && isMailPreparationError(error)) await db.prepare('UPDATE statuspage_import_invites SET sent_at=NULL WHERE subscriber_id=? AND job_id=? AND sent_at=?').bind(id, jobId, claimedAt).run();
        throw error;
      }
    }
    const remaining = await db.prepare("SELECT count(*) AS n FROM statuspage_import_invites i JOIN subscribers s ON s.id=i.subscriber_id WHERE i.job_id=? AND i.sent_at IS NULL AND s.state='pending' AND s.channel='email' AND julianday(s.created_at) > julianday('now','-72 hours')").bind(jobId).first<{ n: number }>();
    await assertAuthority(context);
    return { sent, remaining: Number(remaining?.n ?? 0) };
  }

  async function result(id: string, actor: MoveInActor): Promise<MoveInResult> {
    const context = await contextForJob(id, actor);
    const job = await readD1ImportJob(id, context);
    const { plan } = await stored(id, context);
    const cutover = await readCutover(db, job.id, plan);
    const invites = { sent: 0, remaining: cutover.invitations.eligible };
    await assertAuthority(context);
    const report = reportFromPlan(plan, job.state);
    report.cutover = cutover;
    const existingAddresses = resolvePublicAddresses((await readImportedPublicRecords(db)).map((record) => ({ ...record, target: `${record.targetKind}:${record.targetId}` })));
    report.unavailableAddresses = [...new Set([...report.unavailableAddresses, ...cutover.unavailable])];
    await assertAuthority(context);
    return { job, report, invites, ...(job.state === "undone" ? { undo: await readD1ImportUndoReport(job.id, context, { limit: 1000 }) } : {}) };
  }

  async function source(input: SourceInput) {
    if (input.files?.length) return { files: input.files, fetched: false };
    if (input.source === "sorry" && input.publicUrl) return { files: await fetchSorryPublicResponses({ publicUrl: input.publicUrl, noticeLimit: input.previewNoticeLimit }), fetched: true };
    if (!input.pageId || !input.apiKey) throw new Error(`Choose saved ${sourceAdapter(input.source).label} responses, or enter a page ID and API key.`);
    return { files: await sourceAdapter(input.source).fetch({ pageId: input.pageId, apiKey: input.apiKey }, options.apiOrigin), fetched: true };
  }

  return {
    /** Writes nothing: reads the source, plans every record and reports it. */
    async preview(input: SourceInput, actor: MoveInActor) {
      const { files, fetched } = await source(input);
      const read = await sourceAdapter(input.source).read(files, { ...input, allowPartialPreview: Boolean(input.previewNoticeLimit) });
      const context = importContext(db, actor, input.source);
      const existing = await existingPlan(artifactIdentity(read), context);
      if (existing) {
        const current = await result(existing.job.id, actor);
        return { report: { ...current.report, state: "already imported" }, jobId: existing.job.id, files: fetched ? files : undefined };
      }
      const asOf = nowIso();
      const plan = await planMoveIn(read, await snapshot(context), context, actor.operator.id, asOf);
      await sourceClear(plan);
      await assertAuthority(context);
      return { report: reportFromPlan(plan), files: fetched ? files : undefined };
    },
    async apply(input: SourceInput & { files: SavedFile[]; asOf: string; fingerprint: string }, actor: MoveInActor) {
      const read = await sourceAdapter(input.source).read(input.files, input);
      const context = importContext(db, actor, input.source);
      const existing = await existingPlan(artifactIdentity(read), context);
      if (existing) return result(existing.job.id, actor);
      const plan = await planMoveIn(read, await snapshot(context), context, actor.operator.id, reviewedInstant(input.asOf));
      if (plan.fingerprint !== input.fingerprint) throw new Error("The source or this page changed since the dry run. Review a fresh dry run.");
      const job = await createD1ImportJob(plan, await applicationContext(context, plan));
      await applyD1ImportBatches(job.id, context);
      const applied = await readD1ImportJob(job.id, context);
      if (applied.state === "completed") await hooks.publicDataChanged();
      return result(job.id, actor);
    },
    async resume(id: string, actor: MoveInActor) {
      const context = await contextForJob(id, actor);
      const before = await readD1ImportJob(id, context);
      if (before.state === "applying" || before.state === "queued") {
        await resumeD1Import(id, context);
        if ((await readD1ImportJob(id, context)).state === "completed") await hooks.publicDataChanged();
      }
      return result(id, actor);
    },
    /** Removes what the import created and nobody changed since; changed records stay and are named. */
    async undo(id: string, actor: MoveInActor) {
      const context = await contextForJob(id, actor);
      await undoD1Import(id, context);
      const fence = context.authorization.predicate('undo', DESTINATION);
      await db.prepare(`DELETE FROM statuspage_import_invites WHERE job_id=? AND subscriber_id NOT IN (SELECT id FROM subscribers) AND ${fence.sql}`).bind(id, ...fence.params ?? []).run();
      await assertAuthority(context);
      await hooks.publicDataChanged();
      return result(id, actor);
    },
    async sendInvitations(id: string, actor: MoveInActor, approval?: SorryReleaseApproval) {
      const context = await contextForJob(id, actor);
      const job = await readD1ImportJob(id, context);
      if (job.state !== "completed") throw new Error("Finish the import before sending invitations.");
      const { plan } = await stored(id, context);
      if (context.namespace === "sorry") await releaseSorrySubscribers(db, id, plan, context, approval, await hooks.publicOrigin?.());
      const invites = await sendInvites(id, plan, context);
      return { ...await result(id, actor), invites };
    },
    read: (id: string, actor: MoveInActor) => result(id, actor),
    async list(actor: MoveInActor) {
      const context = importContext(db, actor);
      await assertAuthority(context);
      const rows = (await db.prepare("SELECT id, namespace, state, checkpoint, total FROM ik_jobs WHERE principal_id=? AND destination=? AND namespace IN ('statuspage','betterstack','instatus','sorry') ORDER BY rowid DESC LIMIT 30").bind(actor.operator.id, DESTINATION).all()).results;
      await assertAuthority(context);
      return rows;
    },
  };
}

export type StatuspageImportService = ReturnType<typeof createStatuspageImportService>;
