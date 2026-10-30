import { COMPONENT_STATE_SEVERITY, type ComponentState } from "../../../shared/domain";

/** What holds the public state above the operator's own setting (Automatic counts as Operational). A maintenance window
 * claims Under maintenance and Lamp's incident updates claim the other states (INCIDENT_CLAIM_STATES), so the raised
 * state names its source. Null while the public state is the operator's own. */
export function publicStateSource(component: { publicState: ComponentState; standingClaimState: ComponentState | null }): "incident" | "maintenance" | null {
  const own = component.standingClaimState ?? "Operational";
  if (COMPONENT_STATE_SEVERITY.indexOf(component.publicState) >= COMPONENT_STATE_SEVERITY.indexOf(own)) return null;
  return component.publicState === "Under maintenance" ? "maintenance" : "incident";
}
