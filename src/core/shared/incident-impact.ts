import { mostSevereState, type ComponentState } from "./domain";

export const INCIDENT_IMPACTS = ["none", "minor", "major", "critical"] as const;
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number];

export function componentImpact(state: ComponentState): IncidentImpact {
  switch (state) {
    case "Major outage": return "critical";
    case "Partially unavailable": return "major";
    case "Degraded performance": return "minor";
    default: return "none";
  }
}

/** The override never participates in component severity or the retained peak. */
export function incidentImpact(peak: ComponentState | null | undefined, override: IncidentImpact | null | undefined, claims: readonly ComponentState[] = []) {
  const derivedImpact = componentImpact(peak ?? mostSevereState(claims));
  const impactOverride = override ?? null;
  return { derivedImpact, impactOverride, effectiveImpact: impactOverride ?? derivedImpact };
}

export function impactLabel(impact: IncidentImpact): string {
  return impact[0]!.toUpperCase() + impact.slice(1);
}
