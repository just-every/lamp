import { mostSevereState, type ComponentState } from "../../shared/domain";
import { createUlid, nowIso } from "../../shared/ids";
import type { ComponentGroupInput, ComponentHistoryCorrectionInput, ComponentInput } from "../../shared/schemas";

import type { ComponentClaimEventInput, ComponentHistoryCorrection, ComponentHistoryEntry, ComponentRepository, ComponentStateHistoryInput, StateClaimCause, StoredComponent, StoredComponentGroup } from "./repository";
import { defaultComponentEvents, type ComponentEvents } from "./events";

export type ComponentView = StoredComponent & {
  groupName: string | null;
  publicState: ComponentState;
  standingClaimState: ComponentState | null;
};

export type ComponentHistoryView = {
  history: ComponentHistoryEntry[];
  corrections: ComponentHistoryCorrection[];
};

export interface ComponentsService {
  list(): Promise<ComponentView[]>;
  listGroups(): Promise<StoredComponentGroup[]>;
  history(componentId: string): Promise<ComponentHistoryView | null>;
  get(componentId: string): Promise<ComponentView | null>;
  create(input: ComponentInput, operatorId: string): Promise<ComponentView>;
  update(componentId: string, input: ComponentInput): Promise<ComponentView | null>;
  remove(componentId: string): Promise<boolean>;
  createGroup(input: ComponentGroupInput): Promise<{ id: string; name: string; displayOrder: number }>;
  updateGroup(groupId: string, input: ComponentGroupInput): Promise<boolean>;
  removeGroup(groupId: string): Promise<boolean>;
  setStandingClaim(componentId: string, state: ComponentState | null, operatorId: string): Promise<ComponentView | null>;
  correctHistory(componentId: string, input: ComponentHistoryCorrectionInput, operatorId: string): Promise<void>;
  canReconstructHistoricalState(componentId: string, instant: string): Promise<boolean>;
  prepareHistoricalStateTransitions(input: { componentId: string; cause: StateClaimCause; claimEvent: ComponentClaimEventInput }): Promise<ComponentStateHistoryInput[]>;
  recomputePublicState(componentId: string, cause: StateClaimCause, changedAt?: string): Promise<ComponentState>;
}

async function toView(repository: ComponentRepository, component: StoredComponent & { groupName: string | null }): Promise<ComponentView> {
  const [claims, standingClaimState] = await Promise.all([
    repository.listClaims(component.id),
    repository.findStandingClaimState(component.id),
  ]);
  return { ...component, publicState: mostSevereState(claims), standingClaimState };
}

