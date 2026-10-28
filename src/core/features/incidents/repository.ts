import { readIncidentAgentAttributions } from '../agent-door/incident-attribution.repository';
import type { NativeAttribution } from '../agent-door/provenance.repository';
import { agentAttributionStatements, agentQueuedOperationStatements } from '../agent-door/provenance.repository';
import { createCommunicationOwnerRepository } from "./communication-owner.repository";
import { createUlid } from "../../shared/ids";
import { createIncidentTemplateRepository } from "./template-repository";
import type { IncidentTemplateRecord, IncidentTemplateComponentRecord } from "./template-repository";
export type { IncidentTemplateRecord, IncidentTemplateComponentRecord } from "./template-repository";
import { publishIncidentDraft } from "./publication-repository";
import { loadRecoverySnapshot, type RecoverySnapshot } from "./recovery-repository";
import type { RecoveryCheck } from "../brief/recovery-check";
import { previewComponentChange } from "./component-change-repository";
import { listIncidentRelations, publishingDraft } from "./list-relations";
import { activeIncidentGuard, attachClaimStatements, writeClaimBatch, type AttachedIncidentComponent } from "./component-claims";
import type { UpdateChannel } from "../../shared/domain";
import { and, desc, eq, isNull } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import type { ComponentState } from "../../shared/domain";
import { allocateReference, peekReference } from "../../shared/references/repository";
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

export type PublishingDraft = StoredIncidentDraft & {
  agentAttribution?: NativeAttribution | null;
  agentPreparation?: import("./promise-draft").AgentDraftPreparation | null;
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
  components: StoredIncidentComponent[];
  baselineComponents: StoredIncidentComponent[];
  stagedChanges: import("../../shared/incident-component-changes").StagedIncidentComponent[];
  componentChanges: import("../../shared/incident-component-changes").PublishedIncidentComponentChange[];
  componentSnapshot: import("../../shared/incident-component-changes").PublishedIncidentComponentChange[];
  claimEventCounts?: Record<string, number>;
  claimEvents: ComponentClaimEventInput[];
  historyEntries: ComponentStateHistoryInput[];
  recovery?: { snapshot: string; result: RecoveryCheck; overrideReason: string | null };
  nativeReviewer?: { id: string; at: string };
}

