import { incidentImpact, type IncidentImpact } from "../../shared/incident-impact";
import { createIncidentTemplateService, type IncidentTemplateService } from "./template-service";
export type { IncidentTemplateInput } from "./template-schema";
import { stageComponentChoices, publicationComponents, componentChangeRecord } from "./component-staging";
import type { IncidentComponentChoice, IncidentClaimState, PublishedIncidentComponentChange } from "../../shared/incident-component-changes";
import type { UpdateChannel } from "../../shared/domain";
import { mostSevereState, type ComponentState } from "../../shared/domain";
import { createUlid, nowIso } from "../../shared/ids";
import type { IncidentDraftInput, IncidentFirstUpdateInput } from "../../shared/schemas";
import type { LampEventDispatcher } from "../../api/extensions";
import type { ComponentClaimEventInput, ComponentsService, ComponentStateHistoryInput } from "../components";
import { renderIncidentUpdate, type RenderedIncidentUpdate } from "./renderer";
import { defaultUpdateDuePolicy, defaultUpdateReviewPolicy, type UpdateDuePolicy, type UpdateReviewPolicy } from "./policies";
import { updateDueState } from "./reminders";
import { DraftConflictError } from "./repository";
import { checkRecovery, RecoveryCheckError, type RecoveryCheck } from "../brief/recovery-check";
import type { IncidentPublishRecord, IncidentRepository, PublishingDraft, StoredIncident, StoredIncidentComponent, StoredIncidentDraft, StoredIncidentUpdate } from "./repository";

export interface IncidentView extends StoredIncident {
  impact: ComponentState | null;
  derivedImpact: IncidentImpact;
  effectiveImpact: IncidentImpact;
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

export interface IncidentsService extends IncidentTemplateService {
  previewComponentChange(incidentId: string, change: IncidentComponentChange): Promise<IncidentComponentChangePreview>;
  attachComponent(incidentId: string, claim: { componentId: string; state: ComponentState; relationship: "Primary" | "Dependent" }, operatorId: string): Promise<void>;
  detachComponent(incidentId: string, componentId: string, operatorId: string): Promise<void>;
  list(): Promise<IncidentView[]>;
  get(incidentId: string): Promise<IncidentView | null>;
  recoveryCheck(incidentId: string): Promise<RecoveryCheck | null>;
  saveDraft(incidentId: string, input: IncidentDraftInput, operatorId: string, expectedVersion: string, requestedId?: string): Promise<StoredIncidentDraft | null>;
  preview(incidentId: string, input: IncidentDraftInput): Promise<RenderedIncidentUpdate | null>;
  /** The first update of an incident that is not created yet, as it would publish. */
  previewNew(input: { title: string; components: Array<{ componentId: string; state: IncidentClaimState }>; update: IncidentFirstUpdateInput }): Promise<RenderedIncidentUpdate>;
  create(input: { title: string; openedAt?: string; components: Array<{ componentId: string; state: ComponentState; relationship: "Primary" | "Dependent" }>; update?: IncidentFirstUpdateInput }, operatorId: string): Promise<IncidentView>;
  publish(incidentId: string, operatorId: string, input: { channels: Array<UpdateChannel>; publishedAt?: string; componentStates?: Record<string, IncidentClaimState>; expectedVersion: string; overrideReason?: string }): Promise<StoredIncidentUpdate | null>;
  schedule(incidentId: string, operatorId: string, publishAt: string, channels: Array<UpdateChannel>, expectedVersion: string): Promise<PublishingDraft | null>;
  review(incidentId: string, operatorId: string, expectedVersion: string): Promise<boolean>;
  markCorrection(incidentId: string, updateId: string, expectedVersion: string): Promise<boolean>;
  addInternalNote(incidentId: string, body: string, operatorId: string): Promise<boolean>;
  publishDue(now?: string): Promise<{ published: string[]; heldForReview: string[]; heldForRecovery: string[] }>;
  delete(incidentId: string, reason: string, operatorId: string): Promise<string | null>;
  finishPublication(update: StoredIncidentUpdate): Promise<void>;
  finishDeletion(incidentId: string, operatorId: string, deletedAt: string): Promise<void>;
}

export interface IncidentPublicationStatements {
  forAttachedComponents(input: { incidentId: string; attachmentIds: string[]; queuedAt: string }): Promise<D1PreparedStatement[]>;
  forIncidentUpdate(input: { updateId: string; incidentId: string; componentIds: string[]; channels: Array<UpdateChannel>; queuedAt: string }): Promise<D1PreparedStatement[]>;
}

export interface IncidentRuntimeHooks {
  events?: Pick<LampEventDispatcher, "incidentOpened" | "incidentUpdatePublished" | "incidentResolved">;
  /** After publication: dispatch its durable subscriber and channel notifications. */
  afterPublished?: (update: StoredIncidentUpdate) => Promise<void>;
  formatPreviewEmail?: (email: RenderedIncidentUpdate["email"]) => Promise<RenderedIncidentUpdate["email"]>;
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
  return { ...incident, impact, ...incidentImpact(impact, incident.impactOverride), components, updates, draft, internalNotes, ...updateDueState({ lifecycle: incident.lifecycle, nextUpdateAt: updates[0]?.nextUpdateAt ?? null, leadMinutes, now: Date.now() }) };
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
    if (!update.isRetroactive) await componentsService.announceCommittedTransitions(update.componentSnapshot.flatMap(component => component.componentId ? [component.componentId] : []), update.incidentId, update.publishedAt, update.createdAt);
    await onPublicDataChanged();
    await runtime.afterPublished?.(update);
  };