export function createComponentsService(
  repository: ComponentRepository,
  onPublicDataChanged: () => Promise<void>,
  events: ComponentEvents = defaultComponentEvents,
): ComponentsService {
  const recomputePublicState = async (componentId: string, cause: StateClaimCause, changedAt?: string) => {
    const [previous, claims] = await Promise.all([repository.findLastState(componentId), repository.listClaims(componentId)]);
    const next = mostSevereState(claims);
    if (previous !== next) {
      const timestamp = nowIso();
      await repository.appendStateHistory({
        id: createUlid(),
        componentId,
        previousState: previous ?? "Operational",
        newState: next,
        cause,
        changedAt: changedAt ?? timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await events.componentStatusChanged({
        componentId,
        previousState: previous ?? "Operational",
        state: next,
        changedAt: changedAt ?? timestamp,
        cause: cause.type,
      });
    }
    return next;
  };

  return {
    async list() {
      return Promise.all((await repository.listComponents()).map((component) => toView(repository, component)));
    },
    async listGroups() {
      return repository.listGroups();
    },
    async history(componentId) {
      if (!await repository.findComponent(componentId)) return null;
      const [history, corrections] = await Promise.all([repository.listHistory(componentId), repository.listCorrections(componentId)]);
      return { history, corrections };
    },
    async get(componentId) {
      const component = await repository.findComponent(componentId);
      if (!component) return null;
      return toView(repository, { ...component, groupName: null });
    },
    async create(input, operatorId) {
      const timestamp = nowIso();
      const id = createUlid();
      const cause = { type: "standing-claim" as const, id: null, operatorId };
      await repository.insertComponent(
        { id, ...input, createdAt: timestamp, updatedAt: timestamp },
        {
          event: { id: createUlid(), componentId: id, causeType: "standing-claim", causeId: null, state: "Operational", changedAt: timestamp, createdAt: timestamp, updatedAt: timestamp },
          history: { id: createUlid(), componentId: id, previousState: "Operational", newState: "Operational", cause, changedAt: timestamp, createdAt: timestamp, updatedAt: timestamp },
        },
      );
      await events.componentStatusChanged({ componentId: id, previousState: "Operational", state: "Operational", changedAt: timestamp, cause: cause.type });
      await onPublicDataChanged();
      const component = await repository.findComponent(id);
      if (!component) throw new Error("Created component could not be read.");
      return toView(repository, { ...component, groupName: null });
    },
    async update(componentId, input) {
      const updated = await repository.updateComponent(componentId, { ...input, updatedAt: nowIso() });
      if (!updated) return null;
      await onPublicDataChanged();
      const component = await repository.findComponent(componentId);
      return component ? toView(repository, { ...component, groupName: null }) : null;
    },
    async remove(componentId) {
      const removed = await repository.deleteComponent(componentId);
      if (removed) await onPublicDataChanged();
      return removed;
    },
    async createGroup(input) {
      const timestamp = nowIso();
      const group = { id: createUlid(), ...input };
      await repository.insertGroup({ ...group, createdAt: timestamp, updatedAt: timestamp });
      await onPublicDataChanged();
      return group;
    },
    async updateGroup(groupId, input) {
      const updated = await repository.updateGroup(groupId, { ...input, updatedAt: nowIso() });
      if (updated) await onPublicDataChanged();
      return updated;
    },
    async removeGroup(groupId) {
      const removed = await repository.deleteGroup(groupId);
      if (removed) await onPublicDataChanged();
      return removed;
    },
    async setStandingClaim(componentId, state, operatorId) {
      const component = await repository.findComponent(componentId);
      if (!component) return null;

      const timestamp = nowIso();
      await repository.replaceStandingClaim({
        id: createUlid(),
        componentId,
        state,
        operatorId,
        createdAt: timestamp,
        updatedAt: timestamp,
        event: { id: createUlid(), componentId, causeType: "standing-claim", causeId: null, state, changedAt: timestamp, createdAt: timestamp, updatedAt: timestamp },
      });
      await recomputePublicState(componentId, { type: "standing-claim", id: null, operatorId });
      await onPublicDataChanged();
      return toView(repository, { ...component, groupName: null });
    },
    async correctHistory(componentId, input, operatorId) {
      const component = await repository.findComponent(componentId);
      if (!component) throw new Error("Component not found.");
      if (new Date(input.endsAt).getTime() > Date.now()) throw new Error("A history correction must describe a closed interval.");
      const timestamp = nowIso();
      const historyId = createUlid();
      const previousState = (await repository.findStateAt(componentId, input.startsAt)) ?? "Operational";
      await repository.appendStateHistory({
        id: historyId,
        componentId,
        previousState,
        newState: input.state,
        cause: { type: "correction", id: null, operatorId },
        changedAt: input.startsAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await repository.appendCorrection({
        id: createUlid(),
        componentId,
        historyId,
        state: input.state,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason,
        operatorId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await repository.appendCorrectionAudit({
        id: createUlid(),
        historyId,
        operatorId,
        reason: input.reason,
        payloadJson: JSON.stringify({ componentId, state: input.state, startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason }),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await onPublicDataChanged();
    },
    async canReconstructHistoricalState(componentId, instant) {
      return !(await repository.hasUnprovenClaimHistorySince(componentId, instant));
    },
    async prepareHistoricalStateTransitions({ componentId, cause, claimEvent }) {
      const startsAt = claimEvent.changedAt;
      const timestamp = nowIso();
      const [baseline, eventTimes, existingHistory] = await Promise.all([
        repository.findStateBefore(componentId, startsAt),
        repository.listClaimEventTimes(componentId, startsAt, timestamp),
        repository.listHistoryBetween(componentId, startsAt, timestamp),
      ]);
      const times = [...new Set([...eventTimes, claimEvent.changedAt])].sort();
      const existingBoundaries = new Set(existingHistory.map((entry) => entry.changedAt));
      const entries: ComponentStateHistoryInput[] = [];
      let previous = baseline ?? "Operational";
      for (const changedAt of times) {
        const claims = await repository.listClaimEventsAt(componentId, changedAt);
        const recordedTarget = claims.find((entry) => entry.causeType === claimEvent.causeType && entry.causeId === claimEvent.causeId);
        const selectedTarget = !recordedTarget || claimEvent.changedAt.localeCompare(recordedTarget.changedAt) > 0
          || (claimEvent.changedAt === recordedTarget.changedAt && (claimEvent.createdAt.localeCompare(recordedTarget.createdAt) > 0
            || (claimEvent.createdAt === recordedTarget.createdAt && claimEvent.id.localeCompare(recordedTarget.id) > 0)))
          ? claimEvent
          : recordedTarget;
        const nextClaims = [
          ...claims.filter((entry) => entry.causeType !== claimEvent.causeType || entry.causeId !== claimEvent.causeId).flatMap((entry) => entry.state ? [entry.state] : []),
          ...(selectedTarget.state ? [selectedTarget.state] : []),
        ];
        const next = mostSevereState(nextClaims);
        if (previous !== next || existingBoundaries.has(changedAt)) {
          entries.push({
            id: createUlid(),
            componentId,
            previousState: previous,
            newState: next,
            cause,
            changedAt,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
        previous = next;
      }
      return entries;
    },
    recomputePublicState,
  };
}