export interface IncidentRepository {
  agentAttributions(ids: string[]): Promise<Map<string,NativeAttribution>>;
  communicationOwners: ReturnType<typeof createCommunicationOwnerRepository>;
  previewComponentChange(incidentId: string, componentId: string): Promise<{ remainingStates: ComponentState[]; emailRecipients: number; webhookRecipients: number }>;
  attachComponent(claim: AttachedIncidentComponent, recipients: D1PreparedStatement[]): Promise<void>;
  detachComponent(incidentId: string, componentId: string, timestamp: string, eventId: string, operatorId: string): Promise<void>;
  listIncidents(): Promise<StoredIncident[]>;
  listRelations(): ReturnType<typeof listIncidentRelations>;
  findIncident(incidentId: string): Promise<StoredIncident | null>;
  loadRecoverySnapshot(incidentId: string): Promise<RecoverySnapshot | null>;
  listComponents(incidentId: string): Promise<StoredIncidentComponent[]>;
  listUpdates(incidentId: string): Promise<StoredIncidentUpdate[]>;
  findPublishingDraft(incidentId: string): Promise<PublishingDraft | null>;
  claimEventCounts(componentIds: string[]): Promise<Record<string, number>>;
  findPeakImpact(incidentId: string): Promise<ComponentState | null>;
  hasRetroactiveUpdate(incidentId: string): Promise<boolean>;
  listInternalNotes(incidentId: string): Promise<Array<typeof incidentInternalNotes.$inferSelect>>;
  addInternalNote(input: typeof incidentInternalNotes.$inferInsert): Promise<void>;
  create(input: Omit<typeof incidents.$inferInsert, "reference">, components: Array<typeof incidentComponents.$inferInsert>, draft: typeof incidentDrafts.$inferInsert): Promise<string>;
  nextReference(): Promise<string>;
  upsertDraft(input: typeof incidentDrafts.$inferInsert, expectedVersion: string): Promise<void>;
  scheduleDraft(incidentId: string, scheduledPublishAt: string | null, channels: Array<UpdateChannel>, updatedAt: string, expectedDraftId?: string, replacementDraftId?: string, expectedUpdateCount?: number): Promise<boolean>;
  reviewDraft(incidentId: string, reviewerOperatorId: string, reviewedAt: string, expectedVersion: string): Promise<boolean>;
  setDraftCorrection(incidentId: string, correctsUpdateId: string, updatedAt: string, expectedVersion: string): Promise<boolean>;
  listDueScheduledDrafts(now: string): Promise<PublishingDraft[]>;
  publishDraft(input: IncidentPublishRecord, recipientStatements: D1PreparedStatement[]): Promise<void>;
  softDelete(incidentId: string, reason: string, operatorId: string, deletedAt: string, auditId: string, claimEvents: ComponentClaimEventInput[]): Promise<boolean>;
  listTemplates(): Promise<Array<IncidentTemplateRecord & { components: IncidentTemplateComponentRecord[] }>>;
  saveTemplate(input: IncidentTemplateRecord, components: IncidentTemplateComponentRecord[]): Promise<void>;
  updateTemplate(input: IncidentTemplateRecord, components: IncidentTemplateComponentRecord[] | undefined, operatorId: string): Promise<void>;
  findTemplate(templateId: string): Promise<(IncidentTemplateRecord & { components: IncidentTemplateComponentRecord[] }) | null>;
  applyTemplate(incidentId: string, draft: StoredIncidentDraft, expectedVersion: string): Promise<void>;
}

export class DraftConflictError extends Error {
  constructor(message = "This draft changed in another tab. Reload to continue with the saved update.") { super(message); }
}

