import type { ComponentState } from "./domain";

export const INCIDENT_CLAIM_STATES = ["Major outage", "Partially unavailable", "Degraded performance", "Operational"] as const;
export type IncidentClaimState = typeof INCIDENT_CLAIM_STATES[number];

export interface IncidentComponentChoice {
  componentId: string;
  state: ComponentState;
  relationship?: "Primary" | "Dependent";
}

/** The attachment version that an operator edited, retained through every draft save. */
export interface StagedIncidentComponent extends IncidentComponentChoice {
  state: IncidentClaimState;
  relationship: "Primary" | "Dependent";
  attachmentId: string | null;
  expectedState: ComponentState | null;
  expectedUpdatedAt: string | null;
  componentName: string;
  internal: boolean;
}

export function parsePublishedComponentChanges(value: string | null): PublishedIncidentComponentChange[] {
  if (value === null) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("Published component changes are malformed.");
  return parsed;
}

/** Immutable per-update claim changes, independent of later attachment edits. */
export interface PublishedIncidentComponentChange {
  componentId: string | null;
  name: string;
  previousState: ComponentState;
  newState: ComponentState;
  internal: boolean;
}
