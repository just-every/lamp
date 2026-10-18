import { z } from "zod";

export const GROUPED_PRESETS = ["alertmanager", "grafana"] as const;
export type GroupedPreset = (typeof GROUPED_PRESETS)[number];
export interface LabelMatcher { componentId: string; labels: Record<string, string>; }
export const labelMatcherSchema = z.object({
  componentId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  labels: z.record(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/), z.string().max(500)).refine(labels => Object.keys(labels).length > 0 && Object.keys(labels).length <= 20, "Supply 1–20 labels."),
}).strict();
const labels = z.record(z.string(), z.string().max(2000));
const alert = z.object({ fingerprint: z.string().min(1).max(250), status: z.enum(["firing", "resolved"]), labels, annotations: labels.optional(), startsAt: z.string().optional(), endsAt: z.string().optional() }).passthrough();
const envelope = z.object({ version: z.union([z.literal("4"), z.literal(4)]).optional(), groupKey: z.string().min(1).max(2000), status: z.enum(["firing", "resolved"]), alerts: z.array(alert).min(1), truncatedAlerts: z.number().int().nonnegative().optional() }).passthrough();
export type GroupedReading = { key: string; title: string; alerts: Array<{ fingerprint: string; state: "firing" | "resolved"; componentIds: string[] }> };
export function isGroupedPreset(preset: string | null | undefined): preset is GroupedPreset { return preset === "alertmanager" || preset === "grafana"; }

/** Alertmanager v4 and Grafana's default webhook use the same group/alert identity.
 * A notification can contain a mix of firing and resolved alerts. */
export function readGroupedAlerts(preset: GroupedPreset, payload: unknown, matchers: LabelMatcher[]): GroupedReading | { refused: string } {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success || (preset === "alertmanager" && parsed.data.version !== "4" && parsed.data.version !== 4)) return { refused: `Not a ${preset === "grafana" ? "Grafana Alerting" : "version 4 Alertmanager"} grouped webhook with alert fingerprints.` };
  if (parsed.data.truncatedAlerts) return { refused: "The group was truncated. Set the contact point's maximum alerts to 0 (unlimited) so every fingerprint can be tracked." };
  const unique = new Set(parsed.data.alerts.map(item => item.fingerprint));
  if (unique.size !== parsed.data.alerts.length) return { refused: "A grouped webhook repeats an alert fingerprint." };
  const alerts = parsed.data.alerts.map(item => ({ fingerprint: item.fingerprint, state: item.status, componentIds: [...new Set(matchers.filter(matcher => Object.entries(matcher.labels).every(([key, value]) => item.labels[key] === value)).map(matcher => matcher.componentId))] }));
  const first = parsed.data.alerts[0];
  return { key: parsed.data.groupKey, title: (first.annotations?.summary || first.labels.alertname || `${preset === "grafana" ? "Grafana" : "Alertmanager"} alert group`).trim().slice(0, 250), alerts };
}

/** Exact label equality; multiple labels on a row are AND, rows are OR. */
export function parseLabelExpression(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  let remaining = value.trim();
  while (remaining) {
    const match = remaining.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|[^,\s]+)\s*(,\s*|$)/);
    if (!match || Object.hasOwn(result, match[1])) throw new Error('Use exact labels such as service="api", region="us-east".');
    result[match[1]] = match[2].startsWith('"') ? JSON.parse(match[2]) as string : match[2];
    remaining = remaining.slice(match[0].length);
  }
  if (!Object.keys(result).length) throw new Error("Supply at least one label matcher.");
  return result;
}