  const finishDeletion = async (incidentId: string, operatorId: string, deletedAt: string) => {
    const components = await repository.listComponents(incidentId);
    await Promise.all(components.flatMap((component) => component.componentId ? [componentsService.recomputePublicState(component.componentId, { type: "incident", id: incidentId, operatorId }, deletedAt)] : []));
    await onPublicDataChanged();
  };
  const publish = async (incidentId: string, operatorId: string, input: { channels: Array<UpdateChannel>; publishedAt?: string; componentStates?: Record<string, IncidentClaimState>; expectedVersion: string; overrideReason?: string }, scheduled = false) => {
    const [incident, draft, baselineComponents] = await Promise.all([repository.findIncident(incidentId), repository.findPublishingDraft(incidentId), repository.listComponents(incidentId)]);
    if (!incident || !draft) return null;
    if (input.expectedVersion.split(":")[0] !== draft.id) throw new DraftConflictError();
    const requestedChoices = new Map<string, IncidentComponentChoice>(draft.componentChanges.map(change => [change.componentId, change]));
    for (const [componentId, state] of Object.entries(input.componentStates ?? {})) requestedChoices.set(componentId, { ...requestedChoices.get(componentId), componentId, state });
    const stagedChanges = input.componentStates ? await stageComponentChoices([...requestedChoices.values()], draft.componentChanges, baselineComponents, componentsService) : draft.componentChanges;
    const components = publicationComponents(incidentId, baselineComponents, stagedChanges, nowIso());
    assertPublishableDraft(draft, components);
    const requiresReview = reviewPolicy.requiresReview({ authorOperatorId: draft.authorOperatorId, draft: { ...draft, componentChanges: stagedChanges } });
    if (requiresReview && JSON.stringify(stagedChanges) !== JSON.stringify(draft.componentChanges)) throw new DraftConflictError("Save and review these component states before publishing.");
    if (requiresReview && !draft.reviewedAt) throw new Error("This update requires review by another operator.");
    if (!publicationStatements) throw new Error("Incident publication requires the notification transaction wiring.");
    const timestamp = nowIso();
    let recovery: IncidentPublishRecord["recovery"];
    if (draft.lifecycle === "Resolved") {
      const evidence = await repository.loadRecoverySnapshot(incidentId);
      if (!evidence) return null;
      const result = checkRecovery(evidence.evidence, timestamp);
      const reason = input.overrideReason?.trim();
      if (reason && reason.length > 1_000) throw new InvalidIncidentUpdateError("An override reason must contain at most 1,000 characters.");
      // Scheduling never grants a future override. Cron evaluates the evidence
      // at execution, using the same authoritative path as an immediate publish.
      if (!result.passed && (scheduled || !reason)) throw new RecoveryCheckError(result);
      recovery = { snapshot: evidence.snapshot, result, overrideReason: !result.passed ? reason! : null };
    }
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
    const claimEventCounts = isRetroactive ? await repository.claimEventCounts(components.flatMap(component => component.componentId ? [component.componentId] : [])) : undefined;
    const componentSnapshot: PublishedIncidentComponentChange[] = await Promise.all(components.map(async component => {
      const current = baselineComponents.find(row => row.id === component.id);
      const previousState = isRetroactive && component.componentId
        ? await componentsService.incidentClaimStateAt(component.componentId, incidentId, publishedAt) ?? "Operational"
        : current?.publishedAt ? current.state : "Operational";
      const metadata = component.componentId ? await componentsService.get(component.componentId) : null;
      const desired = isRetroactive && current?.publishedAt && !stagedChanges.some(change => change.componentId === component.componentId) ? previousState : component.state;
      return { componentId: component.componentId, name: component.componentName, previousState, newState: draft.lifecycle === "Resolved" ? "Operational" : desired, internal: metadata?.internal ?? true };
    }));
    const componentChanges = componentSnapshot.filter(change => change.previousState !== change.newState);
    const claimEvents: ComponentClaimEventInput[] = components.flatMap((component) => component.componentId ? [{
      id: createUlid(),
      componentId: component.componentId,
      causeType: "incident",
      causeId: incidentId,
      state: componentSnapshot.find(change => change.componentId === component.componentId)!.newState === "Operational" ? null : componentSnapshot.find(change => change.componentId === component.componentId)!.newState,
      changedAt: publishedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    }] : []);
    const historyEntries: ComponentStateHistoryInput[] = isRetroactive
      ? (await Promise.all(claimEvents.map((claimEvent) => componentsService.prepareHistoricalStateTransitions({ componentId: claimEvent.componentId, cause: { type: "incident", id: incidentId, operatorId }, claimEvent })))).flat()
      : [];
    const record: IncidentPublishRecord = { id: draft.id, incidentId, lifecycle: draft.lifecycle, affectedAudience: draft.affectedAudience, customerImpact: draft.customerImpact, whatStillWorks: draft.whatStillWorks, details: draft.details, nextUpdateAt: draft.lifecycle === "Resolved" ? null : draft.nextUpdateAt, publishedAt, isRetroactive, authorOperatorId: operatorId, correctsUpdateId: draft.correctsUpdateId, peakImpact, createdAt: timestamp, updatedAt: timestamp, components, baselineComponents, stagedChanges, componentChanges, componentSnapshot, claimEventCounts, claimEvents, historyEntries, recovery };
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
    async recoveryCheck(incidentId) {
      const snapshot = await repository.loadRecoverySnapshot(incidentId);
      return snapshot ? checkRecovery(snapshot.evidence, nowIso()) : null;
    },
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
        return { ...incident, impact, ...incidentImpact(impact, incident.impactOverride), components, updates, draft: relations.drafts.get(incident.id) ?? null, internalNotes: relations.notes.get(incident.id) ?? [], ...updateDueState({ lifecycle: incident.lifecycle, nextUpdateAt: updates[0]?.nextUpdateAt ?? null, leadMinutes, now: Date.now() }) };
      });
    },
    async get(incidentId) {
      const incident = await repository.findIncident(incidentId);
      return incident ? toIncidentView(repository, incident, updateDuePolicy.leadMinutes()) : null;
    },
    async saveDraft(incidentId, input, operatorId, expectedVersion, requestedId) {
      const [incident, currentDraft, currentComponents] = await Promise.all([repository.findIncident(incidentId), repository.findPublishingDraft(incidentId), repository.listComponents(incidentId)]);
      if (!incident) return null;
      const componentChanges = await stageComponentChoices(input.componentChanges ?? currentDraft?.componentChanges ?? [], currentDraft?.componentChanges ?? [], currentComponents, componentsService);
      const timestamp = nowIso();
      const draft: StoredIncidentDraft = {
        id: requestedId ?? createUlid(),
        incidentId,
        ...input,
        componentChanges,
        authorOperatorId: operatorId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await repository.upsertDraft(draft, expectedVersion);
      return draft;
    },
    async preview(incidentId, input) {
      const [incident, currentDraft, attached] = await Promise.all([repository.findIncident(incidentId), repository.findPublishingDraft(incidentId), repository.listComponents(incidentId)]);
      if (!incident) return null;
      const staged = await stageComponentChoices(input.componentChanges ?? currentDraft?.componentChanges ?? [], currentDraft?.componentChanges ?? [], attached, componentsService);
      const proposed = publicationComponents(incidentId, attached, staged, nowIso());
      const componentChanges = (await Promise.all(proposed.map(async component => {
        const current = attached.find(row => row.id === component.id);
        const metadata = component.componentId ? await componentsService.get(component.componentId) : null;
        return componentChangeRecord(component, current?.publishedAt ? current.state : "Operational", input.lifecycle === "Resolved" ? "Operational" : component.state, metadata?.internal ?? true);
      }))).filter((change): change is PublishedIncidentComponentChange => change !== null);
      const nextUpdateDisplay = input.nextUpdateAt ? await runtime.formatPreviewTimestamp?.(input.nextUpdateAt) : null;
      const rendered = renderIncidentUpdate({ incidentReference: incident.reference, incidentTitle: incident.title, ...input, componentChanges, nextUpdateDisplay });
      if (runtime.formatPreviewEmail) rendered.email = await runtime.formatPreviewEmail(rendered.email);
      return rendered;
    },
    async previewNew({ title, components, update }) {
      const matched = await Promise.all(components.map(async (claim) => ({ claim, component: await componentsService.get(claim.componentId) })));
      if (matched.some((item) => !item.component)) throw new Error("One or more attached components no longer exist.");
      // Every attachment is new, so each one changes from Operational unless it is released on publication.
      const componentChanges = matched.map(({ claim, component }) => ({ componentId: component!.id, name: component!.name, previousState: "Operational" as const, newState: update.lifecycle === "Resolved" ? "Operational" as const : claim.state, internal: component!.internal }))
        .filter((change) => change.previousState !== change.newState);
      const nextUpdateDisplay = update.nextUpdateAt ? await runtime.formatPreviewTimestamp?.(update.nextUpdateAt) : null;
      const rendered = renderIncidentUpdate({ incidentReference: await repository.nextReference(), incidentTitle: title, ...update, componentChanges, nextUpdateDisplay });
      if (runtime.formatPreviewEmail) rendered.email = await runtime.formatPreviewEmail(rendered.email);
      return rendered;
    },
    async create(input, operatorId) {
      if (!input.title.trim() || input.title.length > 250) throw new Error("Incident title is required and must be at most 250 characters.");
      if (!input.components.length) throw new Error("Attach at least one component to an incident.");
      const matched = await Promise.all(input.components.map(async (claim) => ({ claim, component: await componentsService.get(claim.componentId) })));
      if (matched.some((item) => !item.component)) throw new Error("One or more attached components no longer exist.");
      const timestamp = nowIso(); const openedAt = input.openedAt ?? timestamp; const id = createUlid();
      const components = matched.map(({ claim, component }) => ({ id: createUlid(), incidentId: id, componentId: claim.componentId, componentName: component!.name, state: claim.state, relationship: claim.relationship, createdAt: timestamp, updatedAt: timestamp }));
      // The first update written beside the title becomes the incident's saved draft; publication still checks it (UPDATE-001).
      const update = input.update ?? { lifecycle: "Investigating", affectedAudience: "", customerImpact: "", whatStillWorks: "", details: "", nextUpdateAt: null };
      const reference = await repository.create({ id, title: input.title.trim(), lifecycle: "Investigating", openedAt, resolvedAt: null, createdByOperatorId: operatorId, deletedAt: null, deletionReason: null, createdAt: timestamp, updatedAt: timestamp }, components, { id: createUlid(), incidentId: id, ...update, nextUpdateAt: update.lifecycle === "Resolved" ? null : update.nextUpdateAt, authorOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp });
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
      assertPublishableDraft(draft, publicationComponents(incidentId, await repository.listComponents(incidentId), draft.componentChanges, nowIso()));
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
      const published: string[] = []; const heldForReview: string[] = []; const heldForRecovery: string[] = [];
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
        catch (cause) {
          if (cause instanceof RecoveryCheckError) { heldForRecovery.push(draft.incidentId); continue; }
          if (cause instanceof DraftConflictError) continue;
          throw new Error(`Scheduled update for ${draft.incidentId} could not be published.`);
        }
      }
      return { published, heldForReview, heldForRecovery };
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
    ...createIncidentTemplateService(repository, componentsService),
    finishPublication,
    finishDeletion,
  };
}
