import type { UpdateChannel } from "../../shared/domain";
import { mostSevereState, type ComponentState, type IncidentLifecycle } from "../../shared/domain";
import { createUlid, nowIso } from "../../shared/ids";
import type { IncidentDraftInput } from "../../shared/schemas";
import type { LampEventDispatcher } from "../../api/extensions";
import type { ComponentClaimEventInput, ComponentsService, ComponentStateHistoryInput } from "../components";
import { renderIncidentUpdate, type RenderedIncidentUpdate } from "./renderer";
import { defaultUpdateDuePolicy, defaultUpdateReviewPolicy, type UpdateDuePolicy, type UpdateReviewPolicy } from "./policies";
import { updateDueState } from "./reminders";
import { DraftConflictError } from "./repository";
import type { IncidentPublishRecord, IncidentRepository, IncidentTemplateComponentRecord, IncidentTemplateRecord, PublishingDraft, StoredIncident, StoredIncidentComponent, StoredIncidentDraft, StoredIncidentUpdate } from "./repository";

export interface IncidentView extends StoredIncident {
  impact: ComponentState | null;
  components: StoredIncidentComponent[];
  updates: StoredIncidentUpdate[];
  draft: PublishingDraft | null;
  internalNotes: Array<{ id: string; body: string; createdAt: string; updatedAt: string; authorOperatorId: string }>;
  /** The committed next-update time once it is within the update-due lead or has passed. */
  updateDueAt: string | null;
  /** Within the lead before the committed time (INCIDENT-010). */
  updateDue: boolean;
  /** The committed time has passed with no newer update (INCIDENT-006). */
  overdue: boolean;
}

export class InvalidIncidentUpdateError extends Error {}

export type IncidentComponentChange =
  | { action: "attach"; componentId: string; state: ComponentState; relationship: "Primary" | "Dependent" }
  | { action: "detach"; componentId: string };

export interface IncidentComponentChangePreview {
  published: boolean;
  componentName: string;
  internal: boolean;
  previousState: ComponentState;
  nextState: ComponentState;
  emailRecipients: number;
  webhookRecipients: number;
}

export interface IncidentsService {
  previewComponentChange(incidentId: string, change: IncidentComponentChange): Promise<IncidentComponentChangePreview>;
  attachComponent(incidentId: string, claim: { componentId: string; state: ComponentState; relationship: "Primary" | "Dependent" }, operatorId: string): Promise<void>;
  detachComponent(incidentId: string, componentId: string, operatorId: string): Promise<void>;
  list(): Promise<IncidentView[]>;
  get(incidentId: string): Promise<IncidentView | null>;
  saveDraft(incidentId: string, input: IncidentDraftInput, operatorId: string, expectedVersion: string, requestedId?: string): Promise<StoredIncidentDraft | null>;
  preview(incidentId: string, input: IncidentDraftInput): Promise<RenderedIncidentUpdate | null>;
  create(input: { title: string; openedAt?: string; components: Array<{ componentId: string; state: ComponentState; relationship: "Primary" | "Dependent" }> }, operatorId: string): Promise<IncidentView>;
  publish(incidentId: string, operatorId: string, input: { channels: Array<UpdateChannel>; publishedAt?: string; expectedVersion: string }): Promise<StoredIncidentUpdate | null>;
  schedule(incidentId: string, operatorId: string, publishAt: string, channels: Array<UpdateChannel>, expectedVersion: string): Promise<PublishingDraft | null>;
  review(incidentId: string, operatorId: string, expectedVersion: string): Promise<boolean>;
  markCorrection(incidentId: string, updateId: string, expectedVersion: string): Promise<boolean>;
  addInternalNote(incidentId: string, body: string, operatorId: string): Promise<boolean>;
  publishDue(now?: string): Promise<{ published: string[]; heldForReview: string[] }>;
  delete(incidentId: string, reason: string, operatorId: string): Promise<string | null>;
  listTemplates(): Promise<Array<IncidentTemplateRecord & { components: IncidentTemplateComponentRecord[] }>>;
  saveTemplate(input: IncidentTemplateInput, operatorId: string): Promise<IncidentTemplateRecord & { components: IncidentTemplateComponentRecord[] }>;
  applyTemplate(incidentId: string, templateId: string, operatorId: string, expectedVersion: string): Promise<StoredIncidentDraft | null>;
  finishPublication(update: StoredIncidentUpdate): Promise<void>;
  finishDeletion(incidentId: string, operatorId: string, deletedAt: string): Promise<void>;
}

