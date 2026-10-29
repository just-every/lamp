import { claimImportInvitation, releaseImportInvitation } from "./invitation-claim.repository";
import { createIncidentFollowSettingsRepository } from "../subscribers/incident-follow-settings.repository";
import { createSubscriberLimitRepository } from "../subscribers/limits.repository";
import { fetchSorryPublicResponses } from "./sorry";
import { releaseSorrySubscribers, type SorryReleaseApproval } from "./sorry-release.repository";
import { readCutover } from "./cutover.repository";
import { cutoverFromPlan } from "./cutover";
import { loadPlans } from "../../../../modules/import-kit/src/d1/plans";
import { readImportedPublicRecords } from "./alias-repository";
import { sourcePublicAddresses, inspectSourcePublicAddresses, resolvePublicAddresses } from "./public-addresses";
import type { Session } from '@runeditrun/rer/modules/operator-auth';
import { sessionAuthority } from '../../platform/auth/authority';
import { isMailPreparationError } from '../../platform/mail/sender';
import { canonicalJson, readD1ImportJob, readD1ImportUndoReport, resumeD1Import, undoD1Import, type D1ImportContext, type D1Sql, type ImportJob, type ImportPlan } from "../../../../modules/import-kit/src/d1/index.ts";
import { stored } from "../../../../modules/import-kit/src/d1/jobs.ts";
import { nowIso } from "../../shared/ids";
import { planMoveIn, reportFromPlan, type MoveInReport } from "./planning";
import type { Snapshot } from "./rows";
import { importSources, isImportSource, sourceAdapter, type SourceInput } from "./adapters";
import type { SavedFile } from "./source";
import type { StatusFeedVendor } from "../../platform/status-feeds/index.ts";
import { attributedStatuspageTargets } from "./targets";
import { doorMapping, moveInPlan, readDoorExport } from './door-plan';
import { approvalCaption } from '../../../../modules/import-kit/src/door/failures';

const DESTINATION = "lamp";
const INVITES_PER_REQUEST = 50;
const SOURCES = `(${importSources.map((name) => `'${name}'`).join(",")})`;

export type MoveInActor = Session;
/** A door import's plan, for Move in's resume and undo through the door. */
export interface MoveInDoorPlan { planId: string; fingerprint: string; namespace: string }
export interface MoveInResult { job: ImportJob; door: MoveInDoorPlan | null; report: MoveInReport; invites: { sent: number; remaining: number }; undo?: Awaited<ReturnType<typeof readD1ImportUndoReport>> & { expiredSubscribers: number } }
export interface MoveInHooks {
  inviteSubscriber(subscriberId: string, claimSend: () => Promise<boolean>): Promise<boolean>;
  publicDataChanged(): Promise<void>;
  publicOrigin?(): Promise<string>;
}

/** The kit evaluates this in D1 before and after every batch: a signed-out or
 * removed operator stops an import at its next batch. */
function importContext(db: D1Database, actor: MoveInActor, namespace = "statuspage", principalId = actor.operator.id): D1ImportContext {
  return {
    destination: DESTINATION, namespace, mappingVersion: "1",
    storage: { database: db as never, targets: attributedStatuspageTargets(actor.operator.id) },
    batchSize: 4, maxBatches: 3, reversalPolicy: "preserve-conflicts",
    authorization: {
      principalId,
      predicate: () => sessionAuthority(actor),
    },
  };
}

/** Door preparation runs under the authority the door admitted: the owner's
 * session for Move in, the installation's active owner for a Business grant.
 * Every door write rechecks that authority itself. */
function doorPreparationContext(db: D1Database, principalId: string, namespace: string, authority: D1Sql): D1ImportContext {
  return {
    destination: DESTINATION, namespace, mappingVersion: "1",
    storage: { database: db as never, targets: attributedStatuspageTargets(principalId) },
    authorization: { principalId, predicate: () => authority },
  };
}

/** A source's saved responses, by file name and content. */
const artifactIdentity = (plan: ImportPlan | { artifacts: Array<{ name: string; sha256: string }> }) => {
  const artifacts = "source" in plan ? plan.source.artifacts : plan.artifacts;
  return canonicalJson(artifacts.map((artifact) => ({ name: artifact.name, sha256: artifact.sha256 })).sort((a, b) => a.name.localeCompare(b.name)));
};

