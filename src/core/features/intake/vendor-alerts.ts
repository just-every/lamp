import { z } from "zod";
import type { LabelMatcher } from "./grouped-alerts";

export const VENDOR_PRESETS = ["jsm", "opsgenie", "newrelic"] as const;
export type OperationsPreset = "jsm" | "opsgenie";
export const isOperationsPreset = (preset: unknown): preset is OperationsPreset => preset === "jsm" || preset === "opsgenie";
const value = z.string().min(1).max(2000);
const alert = z.object({ action: z.enum(["Create", "Acknowledge", "AddNote", "Escalate", "Close"]),
  alert: z.object({ alertId: value, message: value, tags: z.array(z.string().max(500)).max(200).default([]), entity: z.string().max(500).optional(), note: z.string().max(10000).optional(), createdAt: z.number().finite().optional(), updatedAt: z.number().finite().optional(), affectedServices: z.array(z.union([z.string().max(500), z.object({ id: value, name: z.string().max(500).optional() })])).max(200).default([]) }).passthrough(),
  note: z.union([z.string().max(10000), z.object({ note: z.string().max(10000) })]).optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
  source: z.object({ name: z.string().max(500).optional(), type: z.string().max(200).optional(), role: z.string().max(200).optional() }).passthrough().optional(),
}).passthrough();

/** The outgoing Webhook integration alert envelope shared by Opsgenie and JSM
 * Operations. AddNote is deliberately kept out of every model input. */
export function readOperationsAlert(payload: unknown) {
  const parsed = alert.safeParse(payload);
  if (!parsed.success) return { refused: "Expected a JSM Operations or Opsgenie alert webhook with action, alertId and message." };
  const event = parsed.data;
  const note = event.alert.note ?? (typeof event.note === "string" ? event.note : event.note?.note);
  if (event.action === "AddNote" && !note?.trim()) return { refused: "AddNote requires note text." };
  return { key: event.alert.alertId, title: event.alert.message.trim().slice(0, 250), recovered: event.action === "Close", state: "Major outage" as const,
    action: event.action, occurredAt: event.timestamp ?? operationTime(event.alert.updatedAt ?? event.alert.createdAt), actor: event.source?.name, role: event.source?.role ?? event.source?.type ?? "responder",
    tags: event.alert.tags, entity: event.alert.entity ?? "", services: event.alert.affectedServices.flatMap(service => typeof service === "string" ? [service] : [service.id, ...(service.name ? [service.name] : [])]),
    note };
}
function operationTime(value: number | undefined) {
  if (value === undefined) return undefined;
  // The Webhook integration uses epoch milliseconds for createdAt and epoch
  // nanoseconds for updatedAt. Only millisecond precision is displayed.
  const date = new Date(value >= 1e15 ? Math.floor(value / 1e6) : value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
export function operationsComponents(reading: Exclude<ReturnType<typeof readOperationsAlert>, { refused: string }>, matchers: LabelMatcher[]) {
  return [...new Set(matchers.filter(row => Object.entries(row.labels).every(([key, expected]) => key === "tag" ? reading.tags.includes(expected) : key === "entity" ? reading.entity === expected : key === "affected_service" && reading.services.includes(expected))).map(row => row.componentId))];
}
export function operationsEvidence(preset: OperationsPreset, payload: unknown, receivedAt: string) {
  const reading = readOperationsAlert(payload);
  if ("refused" in reading || reading.action === "AddNote") return undefined;
  return `${preset === "jsm" ? "JSM Operations" : "Opsgenie"} ${reading.action} at ${reading.occurredAt ?? receivedAt} (${reading.role}${reading.actor ? `: ${reading.actor}` : ""}).`;
}
/** Only safe, named evidence reaches the brief, never an arbitrary webhook field. */
export function operationsBriefPayload(payload: unknown, receivedAt: string) {
  const reading = readOperationsAlert(payload);
  if ("refused" in reading || reading.action === "AddNote") return null;
  return { action: reading.action, alert: { alertId: reading.key, message: reading.title }, timestamp: reading.occurredAt ?? receivedAt, source: { type: reading.role, ...(reading.actor ? { name: reading.actor } : {}) } };
}
export function atlassianSite(input: string) {
  const url = new URL(input);
  if (url.protocol !== "https:" || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.atlassian\.net$/i.test(url.hostname) || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Use your HTTPS *.atlassian.net site without a path.");
  return url.origin;
}
