export const COMPONENT_STATES = [
  "Operational",
  "Degraded performance",
  "Partially unavailable",
  "Major outage",
  "Under maintenance",
] as const;

export type ComponentState = (typeof COMPONENT_STATES)[number];

export const COMPONENT_STATE_SEVERITY: readonly ComponentState[] = [
  "Major outage",
  "Partially unavailable",
  "Degraded performance",
  "Under maintenance",
  "Operational",
];

export const INCIDENT_LIFECYCLES = ["Investigating", "Identified", "Monitoring", "Resolved"] as const;
export type IncidentLifecycle = (typeof INCIDENT_LIFECYCLES)[number];

export const MAINTENANCE_STATES = ["Scheduled", "In progress", "Completed", "Cancelled"] as const;
export type MaintenanceState = (typeof MAINTENANCE_STATES)[number];

export const SUBSCRIBER_STATES = ["pending", "active", "deactivated"] as const;
export type SubscriberState = (typeof SUBSCRIBER_STATES)[number];

export const DELIVERY_OUTCOMES = ["queued", "delivered", "bounced", "complained", "suppressed", "failed"] as const;
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

export const DELIVERY_CHANNELS = ["email", "webhook"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export function mostSevereState(states: readonly ComponentState[]): ComponentState {
  return COMPONENT_STATE_SEVERITY.find((state) => states.includes(state)) ?? "Operational";
}

/** What an incident update can be sent to: subscriber channels, plus the page's Slack and Teams channels ("chat"). */
export type UpdateChannel = DeliveryChannel | "chat";
