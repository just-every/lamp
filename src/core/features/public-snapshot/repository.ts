import { createMetricsRepository } from "../metrics/repository";
import type { PublicMetric } from "../metrics/types";
import { readImportedNamespaces, readImportedPublicRecords } from "../statuspage-import/alias-repository";
import type { ImportedPublicRecord } from "../statuspage-import/public-addresses";
import { loadPublicApiIds } from "./api-identity-repository";
import { createWebsiteRepository } from "../website/repository";
import { and, asc, desc, eq, isNull, ne, or, sql } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import {
  componentGroups,
  componentStandingClaims,
  components,
  componentStateHistory,
  componentStateCorrections,
  incidentComponents,
  incidents,
  incidentUpdates,
  maintenance,
  maintenanceComponents,
  pageSettings,
  snapshotBuilds,
} from "../../shared/schema";

export interface SnapshotRepository {
  load(): Promise<PublicSnapshotSource | null>;
  startBuild(input: typeof snapshotBuilds.$inferInsert): Promise<void>;
  finishBuild(input: { id: string; status: "published" | "failed"; version: string | null; error: string | null; attempts: number; finishedAt: string; updatedAt: string }): Promise<void>;
  latestBuild(): Promise<typeof snapshotBuilds.$inferSelect | null>;
  reserveGeneration(now: string): Promise<number>;
  requestWork(now: string): Promise<number>;
  currentWork(): Promise<{ requestedRevision: number; completedRevision: number }>;
  completeWork(revision: number, now: string): Promise<void>;
  markInterruptedBuilds(now: string, staleBefore: string): Promise<void>;
  claimPendingWork(input: { leaseId: string; now: string; leaseUntil: string; staleBefore: string }): Promise<boolean>;
  releaseWorkLease(leaseId: string, now: string): Promise<void>;
}

export interface PublicSnapshotSource {
  smsEnabled?: boolean;
  metrics?: PublicMetric[];
  websiteUrl?: string | null;
  publicOrigin?: string;
  publicApiIds?: Record<string, string>;
  incidentImpacts?: Record<string, typeof componentStandingClaims.$inferSelect.state>;
  importedNamespaces?: string[];
  importedPublicRecords?: ImportedPublicRecord[];
  settings: typeof pageSettings.$inferSelect;
  components: Array<{
    id: string;
    name: string;
    description: string;
    region?: string | null;
    onlyShowIfDegraded?: boolean;
    uptimeStartDate?: string | null;
    note: string;
    groupId: string | null;
    groupName: string | null;
    groupOrder: number | null;
    groupCreatedAt?: string | null;
    groupUpdatedAt?: string | null;
    displayOrder: number;
    createdAt: string;
    updatedAt: string;
  }>;
  claims: Array<{ componentId: string; state: typeof componentStandingClaims.$inferSelect.state }>;
  history: Array<typeof componentStateHistory.$inferSelect>;
  corrections: Array<typeof componentStateCorrections.$inferSelect>;
  incidents: Array<typeof incidents.$inferSelect>;
  incidentComponents: Array<typeof incidentComponents.$inferSelect>;
  updates: Array<typeof incidentUpdates.$inferSelect>;
  maintenance: Array<typeof maintenance.$inferSelect>;
  maintenanceComponents: Array<typeof maintenanceComponents.$inferSelect>;
  reports: Array<{ incidentId: string; summary: string; timeline: string; cause: string; remediation: string; publishedAt: string }>;
  importedMaintenanceUpdates?: Array<{ id: string; maintenanceId: string; body: string; publishedAt: string }>;
  maintenanceNotices: Array<{ id: string; maintenanceId: string; kind: string; body: string; publishedAt: string }>;
}