export interface IncidentTemplateInput {
  name: string;
  lifecycle: IncidentLifecycle;
  affectedAudience: string;
  customerImpact: string;
  whatStillWorks: string;
  details: string;
  nextUpdateOffsetMinutes: number;
  components: Array<{ componentId: string; state: ComponentState; relationship: "Primary" | "Dependent" }>;
}

export interface IncidentPublicationStatements {
  forAttachedComponents(input: { incidentId: string; attachmentIds: string[]; queuedAt: string }): Promise<D1PreparedStatement[]>;
  forIncidentUpdate(input: { updateId: string; incidentId: string; componentIds: string[]; channels: Array<UpdateChannel>; queuedAt: string }): Promise<D1PreparedStatement[]>;
}

export interface IncidentRuntimeHooks {
  events?: Pick<LampEventDispatcher, "incidentOpened" | "incidentUpdatePublished" | "incidentResolved">;
  /** After publication: dispatch its durable subscriber and channel notifications. */
  afterPublished?: (update: StoredIncidentUpdate) => Promise<void>;
  formatPreviewSubject?: (subject: string) => Promise<string> | string;
  formatPreviewTimestamp?: (timestamp: string) => Promise<string> | string;
}

export interface ScheduledReviewAlertEvent {
  incidentId: string;
  draftId: string;
  scheduledPublishAt: string;
}

async function toIncidentView(repository: IncidentRepository, incident: StoredIncident, leadMinutes: number): Promise<IncidentView> {
  const [components, updates, draft, internalNotes, peakImpact] = await Promise.all([
    repository.listComponents(incident.id),
    repository.listUpdates(incident.id),
    repository.findPublishingDraft(incident.id),
    repository.listInternalNotes(incident.id),
    repository.findPeakImpact(incident.id),
  ]);
  const impact = peakImpact ?? (components.length === 0 ? null : mostSevereState(components.map((component) => component.state)));
  return { ...incident, impact, components, updates, draft, internalNotes, ...updateDueState({ lifecycle: incident.lifecycle, nextUpdateAt: updates[0]?.nextUpdateAt ?? null, leadMinutes, now: Date.now() }) };
}

function assertPublishableDraft(draft: PublishingDraft, components: StoredIncidentComponent[]) {
  if (!components.length) throw new InvalidIncidentUpdateError("Attach at least one component before publishing.");
  if (!draft.affectedAudience.trim() || !draft.customerImpact.trim()) throw new InvalidIncidentUpdateError("Who is affected and customer impact are required.");
  if (draft.lifecycle !== "Resolved" && (!draft.nextUpdateAt || !Number.isFinite(Date.parse(draft.nextUpdateAt)))) throw new InvalidIncidentUpdateError("Active updates require a valid next update time.");
  if (draft.affectedAudience.length > 250 || draft.customerImpact.length > 250 || draft.whatStillWorks.length > 250 || draft.details.length > 500) throw new InvalidIncidentUpdateError("The update exceeds its template limits.");
}

