import { createUlid } from "../../shared/ids";
import type { IncidentComponentChoice, StagedIncidentComponent, PublishedIncidentComponentChange } from "../../shared/incident-component-changes";
import { INCIDENT_CLAIM_STATES, type IncidentClaimState } from "../../shared/incident-component-changes";
import type { ComponentsService } from "../components";
import { DraftConflictError, type StoredIncidentComponent } from "./repository";

export async function stageComponentChoices(choices: IncidentComponentChoice[], previous: StagedIncidentComponent[], current: StoredIncidentComponent[], components: ComponentsService): Promise<StagedIncidentComponent[]> {
  if (new Set(choices.map(choice => choice.componentId)).size !== choices.length) throw new Error("A component may appear only once.");
  return Promise.all(choices.map(async choice => {
    if (!(INCIDENT_CLAIM_STATES as readonly string[]).includes(choice.state)) throw new Error("Choose an incident claim state, rather than maintenance.");
    const component = await components.get(choice.componentId);
    if (!component) throw new Error("An affected component no longer exists.");
    const prior = previous.find(change => change.componentId === choice.componentId);
    const attached = current.find(row => row.componentId === choice.componentId);
    return {
      ...choice,
      state: choice.state as IncidentClaimState,
      relationship: choice.relationship ?? prior?.relationship ?? attached?.relationship ?? "Primary",
      attachmentId: prior ? prior.attachmentId : attached?.id ?? null,
      expectedState: prior ? prior.expectedState : attached?.state ?? null,
      expectedUpdatedAt: prior ? prior.expectedUpdatedAt : attached?.updatedAt ?? null,
      componentName: component.name,
      internal: component.internal,
    };
  }));
}

export function assertStagedComponents(changes: StagedIncidentComponent[], current: StoredIncidentComponent[]) {
  for (const change of changes) {
    const attached = current.find(row => row.componentId === change.componentId);
    if (change.attachmentId === null ? Boolean(attached) : !attached || attached.id !== change.attachmentId || attached.state !== change.expectedState || attached.updatedAt !== change.expectedUpdatedAt) {
      throw new DraftConflictError("An affected component changed after this draft was staged. Reload and review the component changes.");
    }
  }
}

export function publicationComponents(incidentId: string, current: StoredIncidentComponent[], changes: StagedIncidentComponent[], timestamp: string): StoredIncidentComponent[] {
  assertStagedComponents(changes, current);
  const result = current.map(row => {
    const change = changes.find(change => change.attachmentId === row.id);
    return change ? { ...row, state: change.state, relationship: change.relationship } : row;
  });
  for (const change of changes.filter(change => change.attachmentId === null)) result.push({
    id: createUlid(), incidentId, componentId: change.componentId, componentName: change.componentName,
    state: change.state, relationship: change.relationship, publishedAt: null, createdAt: timestamp, updatedAt: timestamp,
  });
  return result;
}

export function componentChangeRecord(component: StoredIncidentComponent, previousState: PublishedIncidentComponentChange["previousState"], newState: PublishedIncidentComponentChange["newState"], internal: boolean): PublishedIncidentComponentChange | null {
  return previousState === newState ? null : { componentId: component.componentId, name: component.componentName, previousState, newState, internal };
}