export function createSnapshotRepository(binding: D1Database, publicOrigin?: string, smsEnabled = false): SnapshotRepository {
  const database = createDatabase(binding);

  return {
    async load() {
      const settings = await database.select().from(pageSettings).where(eq(pageSettings.id, "default")).get();
      if (!settings) return null;

      const [componentRows, standingClaims, incidentClaims, maintenanceClaims, history, corrections, incidentRows, attachedComponents, updates, maintenanceRows, attachedMaintenanceComponents, reports, maintenanceNotices, importedPublicRecords, importedNamespaces, importedMaintenanceUpdates, publicApiIds, incidentImpactRows] = await Promise.all([
        database
          .select({
            id: components.id,
            name: components.name,
            description: components.description,
            region: components.region,
            onlyShowIfDegraded: components.onlyShowIfDegraded,
            uptimeStartDate: components.uptimeStartDate,
            note: components.note,
            groupId: components.groupId,
            groupName: componentGroups.name,
            groupOrder: componentGroups.displayOrder,
            groupCreatedAt: componentGroups.createdAt,
            groupUpdatedAt: componentGroups.updatedAt,
            displayOrder: components.displayOrder,
            createdAt: components.createdAt,
            updatedAt: components.updatedAt,
          })
          .from(components)
          .leftJoin(componentGroups, eq(components.groupId, componentGroups.id))
          .where(eq(components.internal, false))
          .orderBy(asc(componentGroups.displayOrder), asc(components.displayOrder))
          .all(),
        database.select({ componentId: componentStandingClaims.componentId, state: componentStandingClaims.state }).from(componentStandingClaims).all(),
        database
          .select({ componentId: incidentComponents.componentId, state: incidentComponents.state })
          .from(incidentComponents)
          .innerJoin(incidents, eq(incidentComponents.incidentId, incidents.id))
          .where(and(isNull(incidents.deletedAt), ne(incidents.lifecycle, "Resolved"), sql`incident_components.published_at IS NOT NULL`))
          .all(),
        database
          .select({ componentId: maintenanceComponents.componentId, state: maintenanceComponents.state })
          .from(maintenanceComponents)
          .innerJoin(maintenance, eq(maintenanceComponents.maintenanceId, maintenance.id))
          .where(eq(maintenance.state, "In progress"))
          .all(),
        database.select().from(componentStateHistory).orderBy(asc(componentStateHistory.changedAt), asc(componentStateHistory.createdAt)).all(),
        database.select().from(componentStateCorrections).orderBy(asc(componentStateCorrections.startsAt), asc(componentStateCorrections.createdAt)).all(),
        database.select().from(incidents).where(isNull(incidents.deletedAt)).orderBy(desc(incidents.openedAt)).all(),
        database
          .select()
          .from(incidentComponents)
          .leftJoin(components, eq(incidentComponents.componentId, components.id))
          .where(and(sql`incident_components.published_at IS NOT NULL`, or(and(isNull(incidentComponents.componentId), sql`incident_components.detached_internal = 0`), eq(components.internal, false))))
          .all()
          .then((rows) => rows.map((row) => row.incident_components)),
        database.select().from(incidentUpdates).orderBy(desc(incidentUpdates.publishedAt)).all(),
        database.select().from(maintenance).orderBy(asc(maintenance.startsAt)).all(),
        database
          .select()
          .from(maintenanceComponents)
          .leftJoin(components, eq(maintenanceComponents.componentId, components.id))
          .where(or(and(isNull(maintenanceComponents.componentId), sql`maintenance_components.detached_internal = 0`), eq(components.internal, false)))
          .all()
          .then((rows) => rows.map((row) => row.maintenance_components)),
        binding.prepare(`SELECT incident_id AS incidentId, summary, timeline, cause, remediation, published_at AS publishedAt FROM incident_reports WHERE published_at IS NOT NULL ORDER BY published_at DESC`).all<{ incidentId: string; summary: string; timeline: string; cause: string; remediation: string; publishedAt: string }>().then((result) => result.results),
        binding.prepare(`SELECT id, maintenance_id AS maintenanceId, kind, body, published_at AS publishedAt FROM maintenance_notices ORDER BY published_at DESC`).all<{ id: string; maintenanceId: string; kind: string; body: string; publishedAt: string }>().then((result) => result.results),
        readImportedPublicRecords(binding),
        readImportedNamespaces(binding),
        binding.prepare("SELECT id,maintenance_id AS maintenanceId,body,published_at AS publishedAt FROM import_maintenance_updates ORDER BY published_at DESC,id").all<{id: string; maintenanceId: string; body: string; publishedAt: string}>().then(result => result.results),
        loadPublicApiIds(binding),
        binding.prepare("SELECT id,peak_impact AS impact FROM incidents WHERE deleted_at IS NULL").all<{ id: string; impact: typeof componentStandingClaims.$inferSelect.state | null }>().then(result => result.results),
      ]);

      const website = await createWebsiteRepository(binding).get();
      return {
        websiteUrl: website?.url ?? null,
        smsEnabled,
        publicOrigin,
        publicApiIds, incidentImpacts: Object.fromEntries(incidentImpactRows.filter(row => row.impact !== null).map(row => [row.id, row.impact!])),
        importedPublicRecords, importedNamespaces,
        settings,
        components: componentRows,
        claims: [...standingClaims, ...incidentClaims, ...maintenanceClaims]
          .filter((claim): claim is { componentId: string; state: typeof componentStandingClaims.$inferSelect.state } => claim.componentId !== null),
        history,
        corrections,
        incidents: incidentRows,
        incidentComponents: attachedComponents,
        updates,
        maintenance: maintenanceRows,
        maintenanceComponents: attachedMaintenanceComponents,
        reports,
        maintenanceNotices, importedMaintenanceUpdates, metrics: await createMetricsRepository(binding).publicSeries(),
      };
    },
    async startBuild(input) {
      await database.insert(snapshotBuilds).values(input);
    },
    async finishBuild(input) {
      await database.update(snapshotBuilds).set(input).where(eq(snapshotBuilds.id, input.id));
    },
    async latestBuild() {
      return (await database.select().from(snapshotBuilds).orderBy(desc(snapshotBuilds.startedAt)).limit(1).get()) ?? null;
    },
    async reserveGeneration(now) {
      const result = await binding.prepare(`UPDATE snapshot_build_control SET next_generation = next_generation + 1, updated_at = ? WHERE id = 'default' RETURNING next_generation AS generation`).bind(now).first<{ generation: number }>();
      if (!result || !Number.isInteger(result.generation)) throw new Error("Public snapshot generation control is unavailable.");
      return result.generation;
    },
    async requestWork(now) {
      const result = await binding.prepare(`UPDATE public_snapshot_work SET requested_revision = requested_revision + 1, updated_at = ? WHERE id = 'default' RETURNING requested_revision AS requestedRevision`).bind(now).first<{ requestedRevision: number }>();
      if (!result || !Number.isInteger(result.requestedRevision)) throw new Error("Public snapshot work control is unavailable.");
      return result.requestedRevision;
    },
    async currentWork() {
      const work = await binding.prepare(`SELECT requested_revision AS requestedRevision, completed_revision AS completedRevision FROM public_snapshot_work WHERE id = 'default'`).first<{ requestedRevision: number; completedRevision: number }>();
      if (!work || !Number.isInteger(work.requestedRevision) || !Number.isInteger(work.completedRevision)) throw new Error("Public snapshot work control is unavailable.");
      return work;
    },
    async completeWork(revision, now) {
      await binding.prepare(`UPDATE public_snapshot_work SET completed_revision = CASE WHEN completed_revision < ? THEN ? ELSE completed_revision END, updated_at = ? WHERE id = 'default'`).bind(revision, revision, now).run();
    },
    async markInterruptedBuilds(now, staleBefore) {
      await binding.prepare(`UPDATE snapshot_builds SET status = 'failed', error = COALESCE(error, 'Snapshot build lease expired before completion.'), finished_at = ?, updated_at = ? WHERE status = 'building' AND started_at <= ?`).bind(now, now, staleBefore).run();
    },
    async claimPendingWork(input) {
      const result = await binding.prepare(`UPDATE public_snapshot_work SET retry_lease_id = ?, retry_lease_until = ?, updated_at = ? WHERE id = 'default' AND requested_revision > completed_revision AND (retry_lease_until IS NULL OR retry_lease_until <= ?) AND NOT EXISTS (SELECT 1 FROM snapshot_builds WHERE status = 'building' AND started_at > ?)`)
        .bind(input.leaseId, input.leaseUntil, input.now, input.now, input.staleBefore).run();
      return result.meta.changes === 1;
    },
    async releaseWorkLease(leaseId, now) {
      await binding.prepare(`UPDATE public_snapshot_work SET retry_lease_id = NULL, retry_lease_until = NULL, updated_at = ? WHERE id = 'default' AND retry_lease_id = ?`).bind(now, leaseId).run();
    },
  };
}