export function createStatuspageImportService(db: D1Database, hooks: MoveInHooks, options: { apiOrigin?: string; capturePublicFeeds?: (source: StatusFeedVendor, publicUrl: string) => Promise<SavedFile[]> } = {}) {
  /** An import Move in made before the door (the operator's own, by its source
   * namespace) or a door import of a listed source, under the session's authority. */
  async function jobOf(id: string, actor: MoveInActor) {
    const row = await db.prepare(`SELECT j.namespace,j.principal_id,d.id AS plan_id,d.fingerprint,d.namespace AS source FROM ik_jobs j LEFT JOIN ik_door_plans d ON d.job_id=j.id WHERE j.id=? AND j.destination=?`).bind(id, DESTINATION).first<{ namespace: string; principal_id: string; plan_id: string | null; fingerprint: string | null; source: string | null }>();
    // A door import's principal is the installation's owner; any owner session reads it.
    if (row?.plan_id && row.source && isImportSource(row.source)) return { context: importContext(db, actor, row.namespace, row.principal_id), door: { planId: row.plan_id, fingerprint: row.fingerprint!, namespace: row.source } };
    if (row && !row.plan_id && row.principal_id === actor.operator.id && isImportSource(row.namespace)) return { context: importContext(db, actor, row.namespace), door: null };
    throw new Error("Import not found.");
  }
  async function contextForJob(id: string, actor: MoveInActor) {
    return (await jobOf(id, actor)).context;
  }
  /** Resume and undo of an import made before the door. A door import resumes
   * and undoes through the door, like every new import. */
  async function contextForLegacyJob(id: string, actor: MoveInActor) {
    const job = await jobOf(id, actor);
    if (job.door) throw new Error("Continue or undo this import from Move in.");
    return job.context;
  }
  async function assertAuthority(context: D1ImportContext) {
    const fence = context.authorization.predicate('read', DESTINATION);
    const row = await db.prepare(`SELECT (${fence.sql}) AS allowed`).bind(...fence.params ?? []).first<{ allowed: number }>();
    if (row?.allowed !== 1) throw new Error('NOT_AUTHORIZED');
  }

  async function snapshot(context: D1ImportContext): Promise<Snapshot> {
    await assertAuthority(context);
    const [groups, components, counters, allocated, destinations, templates, references, orders] = await db.batch<Record<string, unknown>>([
      db.prepare("SELECT coalesce(max(display_order), -1) AS value FROM component_groups"),
      db.prepare("SELECT coalesce(max(display_order), -1) AS value FROM components"),
      db.prepare("SELECT namespace, last_number FROM reference_counters"),
      db.prepare("SELECT reference FROM reference_allocations"),
      db.prepare("SELECT s.destination, CASE WHEN EXISTS (SELECT 1 FROM ik_provenance p WHERE p.destination='lamp' AND p.target_kind='subscriber' AND p.target_id=s.id AND p.reversed=0) THEN s.id END AS imported FROM subscribers s"),
      db.prepare("SELECT t.name, CASE WHEN EXISTS (SELECT 1 FROM ik_provenance p WHERE p.destination='lamp' AND p.target_kind='template' AND p.target_id=t.id AND p.reversed=0) THEN t.id END AS imported FROM incident_templates t"),
      db.prepare("SELECT id, reference FROM incidents UNION ALL SELECT id, reference FROM maintenance"),
      db.prepare("SELECT id, display_order FROM components UNION ALL SELECT id, display_order FROM component_groups"),
    ]);
    await assertAuthority(context);
    const last = Object.fromEntries(counters.results.map((row) => [row.namespace, Number(row.last_number)]));
    return {
      subscriberCounts: await createSubscriberLimitRepository(db).counts(),
      incidentIncludeReport: (await createIncidentFollowSettingsRepository(db).get()).includeReport,
      maxGroupOrder: Number(groups.results[0].value), maxComponentOrder: Number(components.results[0].value),
      lastReference: { INC: last.INC ?? 0, SCH: last.SCH ?? 0 },
      allocated: new Set(allocated.results.map((row) => String(row.reference))),
      references: new Map(references.results.map((row) => [String(row.id), String(row.reference)])),
      orders: new Map(orders.results.map((row) => [String(row.id), Number(row.display_order)])),
      templateNames: new Map(templates.results.map((row) => [String(row.name), row.imported === null ? null : String(row.imported)])),
      destinations: new Map(destinations.results.map((row) => [String(row.destination), row.imported === null ? null : String(row.imported)])),
    };
  }

  /** Equal operators share native data, but each source record lands once. */
  async function sourceClear(plan: ImportPlan) {
    // Exclude this operation so the import kit's post-write authority check
    // accepts its own new job, while serializing competing alias reservations.
    const otherJobs = `SELECT count(*) AS n FROM ik_jobs WHERE destination='lamp' AND namespace IN ${SOURCES} AND NOT (principal_id=? AND fingerprint=?)`;
    const observed = await db.prepare(otherJobs).bind(plan.principalId, plan.fingerprint).first<{n: number}>();
    const pending = (await db.prepare(`SELECT id,plan_json FROM ik_jobs WHERE destination='lamp' AND namespace IN ${SOURCES} AND state NOT IN ('undone','rolled_back')`).all<{id: string; plan_json: string}>()).results;
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
      sql: `(SELECT count(*) FROM ik_jobs WHERE destination='lamp' AND namespace IN ${SOURCES} AND NOT (principal_id=? AND fingerprint=?))=? AND NOT EXISTS (SELECT 1 FROM ik_d1_plan_index i JOIN ik_jobs j ON j.id=i.job_id WHERE j.destination=? AND j.namespace=? AND i.source_identity IN (SELECT value FROM json_each(?)) AND j.state NOT IN ('undone','rolled_back') AND NOT (j.principal_id=? AND j.fingerprint=?))`,
      params: [plan.principalId, plan.fingerprint, observed?.n ?? 0, DESTINATION, plan.namespace, JSON.stringify(plan.entries.map((entry) => entry.identity)), plan.principalId, plan.fingerprint],
    };
    const result = await db.prepare(`SELECT ${clear.sql} AS clear`).bind(...clear.params).first<{ clear: number }>();
    if (result?.clear !== 1) throw new Error("Some of these records were imported already. Undo that import first, or import only new saved responses.");
    return clear;
  }

  async function sendInvites(jobId: string, plan: ImportPlan, context: D1ImportContext) {
    const fence = context.authorization.predicate('apply', DESTINATION);
    await assertAuthority(context);
    const subscriberIds = plan.entries.flatMap((entry) => entry.effects.filter((effect) => effect.targetKind === "subscriber").map((effect) => effect.targetId));
    if (subscriberIds.length) await db.batch(subscriberIds.map((id) => db.prepare(`INSERT OR IGNORE INTO statuspage_import_invites (subscriber_id, job_id, sent_at) SELECT ?, ?, NULL WHERE ${fence.sql}`).bind(id, jobId, ...fence.params ?? [])));
    const due = (await db.prepare(`SELECT i.subscriber_id AS id,d.destination FROM statuspage_import_invites i JOIN subscribers s ON s.id=i.subscriber_id JOIN subscriber_directory d ON d.id=s.id
      WHERE i.job_id=? AND i.sent_at IS NULL AND s.state='pending' AND s.channel='email' AND julianday(s.created_at)>julianday('now','-72 hours')
      AND NOT EXISTS(SELECT 1 FROM incident_subscriptions f WHERE f.subscriber_id=s.id AND (f.ended_at IS NOT NULL OR f.resolution_at IS NOT NULL))
      AND (i.confirmation_address_hash IS NULL OR NOT EXISTS(SELECT 1 FROM subscriber_confirmation_attempts a WHERE a.email_hash=i.confirmation_address_hash AND julianday(a.last_sent_at)>=julianday('now','-24 hours')))
      ORDER BY i.subscriber_id LIMIT ?`).bind(jobId, INVITES_PER_REQUEST).all<{ id: string;destination:string }>()).results;
    let sent = 0;
    for (const { id,destination } of due) {
      let claimedAt: string | undefined;
      try {
        if (await hooks.inviteSubscriber(id, async () => {
          // The final authority and eligibility check is atomic with the claim.
          const timestamp = nowIso();
          const claimed=await claimImportInvitation(db,{id,jobId,destination,at:timestamp,fence});
          if(claimed){claimedAt=timestamp;return true;}
          await assertAuthority(context);
          return false;
        })) sent += 1;
      } catch (error) {
        // A transport rejection/timeout or arbitrary extension error is not
        // evidence that nothing was sent. Release only this invocation's claim
        // when the adapter explicitly proves it never reached transport.
        if (claimedAt && isMailPreparationError(error)) await releaseImportInvitation(db,{id,jobId,destination,at:claimedAt});
        throw error;
      }
    }
    const remaining = await db.prepare("SELECT count(*) AS n FROM statuspage_import_invites i JOIN subscribers s ON s.id=i.subscriber_id WHERE i.job_id=? AND i.sent_at IS NULL AND s.state='pending' AND s.channel='email' AND julianday(s.created_at) > julianday('now','-72 hours')").bind(jobId).first<{ n: number }>();
    await assertAuthority(context);
    return { sent, remaining: Number(remaining?.n ?? 0) };
  }

  // A held Sorry subscriber deleted by its expiry (held-sorry.ts) before the undo
  // reads as retained in the undo report; it is gone, not kept, so it is counted apart.
  async function undoReport(id: string, context: D1ImportContext) {
    const report = await readD1ImportUndoReport(id, context, { limit: 1000 });
    const kept = report.dispositions.filter((row) => row.disposition === "retained" && row.targetKind === "subscriber").map((row) => row.targetId);
    const present = new Set(kept.length ? (await db.prepare("SELECT id FROM subscribers WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(kept)).all<{ id: string }>()).results.map((row) => row.id) : []);
    const expired = new Set(kept.filter((targetId) => !present.has(targetId)));
    return { ...report, dispositions: report.dispositions.filter((row) => !(row.targetKind === "subscriber" && expired.has(row.targetId))), expiredSubscribers: expired.size };
  }

  async function result(id: string, actor: MoveInActor): Promise<MoveInResult> {
    const { context, door } = await jobOf(id, actor);
    const job = await readD1ImportJob(id, context);
    const { plan } = await stored(id, context);
    const cutover = await readCutover(db, job.id, moveInPlan(plan));
    const invites = { sent: 0, remaining: cutover.invitations.eligible };
    await assertAuthority(context);
    const report = reportFromPlan(plan, job.state);
    report.cutover = cutover;
    const existingAddresses = resolvePublicAddresses((await readImportedPublicRecords(db)).map((record) => ({ ...record, target: `${record.targetKind}:${record.targetId}` })));
    report.unavailableAddresses = [...new Set([...report.unavailableAddresses, ...cutover.unavailable])];
    await assertAuthority(context);
    // A door import's job reads as its source, as Move in's history lists it.
    return { job: door ? { ...job, namespace: door.namespace } : job, door, report, invites, ...(job.state === "undone" ? { undo: await undoReport(job.id, context) } : {}) };
  }

  return {
    /** One door upload, planned as Move in has always planned a source, for the
     * door's own plan: the records it reads and the mapping it applies. Read-only;
     * the door admitted the session or grant first. */
    async prepareDoor(bytes: Uint8Array, namespace: string, principalId: string, operatorId: string, authority: D1Sql, business: boolean, asOf = nowIso()) {
      const {input,read} = await readDoorExport(bytes);
      if (namespace!==input.source) throw new Error('The grant namespace must match the source.');
      const context = doorPreparationContext(db, principalId, input.source, authority);
      // Imported records name the operator who imported them as their author.
      const plan = await planMoveIn(read,await snapshot(context),context,operatorId,asOf);
      await sourceClear(plan);
      await assertAuthority(context);
      return doorMapping(plan, business);
    },
    /** A source Move in imported before the door, by its saved responses (an
     * import the operator made and did not undo): Move in reports it as already
     * imported and changes nothing, as it always has. Door imports carry their own
     * kit namespace, so only those earlier imports match. */
    async importedBefore(bytes: Uint8Array, namespace: string, actor: MoveInActor) {
      const {input,read} = await readDoorExport(bytes);
      if (namespace!==input.source) return null;
      const context = importContext(db, actor, input.source), identity = artifactIdentity(read);
      await assertAuthority(context);
      const rows = (await db.prepare("SELECT id FROM ik_jobs WHERE principal_id=? AND destination=? AND namespace=? AND state NOT IN ('undone','rolled_back') ORDER BY rowid DESC").bind(actor.operator.id, DESTINATION, input.source).all<{ id: string }>()).results;
      for (const row of rows) {
        const { plan } = await stored(row.id, context);
        if (artifactIdentity(plan) !== identity) continue;
        const current = await result(row.id, actor);
        return { report: { ...current.report, state: "already imported" }, jobId: row.id };
      }
      await assertAuthority(context);
      return null;
    },
    /** Writes nothing: reads a source account or public page with its key or
     * address, and returns its saved responses for Move in to upload. The key is
     * used for these reads and never saved. */
    async fetchSource(input: SourceInput, actor: MoveInActor) {
      await assertAuthority(importContext(db, actor));
      if (input.source === "sorry" && input.publicUrl) return fetchSorryPublicResponses({ publicUrl: input.publicUrl });
      // A Statuspage, Instatus or Better Stack page's own public feeds, read keyless through the website reader's guard.
      if (input.publicUrl && (input.source === "statuspage" || input.source === "instatus" || input.source === "betterstack")) {
        if (!options.capturePublicFeeds) throw new Error("Lamp can't read public status pages here.");
        return options.capturePublicFeeds(input.source, input.publicUrl).catch(() => { throw new Error("That status page's public feeds could not be read."); });
      }
      if (!input.pageId || !input.apiKey) throw new Error(`Choose saved ${sourceAdapter(input.source).label} responses, or enter a page ID and API key.`);
      return sourceAdapter(input.source).fetch({ pageId: input.pageId, apiKey: input.apiKey }, options.apiOrigin);
    },
    /** The dry-run report of a door plan, from the plan the owner reviews. A
     * plan whose import already finished reads as already imported. */
    async planReport(plan: ImportPlan, jobId: string | null, actor: MoveInActor) {
      if (jobId) {
        const current = await result(jobId, actor);
        if (current.job.state === "completed") return { report: { ...current.report, state: "already imported" }, jobId };
      }
      await assertAuthority(importContext(db, actor));
      return { report: reportFromPlan(plan) };
    },
    async resume(id: string, actor: MoveInActor) {
      const context = await contextForLegacyJob(id, actor);
      const before = await readD1ImportJob(id, context);
      if (before.state === "applying" || before.state === "queued") {
        await resumeD1Import(id, context);
        if ((await readD1ImportJob(id, context)).state === "completed") await hooks.publicDataChanged();
      }
      return result(id, actor);
    },
    /** Removes what the import created and nobody changed since; changed records stay and are named. */
    async undo(id: string, actor: MoveInActor) {
      const context = await contextForLegacyJob(id, actor);
      await undoD1Import(id, context);
      await this.forgetUndoneInvites(id, context.authorization.predicate('undo', DESTINATION));
      await assertAuthority(context);
      await hooks.publicDataChanged();
      return result(id, actor);
    },
    /** Invitation claims of subscribers an undo removed. */
    async forgetUndoneInvites(jobId: string, fence: D1Sql) {
      await db.prepare(`DELETE FROM statuspage_import_invites WHERE job_id=? AND subscriber_id NOT IN (SELECT id FROM subscribers) AND ${fence.sql}`).bind(jobId, ...fence.params ?? []).run();
    },
    async sendInvitations(id: string, actor: MoveInActor, approval?: SorryReleaseApproval) {
      const context = await contextForJob(id, actor);
      const job = await readD1ImportJob(id, context);
      if (job.state !== "completed") throw new Error("Finish the import before sending invitations.");
      const { plan } = await stored(id, context);
      // Subscribers held until cutover (Sorry's, and every Business import's) are released first.
      if (cutoverFromPlan(moveInPlan(plan), "").afterCutover) await releaseSorrySubscribers(db, id, plan, context, approval, await hooks.publicOrigin?.());
      const invites = await sendInvites(id, plan, context);
      return { ...await result(id, actor), invites };
    },
    read: (id: string, actor: MoveInActor) => result(id, actor),
    /** Move in's history: every door import, the owner's own and Business's,
     * with the operator's imports from before the door. */
    async list(actor: MoveInActor) {
      const context = importContext(db, actor);
      await assertAuthority(context);
      const rows = (await db.prepare(`SELECT j.id,coalesce(d.namespace,j.namespace) AS namespace,j.state,j.checkpoint,j.total,d.id AS planId,d.fingerprint,a.plan_id AS approved,a.owner,a.approved_at,a.approval_id,a.reviewer,f.reason_code AS failure FROM ik_jobs j LEFT JOIN ik_door_plans d ON d.job_id=j.id LEFT JOIN ik_door_approvals a ON a.plan_id=d.id LEFT JOIN ik_door_apply_failures f ON f.plan_id=d.id WHERE j.destination=? AND ((d.id IS NULL AND j.principal_id=? AND j.namespace IN ${SOURCES}) OR d.namespace IN ${SOURCES}) ORDER BY j.rowid DESC LIMIT 30`).bind(DESTINATION, actor.operator.id).all<Record<string, unknown>>()).results;
      await assertAuthority(context);
      // An owner's approval reads "approved by …", Business's "approved via Business by …", and a failed apply says so.
      return rows.map(({ approved, owner, approved_at, approval_id, reviewer, failure, ...job }) => ({ ...job, approvalCaption: approved === null ? null : approvalCaption({ owner, approved_at, approval_id, reviewer }, job.fingerprint, failure) }));
    },
  };
}

export type StatuspageImportService = ReturnType<typeof createStatuspageImportService>;