export function createIncidentRepository(binding: D1Database): IncidentRepository {
  const database = createDatabase(binding);
  const asPublishingDraft = publishingDraft;

  return {
    communicationOwners: createCommunicationOwnerRepository(binding),
    agentAttributions: ids => readIncidentAgentAttributions(binding,ids),
    loadRecoverySnapshot: (incidentId) => loadRecoverySnapshot(binding, incidentId),
    listRelations: () => listIncidentRelations(binding),
    previewComponentChange: (incidentId, componentId) => previewComponentChange(binding, incidentId, componentId),
    async attachComponent(claim, recipients) {
      await writeClaimBatch(binding, [
        activeIncidentGuard(binding, claim.incidentId),
        ...attachClaimStatements(binding, claim), ...recipients,
      ]);
    },
    async detachComponent(incidentId, componentId, timestamp, eventId, operatorId) {
      await writeClaimBatch(binding, [
        activeIncidentGuard(binding, incidentId),
        binding.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM incident_components WHERE incident_id = ? AND component_id = ?) THEN 1 ELSE json('Component is not attached') END`).bind(incidentId,componentId),
        binding.prepare(`INSERT INTO component_claim_events (id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at)
          SELECT ?,component_id,'incident',incident_id,NULL,?,?,? FROM incident_components WHERE incident_id = ? AND component_id = ? AND published_at IS NOT NULL`).bind(eventId,timestamp,timestamp,timestamp,incidentId,componentId),
        binding.prepare(`INSERT INTO audit_entries (id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
          SELECT ?, 'incident-component', id, 'deleted', ?, json_object('incidentId', incident_id, 'componentId', component_id), ?, ? FROM incident_components WHERE incident_id = ? AND component_id = ?`)
          .bind(createUlid(), operatorId, timestamp, timestamp, incidentId, componentId),
        binding.prepare(`DELETE FROM incident_components WHERE incident_id = ? AND component_id = ?`).bind(incidentId,componentId),
      ]);
    },
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
      const row = await binding.prepare(`SELECT id, incident_id AS incidentId, lifecycle, affected_audience AS affectedAudience, customer_impact AS customerImpact, what_still_works AS whatStillWorks, details, next_update_at AS nextUpdateAt, author_operator_id AS authorOperatorId, created_at AS createdAt, updated_at AS updatedAt, scheduled_publish_at AS scheduledPublishAt, scheduled_channels_json AS scheduledChannelsJson, reviewed_by_operator_id AS reviewedByOperatorId, reviewed_at AS reviewedAt, corrects_update_id AS correctsUpdateId, component_changes_json AS componentChangesJson, (SELECT preparation_json FROM incident_agent_draft_preparations WHERE draft_id=incident_drafts.id AND active=1) AS agentPreparationJson FROM incident_drafts WHERE incident_id = ?`).bind(incidentId).first<import("./list-relations").DraftRow>();
      return asPublishingDraft(row);
    },
    async claimEventCounts(componentIds) {
      const counts = await Promise.all(componentIds.map(async id => [id, (await binding.prepare("SELECT count(*) AS count FROM component_claim_events WHERE component_id = ?").bind(id).first<{ count: number }>())!.count] as const));
      return Object.fromEntries(counts);
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
      await binding.batch([
        binding.prepare('INSERT INTO incident_internal_notes(id,incident_id,body,author_operator_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(input.id,input.incidentId,input.body,input.authorOperatorId,input.createdAt,input.updatedAt),
        ...agentAttributionStatements(binding,{entityType:'incident-note',entityId:input.id,operatorId:input.authorOperatorId,at:input.createdAt}),
      ]);
    },
    async create(input, attached, draft) {
      const reference = await allocateReference(binding, "INC");
      await binding.batch([
        binding.prepare(`INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,deleted_at,deletion_reason,created_at,updated_at) VALUES (?,?,?,'Investigating',?,NULL,?,NULL,NULL,?,?)`).bind(input.id, reference, input.title, input.openedAt, input.createdByOperatorId, input.createdAt, input.updatedAt),
        ...attached.map((component) => binding.prepare(`INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(component.id, component.incidentId, component.componentId, component.componentName, component.state, component.relationship, component.createdAt, component.updatedAt)),
        binding.prepare(`INSERT INTO incident_drafts (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,author_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(draft.id, draft.incidentId, draft.lifecycle, draft.affectedAudience, draft.customerImpact, draft.whatStillWorks, draft.details, draft.nextUpdateAt ?? null, draft.authorOperatorId, draft.createdAt, draft.updatedAt),
        ...agentAttributionStatements(binding,{entityType:'incident',entityId:input.id,operatorId:input.createdByOperatorId,at:input.createdAt}),
        ...agentAttributionStatements(binding,{entityType:'incident-draft',entityId:draft.id,operatorId:draft.authorOperatorId,at:draft.createdAt}),
      ]);
      return reference;
    },
    nextReference: () => peekReference(binding, "INC"),
    async upsertDraft(input, expectedVersion) {
      const [draftId, count] = expectedVersion.split(":");
      const mutation = binding.prepare(`INSERT INTO incident_drafts (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,author_operator_id,created_at,updated_at,component_changes_json)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE
        COALESCE((SELECT id FROM incident_drafts WHERE incident_id = ?), '-') = ?
        AND (SELECT count(*) FROM incident_updates WHERE incident_id = ?) = ?
        AND EXISTS (SELECT 1 FROM incidents WHERE id = ? AND deleted_at IS NULL)
        ON CONFLICT(incident_id) DO UPDATE SET id=excluded.id,lifecycle=excluded.lifecycle,affected_audience=excluded.affected_audience,customer_impact=excluded.customer_impact,what_still_works=excluded.what_still_works,details=excluded.details,next_update_at=excluded.next_update_at,author_operator_id=excluded.author_operator_id,updated_at=excluded.updated_at,scheduled_publish_at=NULL,scheduled_channels_json=NULL,reviewed_by_operator_id=NULL,reviewed_at=NULL,corrects_update_id=NULL,component_changes_json=excluded.component_changes_json RETURNING id`)
        .bind(input.id,input.incidentId,input.lifecycle,input.affectedAudience,input.customerImpact,input.whatStillWorks,input.details,input.nextUpdateAt,input.authorOperatorId,input.createdAt,input.updatedAt,JSON.stringify(input.componentChanges ?? []),input.incidentId,draftId,input.incidentId,Number(count),input.incidentId);
      const [result] = await binding.batch([
        mutation,
        binding.prepare(`UPDATE incident_agent_draft_preparations SET active=0 WHERE incident_id=? AND changes()=1`).bind(input.incidentId),
        ...agentAttributionStatements(binding,{entityType:'incident-draft',entityId:input.id,operatorId:input.authorOperatorId,at:input.updatedAt,exists:{sql:'EXISTS(SELECT 1 FROM incident_drafts WHERE id=? AND updated_at=?)',params:[input.id,input.updatedAt]}}),
      ]);
      if (!result.results.length) throw new DraftConflictError();
    },
    async scheduleDraft(incidentId, scheduledPublishAt, channels, updatedAt, expectedDraftId, replacementDraftId, expectedUpdateCount) {
      const nextId=replacementDraftId??expectedDraftId;
      const [result]=await binding.batch([
        binding.prepare(`UPDATE incident_drafts SET id=COALESCE(?,id),scheduled_publish_at=?,scheduled_channels_json=?,updated_at=? WHERE incident_id=? AND (? IS NULL OR id=?) AND (? IS NULL OR (SELECT count(*) FROM incident_updates WHERE incident_id=?)=?) RETURNING id`)
          .bind(replacementDraftId??null,scheduledPublishAt,JSON.stringify(channels),updatedAt,incidentId,expectedDraftId??null,expectedDraftId??null,expectedUpdateCount??null,incidentId,expectedUpdateCount??null),
        ...(nextId ? agentQueuedOperationStatements(binding,{kind:'incident-publish',id:nextId,tool:'lamp.updates.dispatch',args:{id:incidentId,version:`${nextId}:${expectedUpdateCount??0}`,idempotency_key:`incident-dispatch/${nextId}`},at:updatedAt,exists:{sql:'EXISTS(SELECT 1 FROM incident_drafts WHERE id=? AND updated_at=?)',params:[nextId,updatedAt]}}) : []),
      ]);
      return Boolean(result.results.length);
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
      const rows = await binding.prepare(`SELECT id, incident_id AS incidentId, lifecycle, affected_audience AS affectedAudience, customer_impact AS customerImpact, what_still_works AS whatStillWorks, details, next_update_at AS nextUpdateAt, author_operator_id AS authorOperatorId, created_at AS createdAt, updated_at AS updatedAt, scheduled_publish_at AS scheduledPublishAt, scheduled_channels_json AS scheduledChannelsJson, reviewed_by_operator_id AS reviewedByOperatorId, reviewed_at AS reviewedAt, corrects_update_id AS correctsUpdateId, component_changes_json AS componentChangesJson FROM incident_drafts WHERE scheduled_publish_at IS NOT NULL AND scheduled_publish_at <= ?`).bind(now).all<import("./list-relations").DraftRow>();
      return rows.results.flatMap((row) => {
        const draft = asPublishingDraft(row);
        return draft ? [draft] : [];
      });
    },
    async publishDraft(input, recipientStatements) {
      try { await publishIncidentDraft(binding, input, recipientStatements); }
      catch (cause) {
        if (cause instanceof Error && (cause.message.includes("malformed JSON") || /NOT NULL constraint failed: incident_updates.id/.test(cause.message))) throw new DraftConflictError("The draft or affected components changed. Reload and review before publishing.");
        throw cause;
      }
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
    ...createIncidentTemplateRepository(binding),
    async applyTemplate(incidentId, draft, expectedVersion) {
      if (draft.incidentId !== incidentId) throw new Error("Template draft does not belong to this incident.");
      await this.upsertDraft(draft, expectedVersion);
    },
  };
}
