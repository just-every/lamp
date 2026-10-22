import { presetLabels, type AlertPreset } from "../presets";
import type { AlertSourceEndpointView } from "../service";

export type ToolId = AlertPreset | "webhook";
export type Source = AlertSourceEndpointView;
export type ComponentOption = { id: string; name: string };

/** The tools the picker offers, in its order. Each states what it does in one line and opens only its own form. */
export const TOOLS: Array<{ id: ToolId; pick: string; does: string }> = [
  { id: "uptime", pick: "Uptime", does: "Uptime's alerts open drafts on the components you pick." },
  { id: "pagerduty", pick: "PagerDuty", does: "PagerDuty incidents open drafts on the services you map." },
  { id: "datadog", pick: "Datadog", does: "Datadog monitor alerts open drafts on one component." },
  { id: "uptimerobot", pick: "UptimeRobot", does: "UptimeRobot alerts open drafts on one component." },
  { id: "betterstack", pick: "Better Stack", does: "Better Stack incidents open drafts on one component." },
  { id: "pingdom", pick: "Pingdom", does: "Pingdom check alerts open drafts on one component." },
  { id: "alertmanager", pick: "Alertmanager", does: "Each alert group opens one draft on the components its labels match." },
  { id: "grafana", pick: "Grafana", does: "Each alert group opens one draft on the components its labels match." },
  { id: "webhook", pick: "Another tool", does: "Any tool that posts JSON opens drafts here." },
];

export const toolLabel = (tool: ToolId) => tool === "webhook" ? "Another tool" : presetLabels[tool];
export const toolDoes = (tool: ToolId) => TOOLS.find(row => row.id === tool)!.does;
export const toolOf = (source: Source): ToolId => source.preset ?? "webhook";

/** The address a tool posts to when it carries its key in the URL (every preset accepts it as the last path segment). */
export const keyedAddress = (source: Source, token: string) => `${source.endpointUrl}/${token}`;
