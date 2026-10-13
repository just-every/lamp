import type { UpdateChannel } from "../../shared/domain";
import { and, desc, eq, isNull } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import type { ComponentState } from "../../shared/domain";
import { allocateReference } from "../../shared/references/repository";
import type { ComponentClaimEventInput, ComponentStateHistoryInput } from "../components";
import {
  incidentComponents,
  incidentDrafts,
  incidentInternalNotes,
  incidents,
  incidentUpdates,
} from "../../shared/schema";

export type StoredIncident = typeof incidents.$inferSelect;
export type StoredIncidentComponent = typeof incidentComponents.$inferSelect;
export type StoredIncidentDraft = typeof incidentDrafts.$inferSelect;
export type StoredIncidentUpdate = typeof incidentUpdates.$inferSelect;

export interface IncidentTemplateRecord {
  id: string;
  name: string;
  lifecycle: "Investigating" | "Identified" | "Monitoring" | "Resolved";
  affectedAudience: string;
  customerImpact: string;
  whatStillWorks: string;
  details: string;
  nextUpdateOffsetMinutes: number | null;
  createdByOperatorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentTemplateComponentRecord {
  id: string;
  templateId: string;
  componentId: string | null;
  componentName: string;
  state: ComponentState;
  relationship: "Primary" | "Dependent";
  createdAt: string;
  updatedAt: string;
}

export type PublishingDraft = StoredIncidentDraft & {
  scheduledPublishAt: string | null;
  scheduledChannels: Array<UpdateChannel>;
  reviewedByOperatorId: string | null;
  reviewedAt: string | null;
  correctsUpdateId: string | null;
};

export interface IncidentPublishRecord {
  id: string;
  incidentId: string;
  lifecycle: string;
  affectedAudience: string;
  customerImpact: string;
  whatStillWorks: string;
  details: string;
  nextUpdateAt: string | null;
  publishedAt: string;
  isRetroactive: boolean;
  authorOperatorId: string;
  correctsUpdateId: string | null;
  peakImpact: ComponentState;
  createdAt: string;
  updatedAt: string;
  claimEvents: ComponentClaimEventInput[];
  historyEntries: ComponentStateHistoryInput[];
}

export interface IncidentRepository {
  listIncidents(): Promise<StoredIncident[]>;
  findIncident(incidentId: string): Promise<StoredIncident | null>;
  listComponents(incidentId: string): Promise<StoredIncidentComponent[]>;
  listUpdates(incidentId: string): Promise<StoredIncidentUpdate[]>;
  findPublishingDraft(incidentId: string): Promise<PublishingDraft | null>;
  findPeakImpact(incidentId: string): Promise<ComponentState | null>;
  hasRetroactiveUpdate(incidentId: string): Promise<boolean>;
  listInternalNotes(incidentId: string): Promise<Array<typeof incidentInternalNotes.$inferSelect>>;
  addInternalNote(input: typeof incidentInternalNotes.$inferInsert): Promise<void>;
  create(input: Omit<typeof incidents.$inferInsert, "reference">, components: Array<typeof incidentComponents.$inferInsert>, draft: typeof incidentDrafts.$inferInsert): Promise<string>;
  upsertDraft(input: typeof incidentDrafts.$inferInsert, expectedVersion: string): Promise<void>;
  scheduleDraft(incidentId: string, scheduledPublishAt: string | null, channels: Array<UpdateChannel>, updatedAt: string, expectedDraftId?: string, replacementDraftId?: string): Promise<boolean>;
  reviewDraft(incidentId: string, reviewerOperatorId: string, reviewedAt: string, expectedVersion: string): Promise<boolean>;
  setDraftCorrection(incidentId: string, correctsUpdateId: string, updatedAt: string, expectedVersion: string): Promise<boolean>;
  listDueScheduledDrafts(now: string): Promise<PublishingDraft[]>;
  publishDraft(input: IncidentPublishRecord, recipientStatements: D1PreparedStatement[]): Promise<void>;
  softDelete(incidentId: string, reason: string, operatorId: string, deletedAt: string, auditId: string, claimEvents: ComponentClaimEventInput[]): Promise<boolean>;
  listTemplates(): Promise<Array<IncidentTemplateRecord & { components: IncidentTemplateComponentRecord[] }>>;
  saveTemplate(input: IncidentTemplateRecord, components: IncidentTemplateComponentRecord[]): Promise<void>;
  findTemplate(templateId: string): Promise<(IncidentTemplateRecord & { components: IncidentTemplateComponentRecord[] }) | null>;
  applyTemplate(incidentId: string, draft: StoredIncidentDraft, components: Array<typeof incidentComponents.$inferInsert>, expectedVersion: string): Promise<void>;
}

export class DraftConflictError extends Error {
  constructor() { super("This draft changed in another tab. Reload to continue with the saved update."); }
}

async function writeDraftBatch(binding: D1Database, statements: D1PreparedStatement[]) {
  try { await binding.batch(statements); }
  catch (cause) {
    // A conditional ID becomes NULL only when the reviewed draft was replaced.
    // SQLite rejects it and rolls the entire publication/template batch back.
    if (cause instanceof Error && /NOT NULL constraint failed: incident_(?:drafts|updates)\.id/.test(cause.message)) throw new DraftConflictError();
    throw cause;
  }
}

export function createIncidentRepository(binding: D1Database): IncidentRepository {
  const database = createDatabase(binding);
  const asPublishingDraft = (row: (Omit<PublishingDraft, "scheduledChannels"> & { scheduledChannelsJson: string | null }) | null) => {
    if (!row) return null;
    let candidate: unknown;
    try {
      candidate = JSON.parse(row.scheduledChannelsJson ?? "[]");
    } catch { throw new Error("Scheduled delivery channel configuration is malformed."); }
    if (!Array.isArray(candidate) || candidate.some((item) => item !== "email" && item !== "webhook" && item !== "chat")) throw new Error("Scheduled delivery channel configuration is invalid.");
    return { ...row, scheduledChannels: [...new Set(candidate)] };
  };

  return {
    async listIncidents() {
      return database.select().from(incidents).where(isNull(incidents.deletedAt)).orderBy(desc(incidents.openedAt)).all();
    },
    async findIncident(incidentId) {
      const incident = await database.select().from(incidents).where(and(eq(incidents.id, incidentId), isNull(incidents.deletedAt))).get();
      return incident ?? null;
    },
    async listComponents(incidentId) {
      return database.select().from(incidentComponents).where(eq(incidentComponents.incidentId, incidentId)).all();
    },
    async listUpdates(incidentId) {
      return database.select().from(incidentUpdates).where(eq(incidentUpdates.incidentId, incidentId)).orderBy(desc(incidentUpdates.publishedAt)).all();
    },
    async findPublishingDraft(incidentId) {
      const row = await binding.prepare(`SELECT id, incident_id AS incidentId, lifecycle, affected_audience AS affectedAudience, customer_impact AS customerImpact, what_still_works AS whatStillWorks, details, next_update_at AS nextUpdateAt, author_operator_id AS authorOperatorId, created_at AS createdAt, updated_at AS updatedAt, scheduled_publish_at AS scheduledPublishAt, scheduled_channels_json AS scheduledChannelsJson, reviewed_by_operator_id AS reviewedByOperatorId, reviewed_at AS reviewedAt, corrects_update_id AS correctsUpdateId FROM incident_drafts WHERE incident_id = ?`).bind(incidentId).first<Omit<PublishingDraft, "scheduledChannels"> & { scheduledChannelsJson: string | null }>();
      return asPublishingDraft(row);
    },
    async findPeakImpact(incidentId) {
      const result = await binding.prepare(`SELECT peak_impact AS peakImpact FROM incidents WHERE id = ?`).bind(incidentId).first<{ peakImpact: ComponentState | null }>();
      return result?.peakImpact ?? null;
    },
    async hasRetroactiveUpdate(incidentId) {
      const result = await binding.prepare(`SELECT EXISTS(SELECT 1 FROM incident_updates WHERE incident_id = ? AND is_retroactive = 1) AS hasRetroactiveUpdate`).bind(incidentId).first<{ hasRetroactiveUpdate: number }>();
      return result?.hasRetroactiveUpdate === 1;
    },
    async listInternalNotes(incidentId) {
      return database.select().from(incidentInternalNotes).where(eq(incidentInternalNotes.incidentId, incidentId)).orderBy(desc(incidentInternalNotes.createdAt)).all();
    },
    async addInternalNote(input) {
      await database.insert(incidentInternalNotes).values(input);
    },
    async create(input, attached, draft) {
      const reference = await allocateReference(binding, "INC");
      await binding.batch([
        binding.prepare(`INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,deleted_at,deletion_reason,created_at,updated_at) VALUES (?,?,?,'Investigating',?,NULL,?,NULL,NULL,?,?)`).bind(input.id, reference, input.title, input.openedAt, input.createdByOperatorId, input.createdAt, input.updatedAt),
        ...attached.map((component) => binding.prepare(`INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(component.id, component.incidentId, component.componentId, component.componentName, component.state, component.relationship, component.createdAt, component.updatedAt)),
        binding.prepare(`INSERT INTO incident_drafts (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,author_operator_id,created_at,updated_at) VALUES (?,?,'Investigating','','','','',NULL,?,?,?)`).bind(draft.id, draft.incidentId, draft.authorOperatorId, draft.createdAt, draft.updatedAt),
      ]);
      return reference;
    },
    async upsertDraft(input, expectedVersion) {
      const [draftId, count] = expectedVersion.split(":");
      const row = await binding.prepare(`INSERT INTO incident_drafts (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,author_operator_id,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE
        COALESCE((SELECT id FROM incident_drafts WHERE incident_id = ?), '-') = ?
        AND (SELECT count(*) FROM incident_updates WHERE incident_id = ?) = ?
        ON CONFLICT(incident_id) DO UPDATE SET id=excluded.id,lifecycle=excluded.lifecycle,affected_audience=excluded.affected_audience,customer_impact=excluded.customer_impact,what_still_works=excluded.what_still_works,details=excluded.details,next_update_at=excluded.next_update_at,author_operator_id=excluded.author_operator_id,updated_at=excluded.updated_at,scheduled_publish_at=NULL,scheduled_channels_json=NULL,reviewed_by_operator_id=NULL,reviewed_at=NULL,corrects_update_id=NULL RETURNING id`)
        .bind(input.id,input.incidentId,input.lifecycle,input.affectedAudience,input.customerImpact,input.whatStillWorks,input.details,input.nextUpdateAt,input.authorOperatorId,input.createdAt,input.updatedAt,input.incidentId,draftId,input.incidentId,Number(count)).first();
      if (!row) throw new DraftConflictError();
    },
    async scheduleDraft(incidentId, scheduledPublishAt, channels, updatedAt, expectedDraftId, replacementDraftId) {
      return Boolean(await binding.prepare(`UPDATE incident_drafts SET id = COALESCE(?, id), scheduled_publish_at = ?, scheduled_channels_json = ?, updated_at = ? WHERE incident_id = ? AND (? IS NULL OR id = ?) RETURNING id`).bind(replacementDraftId ?? null, scheduledPublishAt, JSON.stringify(channels), updatedAt, incidentId, expectedDraftId ?? null, expectedDraftId ?? null).first());
    },
    async reviewDraft(incidentId, reviewerOperatorId, reviewedAt, expectedVersion) {
      const [draftId, count] = expectedVersion.split(":");
      return Boolean(await binding.prepare(`UPDATE incident_drafts SET reviewed_by_operator_id = ?, reviewed_at = ?, updated_at = ? WHERE incident_id = ? AND id = ? AND (SELECT count(*) FROM incident_updates WHERE incident_id = ?) = ? AND author_operator_id <> ? RETURNING id`)
        .bind(reviewerOperatorId, reviewedAt, reviewedAt, incidentId, draftId, incidentId, Number(count), reviewerOperatorId).first<{ id: string }>());
    },
    async setDraftCorrection(incidentId, correctsUpdateId, updatedAt, expectedVersion) {
      const [draftId, count] = expectedVersion.split(":");
      return Boolean(await binding.prepare(`UPDATE incident_drafts SET corrects_update_id = ?, updated_at = ? WHERE incident_id = ? AND id = ? AND (SELECT count(*) FROM incident_updates WHERE incident_id = ?) = ? AND EXISTS (SELECT 1 FROM incident_updates WHERE id = ? AND incident_id = ?) RETURNING id`)
        .bind(correctsUpdateId, updatedAt, incidentId, draftId, incidentId, Number(count), correctsUpdateId, incidentId).first<{ id: string }>());
    },
    async listDueScheduledDrafts(now) {
      const rows = await binding.prepare(`SELECT id, incident_id AS incidentId, lifecycle, affected_audience AS affectedAudience, customer_impact AS customerImpact, what_still_works AS whatStillWorks, details, next_update_at AS nextUpdateAt, author_operator_id AS authorOperatorId, created_at AS createdAt, updated_at AS updatedAt, scheduled_publish_at AS scheduledPublishAt, scheduled_channels_json AS scheduledChannelsJson, reviewed_by_operator_id AS reviewedByOperatorId, reviewed_at AS reviewedAt, corrects_update_id AS correctsUpdateId FROM incident_drafts WHERE scheduled_publish_at IS NOT NULL AND scheduled_publish_at <= ?`).bind(now).all<Omit<PublishingDraft, "scheduledChannels"> & { scheduledChannelsJson: string | null }>();
      return rows.results.flatMap((row) => {
        const draft = asPublishingDraft(row);
        return draft ? [draft] : [];
      });
    },
    async publishDraft(input, recipientStatements) {
      await writeDraftBatch(binding, [
        binding.prepare(`UPDATE incident_components SET published_at = ? WHERE incident_id = ? AND published_at IS NULL`).bind(input.publishedAt, input.incidentId),
        binding.prepare(`INSERT INTO incident_updates (id, incident_id, lifecycle, affected_audience, customer_impact, what_still_works, details, next_update_at, published_at, is_retroactive, author_operator_id, corrects_update_id, created_at, updated_at) VALUES ((SELECT id FROM incident_drafts WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(input.id, input.incidentId, input.lifecycle, input.affectedAudience, input.customerImpact, input.whatStillWorks, input.details, input.nextUpdateAt, input.publishedAt, input.isRetroactive ? 1 : 0, input.authorOperatorId, input.correctsUpdateId, input.createdAt, input.updatedAt),
        binding.prepare(`UPDATE incidents
          SET lifecycle = (
                SELECT lifecycle
                FROM incident_updates
                WHERE incident_id = ?
                ORDER BY published_at DESC, created_at DESC, id DESC
                LIMIT 1
              ),
              resolved_at = (
                SELECT CASE WHEN lifecycle = 'Resolved' THEN published_at ELSE NULL END
                FROM incident_updates
                WHERE incident_id = ?
                ORDER BY published_at DESC, created_at DESC, id DESC
                LIMIT 1
              ),
              peak_impact = ?, updated_at = ?
          WHERE id = ?`).bind(input.incidentId, input.incidentId, input.peakImpact, input.updatedAt, input.incidentId),
        binding.prepare(`DELETE FROM incident_drafts WHERE id = ?`).bind(input.id),
        binding.prepare(`INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at) VALUES (?, 'incident-update', ?, 'published', ?, ?, ?, ?)`)
          .bind(`${input.id}-audit`, input.id, input.authorOperatorId, JSON.stringify({ incidentId: input.incidentId, publishedAt: input.publishedAt }), input.createdAt, input.updatedAt),
        ...input.claimEvents.map((event) => binding.prepare(`INSERT INTO component_claim_events (id, component_id, cause_type, cause_id, state, changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(event.id, event.componentId, event.causeType, event.causeId, event.state, event.changedAt, event.createdAt, event.updatedAt)),
        ...input.historyEntries.map((entry) => binding.prepare(`INSERT INTO component_state_history (id, component_id, previous_state, new_state, cause_type, cause_id, operator_id, changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(entry.id, entry.componentId, entry.previousState, entry.newState, entry.cause.type, entry.cause.id, entry.cause.operatorId, entry.changedAt, entry.createdAt, entry.updatedAt)),
        ...recipientStatements,
      ]);
    },
    async softDelete(incidentId, reason, operatorId, deletedAt, auditId, claimEvents) {
      const mutation = binding.prepare(`UPDATE incidents SET deleted_at = ?, deletion_reason = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`).bind(deletedAt, reason, deletedAt, incidentId);
      const audit = binding.prepare(`INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, reason, payload_json, created_at, updated_at)
        SELECT ?, 'incident', ?, 'deleted', ?, ?, '{}', ?, ? WHERE changes() = 1`).bind(auditId, incidentId, operatorId, reason, deletedAt, deletedAt);
      const releases = claimEvents.map((event) => binding.prepare(`INSERT INTO component_claim_events (id, component_id, cause_type, cause_id, state, changed_at, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM audit_entries WHERE id = ?)`)
        .bind(event.id, event.componentId, event.causeType, event.causeId, event.state, event.changedAt, event.createdAt, event.updatedAt, auditId));
      const results = await binding.batch([mutation, audit, ...releases]);
      return results[1]?.meta.changes === 1;
    },
    async listTemplates() {
      const templates = await binding.prepare(`SELECT id, name, lifecycle, affected_audience AS affectedAudience, customer_impact AS customerImpact, what_still_works AS whatStillWorks, details, next_update_offset_minutes AS nextUpdateOffsetMinutes, created_by_operator_id AS createdByOperatorId, created_at AS createdAt, updated_at AS updatedAt FROM incident_templates ORDER BY name COLLATE NOCASE`).all<IncidentTemplateRecord>();
      return Promise.all(templates.results.map(async (template) => ({ ...template, components: (await binding.prepare(`SELECT id, template_id AS templateId, component_id AS componentId, component_name AS componentName, state, relationship, created_at AS createdAt, updated_at AS updatedAt FROM incident_template_components WHERE template_id = ? ORDER BY created_at`).bind(template.id).all<IncidentTemplateComponentRecord>()).results })));
    },
    async saveTemplate(input, components) {
      await binding.batch([
        binding.prepare(`INSERT INTO incident_templates (id,name,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_offset_minutes,created_by_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET lifecycle=excluded.lifecycle,affected_audience=excluded.affected_audience,customer_impact=excluded.customer_impact,what_still_works=excluded.what_still_works,details=excluded.details,next_update_offset_minutes=excluded.next_update_offset_minutes,updated_at=excluded.updated_at`).bind(input.id, input.name, input.lifecycle, input.affectedAudience, input.customerImpact, input.whatStillWorks, input.details, input.nextUpdateOffsetMinutes, input.createdByOperatorId, input.createdAt, input.updatedAt),
        binding.prepare(`DELETE FROM incident_template_components WHERE template_id = (SELECT id FROM incident_templates WHERE name = ? LIMIT 1)`).bind(input.name),
      ]);
      const saved = await binding.prepare(`SELECT id FROM incident_templates WHERE name = ?`).bind(input.name).first<{ id: string }>();
      if (!saved) throw new Error("Incident template could not be saved.");
      if (components.length) await binding.batch(components.map((component) => binding.prepare(`INSERT INTO incident_template_components (id,template_id,component_id,component_name,state,relationship,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(component.id, saved.id, component.componentId, component.componentName, component.state, component.relationship, component.createdAt, component.updatedAt)));
    },
    async findTemplate(templateId) {
      const template = await binding.prepare(`SELECT id, name, lifecycle, affected_audience AS affectedAudience, customer_impact AS customerImpact, what_still_works AS whatStillWorks, details, next_update_offset_minutes AS nextUpdateOffsetMinutes, created_by_operator_id AS createdByOperatorId, created_at AS createdAt, updated_at AS updatedAt FROM incident_templates WHERE id = ?`).bind(templateId).first<IncidentTemplateRecord>();
      if (!template) return null;
      const components = (await binding.prepare(`SELECT id, template_id AS templateId, component_id AS componentId, component_name AS componentName, state, relationship, created_at AS createdAt, updated_at AS updatedAt FROM incident_template_components WHERE template_id = ? ORDER BY created_at`).bind(template.id).all<IncidentTemplateComponentRecord>()).results;
      return { ...template, components };
    },
    async applyTemplate(incidentId, draft, components, expectedVersion) {
      const [expectedId, expectedCount] = expectedVersion.split(":");
      const idExpression = "(SELECT ? WHERE COALESCE((SELECT id FROM incident_drafts WHERE incident_id = ?), '-') = ? AND (SELECT count(*) FROM incident_updates WHERE incident_id = ?) = ?)";
      const idBindings = [draft.id, incidentId, expectedId, incidentId, Number(expectedCount)];
      if (draft.incidentId !== incidentId) throw new Error("Template draft does not belong to this incident.");
      await writeDraftBatch(binding, [
        binding.prepare(`INSERT INTO incident_drafts (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,author_operator_id,created_at,updated_at) VALUES (${idExpression},?,?,?,?,?,?,?,?,?,?) ON CONFLICT(incident_id) DO UPDATE SET id=excluded.id,lifecycle=excluded.lifecycle,affected_audience=excluded.affected_audience,customer_impact=excluded.customer_impact,what_still_works=excluded.what_still_works,details=excluded.details,next_update_at=excluded.next_update_at,author_operator_id=excluded.author_operator_id,updated_at=excluded.updated_at,scheduled_publish_at=NULL,scheduled_channels_json=NULL,reviewed_by_operator_id=NULL,reviewed_at=NULL,corrects_update_id=NULL`).bind(...idBindings, draft.incidentId, draft.lifecycle, draft.affectedAudience, draft.customerImpact, draft.whatStillWorks, draft.details, draft.nextUpdateAt, draft.authorOperatorId, draft.createdAt, draft.updatedAt),
        ...components.map((component) => binding.prepare(`INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(component.id, component.incidentId, component.componentId, component.componentName, component.state, component.relationship, component.createdAt, component.updatedAt)),
      ]);
    },
  };
}