export function createIncidentsService(
  repository: IncidentRepository,
  componentsService: ComponentsService,
  onPublicDataChanged: () => Promise<void>,
  publicationStatements: IncidentPublicationStatements | null = null,
  reviewPolicy: UpdateReviewPolicy = defaultUpdateReviewPolicy,
  onScheduledReviewHeld: (event: ScheduledReviewAlertEvent) => Promise<void>,
  updateDuePolicy: UpdateDuePolicy = defaultUpdateDuePolicy,
  runtime: IncidentRuntimeHooks = {},
): IncidentsService {
  const finishPublication = async (update: StoredIncidentUpdate) => {
    const components = await repository.listComponents(update.incidentId);
    const cause = { type: "incident" as const, id: update.incidentId, operatorId: update.authorOperatorId };
    await Promise.all(components.flatMap((component) => component.componentId ? [componentsService.recomputePublicState(component.componentId, cause, update.isRetroactive ? undefined : update.publishedAt)] : []));
    await onPublicDataChanged();
    await runtime.afterPublished?.(update);
  };

  const finishDeletion = async (incidentId: string, operatorId: string, deletedAt: string) => {
    const components = await repository.listComponents(incidentId);
    await Promise.all(components.flatMap((component) => component.componentId ? [componentsService.recomputePublicState(component.componentId, { type: "incident", id: incidentId, operatorId }, deletedAt)] : []));
    await onPublicDataChanged();
  };
  const publish = async (incidentId: string, operatorId: string, input: { channels: Array<UpdateChannel>; publishedAt?: string; expectedVersion: string }, scheduled = false) => {
    const [incident, draft, components] = await Promise.all([repository.findIncident(incidentId), repository.findPublishingDraft(incidentId), repository.listComponents(incidentId)]);
    if (!incident || !draft) return null;
    if (input.expectedVersion.split(":")[0] !== draft.id) throw new DraftConflictError();
    assertPublishableDraft(draft, components);
    if (reviewPolicy.requiresReview({ authorOperatorId: draft.authorOperatorId, draft }) && !draft.reviewedAt) throw new Error("This update requires review by another operator.");
    if (!publicationStatements) throw new Error("Incident publication requires the notification transaction wiring.");
    const timestamp = nowIso();
    const publishedAt = input.publishedAt ?? timestamp;
    const isRetroactive = !scheduled && Boolean(input.publishedAt && new Date(input.publishedAt).getTime() < new Date(timestamp).getTime());
    if (isRetroactive) {
      const reconstructable = await Promise.all(components.flatMap((component) => component.componentId ? [componentsService.canReconstructHistoricalState(component.componentId, publishedAt)] : []));
      if (reconstructable.some((allowed) => !allowed)) throw new Error("A retroactive update cannot reconstruct a component's state history before claim provenance was recorded.");
    }
    const [historicalImpact, hasRetroactiveUpdate] = await Promise.all([
      repository.findPeakImpact(incidentId),
      repository.hasRetroactiveUpdate(incidentId),
    ]);
    const peakImpact = mostSevereState([historicalImpact ?? "Operational", ...components.map((component) => component.state)]);
    const claimEvents: ComponentClaimEventInput[] = components.flatMap((component) => component.componentId ? [{
      id: createUlid(),
      componentId: component.componentId,
      causeType: "incident",
      causeId: incidentId,
      state: draft.lifecycle === "Resolved" ? null : component.state,
      changedAt: publishedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    }] : []);
    const historyEntries: ComponentStateHistoryInput[] = isRetroactive
      ? (await Promise.all(claimEvents.map((claimEvent) => componentsService.prepareHistoricalStateTransitions({ componentId: claimEvent.componentId, cause: { type: "incident", id: incidentId, operatorId }, claimEvent })))).flat()
      : [];
    const record: IncidentPublishRecord = { id: draft.id, incidentId, lifecycle: draft.lifecycle, affectedAudience: draft.affectedAudience, customerImpact: draft.customerImpact, whatStillWorks: draft.whatStillWorks, details: draft.details, nextUpdateAt: draft.lifecycle === "Resolved" ? null : draft.nextUpdateAt, publishedAt, isRetroactive, authorOperatorId: operatorId, correctsUpdateId: draft.correctsUpdateId, peakImpact, createdAt: timestamp, updatedAt: timestamp, components, claimEvents, historyEntries };
    const channels = isRetroactive || hasRetroactiveUpdate ? [] : input.channels;
    const recipientStatements = await publicationStatements.forIncidentUpdate({ updateId: record.id, incidentId, componentIds: components.flatMap((component) => component.componentId ? [component.componentId] : []), channels, queuedAt: publishedAt });
    await repository.publishDraft(record, recipientStatements);
    const update = (await repository.listUpdates(incidentId)).find((candidate) => candidate.id === record.id) ?? null;
    if (!update) return null;
    await runtime.events?.incidentUpdatePublished({ incidentId, updateId: update.id, lifecycle: update.lifecycle, publishedAt: update.publishedAt });
    if (update.lifecycle === "Resolved") await runtime.events?.incidentResolved({ incidentId, updateId: update.id, resolvedAt: update.publishedAt });
    return update;
  };

  return {
    async previewComponentChange(incidentId, change) {
      const [incident, component, attached, updates] = await Promise.all([
        repository.findIncident(incidentId), componentsService.get(change.componentId),
        repository.listComponents(incidentId), repository.listUpdates(incidentId),
      ]);
      if (!incident || incident.lifecycle === "Resolved") throw new Error("Only an unresolved incident can change its affected components.");
      if (!component) throw new Error("Component not found.");
      const exists = attached.some((claim) => claim.componentId === component.id);
      if (change.action === "attach" ? exists : !exists) throw new Error(change.action === "attach" ? "Component is already attached." : "Component is not attached.");
      const published = updates.length > 0;
      const preview = await repository.previewComponentChange(incidentId, component.id);
      return {
        published, componentName: component.name, internal: component.internal,
        previousState: component.publicState,
        nextState: !published ? component.publicState : change.action === "attach"
          ? mostSevereState([component.publicState, change.state]) : mostSevereState(preview.remainingStates),
        emailRecipients: change.action === "attach" && published ? preview.emailRecipients : 0,
        webhookRecipients: change.action === "attach" && published ? preview.webhookRecipients : 0,
      };
    },
    async attachComponent(incidentId, claim, operatorId) {
      const [incident, component] = await Promise.all([repository.findIncident(incidentId), componentsService.get(claim.componentId)]);
      if (!incident || incident.lifecycle === "Resolved") throw new Error("Only an unresolved incident can change its affected components.");
      if (!component) throw new Error("Component not found.");
      const timestamp = nowIso();
      const attached = { id: createUlid(), incidentId, componentId: component.id, componentName: component.name, state: claim.state, relationship: claim.relationship, createdAt: timestamp, updatedAt: timestamp };
      if (!publicationStatements) throw new Error("Incident notification capture is unavailable.");
      await repository.attachComponent(attached, await publicationStatements.forAttachedComponents({ incidentId, attachmentIds: [attached.id], queuedAt: timestamp }));
      await componentsService.recomputePublicState(component.id, { type: "incident", id: incidentId, operatorId });
      await onPublicDataChanged();
    },
    async detachComponent(incidentId, componentId, operatorId) {
      await repository.detachComponent(incidentId, componentId, nowIso(), createUlid());
      await componentsService.recomputePublicState(componentId, { type: "incident", id: incidentId, operatorId });
      await onPublicDataChanged();
    },
    // Reading incidents never sends mail: reminders come from the scheduled trigger.
    async list() {
      const [incidents, relations] = await Promise.all([repository.listIncidents(), repository.listRelations()]);
      const leadMinutes = updateDuePolicy.leadMinutes();
      return incidents.map(incident => {
        const components = relations.components.get(incident.id) ?? [];
        const updates = relations.updates.get(incident.id) ?? [];
        const impact = relations.impacts.get(incident.id) ?? (components.length ? mostSevereState(components.map(component => component.state)) : null);
        return { ...incident, impact, components, updates, draft: relations.drafts.get(incident.id) ?? null, internalNotes: relations.notes.get(incident.id) ?? [], ...updateDueState({ lifecycle: incident.lifecycle, nextUpdateAt: updates[0]?.nextUpdateAt ?? null, leadMinutes, now: Date.now() }) };
      });
    },
    async get(incidentId) {
      const incident = await repository.findIncident(incidentId);
      return incident ? toIncidentView(repository, incident, updateDuePolicy.leadMinutes()) : null;
    },
    async saveDraft(incidentId, input, operatorId, expectedVersion, requestedId) {
      const incident = await repository.findIncident(incidentId);
      if (!incident) return null;
      const timestamp = nowIso();
      const draft: StoredIncidentDraft = {
        id: requestedId ?? createUlid(),
        incidentId,
        ...input,
        authorOperatorId: operatorId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await repository.upsertDraft(draft, expectedVersion);
      return draft;
    },
    async preview(incidentId, input) {
      const incident = await repository.findIncident(incidentId);
      if (!incident) return null;
      const nextUpdateDisplay = input.nextUpdateAt ? await runtime.formatPreviewTimestamp?.(input.nextUpdateAt) : null;
      const rendered = renderIncidentUpdate({ incidentReference: incident.reference, incidentTitle: incident.title, ...input, nextUpdateDisplay });
      if (runtime.formatPreviewSubject) rendered.email.subject = await runtime.formatPreviewSubject(rendered.email.subject);
      return rendered;
    },
    async create(input, operatorId) {
      if (!input.title.trim() || input.title.length > 250) throw new Error("Incident title is required and must be at most 250 characters.");
      if (!input.components.length) throw new Error("Attach at least one component to an incident.");
      const matched = await Promise.all(input.components.map(async (claim) => ({ claim, component: await componentsService.get(claim.componentId) })));
      if (matched.some((item) => !item.component)) throw new Error("One or more attached components no longer exist.");
      const timestamp = nowIso(); const openedAt = input.openedAt ?? timestamp; const id = createUlid();
      const components = matched.map(({ claim, component }) => ({ id: createUlid(), incidentId: id, componentId: claim.componentId, componentName: component!.name, state: claim.state, relationship: claim.relationship, createdAt: timestamp, updatedAt: timestamp }));
      const reference = await repository.create({ id, title: input.title.trim(), lifecycle: "Investigating", openedAt, resolvedAt: null, createdByOperatorId: operatorId, deletedAt: null, deletionReason: null, createdAt: timestamp, updatedAt: timestamp }, components, { id: createUlid(), incidentId: id, lifecycle: "Investigating", affectedAudience: "", customerImpact: "", whatStillWorks: "", details: "", nextUpdateAt: null, authorOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp });
      await runtime.events?.incidentOpened({ incidentId: id, reference, openedAt });
      return (await this.get(id))!;
    },
    publish,
    async schedule(incidentId, operatorId, publishAt, channels, expectedVersion) {
      const draft = await repository.findPublishingDraft(incidentId);
      if (!draft) return null;
      if (expectedVersion.split(":")[0] !== draft.id) throw new DraftConflictError();
      if (draft.authorOperatorId !== operatorId) throw new Error("Only the draft author can schedule this update.");
      if (new Date(publishAt).getTime() <= Date.now()) throw new Error("Scheduled publish time must be in the future.");
      assertPublishableDraft(draft, await repository.listComponents(incidentId));
      const replacementId = createUlid(); const updatedAt = nowIso();
      if (!await repository.scheduleDraft(incidentId, publishAt, channels, updatedAt, draft.id, replacementId)) throw new DraftConflictError();
      return { ...draft, id: replacementId, scheduledPublishAt: publishAt, scheduledChannels: channels, updatedAt };
    },
    async review(incidentId, operatorId, expectedVersion) { return repository.reviewDraft(incidentId, operatorId, nowIso(), expectedVersion); },
    async markCorrection(incidentId, updateId, expectedVersion) { return repository.setDraftCorrection(incidentId, updateId, nowIso(), expectedVersion); },
    async addInternalNote(incidentId, body, operatorId) {
      if (!(await repository.findIncident(incidentId))) return false;
      if (!body.trim() || body.length > 5_000) throw new Error("Internal note must contain at most 5,000 characters.");
      const timestamp = nowIso();
      await repository.addInternalNote({ id: createUlid(), incidentId, body: body.trim(), authorOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp });
      return true;
    },
    async publishDue(now = nowIso()) {
      const due = await repository.listDueScheduledDrafts(now);
      const published: string[] = []; const heldForReview: string[] = [];
      for (const draft of due) {
        if (reviewPolicy.requiresReview({ authorOperatorId: draft.authorOperatorId, draft }) && !draft.reviewedAt) {
          heldForReview.push(draft.incidentId);
          await onScheduledReviewHeld({ incidentId: draft.incidentId, draftId: draft.id, scheduledPublishAt: draft.scheduledPublishAt ?? now });
          continue;
        }
        try {
          const update = await publish(draft.incidentId, draft.authorOperatorId, { channels: draft.scheduledChannels, publishedAt: draft.scheduledPublishAt ?? now, expectedVersion: `${draft.id}:scheduled` }, true);
          if (update) {
            await finishPublication(update);
            published.push(draft.incidentId);
          }
        }
        catch (cause) { if (cause instanceof DraftConflictError) continue; throw new Error(`Scheduled update for ${draft.incidentId} could not be published.`); }
      }
      return { published, heldForReview };
    },
    async delete(incidentId, reason, operatorId) {
      if (!reason.trim()) throw new Error("A deletion reason is required.");
      const deletedAt = nowIso();
      const components = await repository.listComponents(incidentId);
      const claimEvents: ComponentClaimEventInput[] = components.flatMap((component) => component.componentId && component.publishedAt ? [{
        id: createUlid(),
        componentId: component.componentId,
        causeType: "incident",
        causeId: incidentId,
        state: null,
        changedAt: deletedAt,
        createdAt: deletedAt,
        updatedAt: deletedAt,
      }] : []);
      if (!(await repository.softDelete(incidentId, reason.trim(), operatorId, deletedAt, createUlid(), claimEvents))) return null;
      return deletedAt;
    },
    listTemplates: () => repository.listTemplates(),
    async saveTemplate(input, operatorId) {
      if (!input.name.trim() || input.name.length > 120) throw new Error("Template name is required and must be at most 120 characters.");
      if (!Number.isInteger(input.nextUpdateOffsetMinutes) || input.nextUpdateOffsetMinutes < 1 || input.nextUpdateOffsetMinutes > 7 * 24 * 60) throw new Error("Template next-update offset must be between 1 minute and 7 days.");
      if (!input.components.length) throw new Error("A template must attach at least one component.");
      if (!input.affectedAudience.trim() || !input.customerImpact.trim()) throw new Error("A template needs affected audience and customer impact.");
      if (input.affectedAudience.length > 250 || input.customerImpact.length > 250 || input.whatStillWorks.length > 250 || input.details.length > 500) throw new Error("The template exceeds update field limits.");
      const records = await Promise.all(input.components.map(async (claim) => ({ claim, component: await componentsService.get(claim.componentId) })));
      if (records.some(({ component }) => !component)) throw new Error("A template component no longer exists.");
      const timestamp = nowIso(); const id = createUlid();
      await repository.saveTemplate({ id, name: input.name.trim(), lifecycle: input.lifecycle, affectedAudience: input.affectedAudience.trim(), customerImpact: input.customerImpact.trim(), whatStillWorks: input.whatStillWorks.trim(), details: input.details.trim(), nextUpdateOffsetMinutes: input.nextUpdateOffsetMinutes, createdByOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp }, records.map(({ claim, component }) => ({ id: createUlid(), templateId: id, componentId: claim.componentId, componentName: component!.name, state: claim.state, relationship: claim.relationship, createdAt: timestamp, updatedAt: timestamp })));
      return (await repository.listTemplates()).find((template) => template.name === input.name.trim())!;
    },
    async applyTemplate(incidentId, templateId, operatorId, expectedVersion) {
      const [incident, template] = await Promise.all([repository.findIncident(incidentId), repository.findTemplate(templateId)]);
      if (!incident || !template) return null;
      if (template.nextUpdateOffsetMinutes === null) throw new Error("Template has no next-update offset.");
      const templateComponents = await Promise.all(template.components.map(async (claim) => ({ claim, component: claim.componentId ? await componentsService.get(claim.componentId) : null })));
      if (templateComponents.some(({ component }) => !component)) throw new Error("A template component no longer exists.");
      const timestamp = nowIso(); const current = await repository.listComponents(incidentId);
      const newComponents = templateComponents.filter(({ claim }) => !current.some((attached) => attached.componentId === claim.componentId)).map(({ claim, component }) => ({ id: createUlid(), incidentId, componentId: claim.componentId!, componentName: component!.name, state: claim.state, relationship: claim.relationship, createdAt: timestamp, updatedAt: timestamp }));
      const draft: StoredIncidentDraft = { id: createUlid(), incidentId, lifecycle: template.lifecycle, affectedAudience: template.affectedAudience, customerImpact: template.customerImpact, whatStillWorks: template.whatStillWorks, details: template.details, nextUpdateAt: new Date(Date.now() + template.nextUpdateOffsetMinutes * 60_000).toISOString(), authorOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp };
      await repository.applyTemplate(incidentId, draft, newComponents, expectedVersion);
      return draft;
    },
    finishPublication,
    finishDeletion,
  };
}
