import { z } from "zod";
import type { LabelMatcher } from "./grouped-alerts";

export function isOperationsPreset(value: unknown): value is "jsm" | "opsgenie" { return value === "jsm" || value === "opsgenie"; }
const text = z.string().max(2000);
const envelope = z.object({
  action: z.enum(["Create", "Acknowledge", "AddNote", "Escalate", "Close"]),
  alert: z.object({ alertId: z.string().min(1).max(200), message: text.optional(), tags: z.array(text).max(200).optional(), entity: text.optional(),
    username: text.optional(), userId: text.optional(), note: z.string().min(1).max(25000).optional(), updatedAt: z.union([z.number(), z.string()]).optional() }).passthrough(),
  escalationNotify: z.object({ name: text, entity: text, type: text }).passthrough().optional(),
}).passthrough();

/** Outgoing Webhook action data, shared by JSM Operations and Opsgenie.
 * Escalate deliberately accepts the documented sparse alertId-only envelope. */
export function readOperations(payload: unknown) {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success) return { refused: "Expected JSM or Opsgenie alert action data with an alertId." };
  const { action, alert, escalationNotify } = parsed.data;
  if (action === "Create" && !alert.message?.trim()) return { refused: "Create needs the alert message." };
  if (action === "AddNote" && !alert.note) return { refused: "AddNote needs alert.note." };
  return { key: alert.alertId, title: alert.message?.trim().slice(0, 250) || "Responder alert", state: "Major outage" as const,
    recovered: action === "Close", action, tags: alert.tags ?? [], entity: alert.entity, note: alert.note,
    actor: alert.username || alert.userId, escalationNotify };
}

export function operationsComponents(reading: Exclude<ReturnType<typeof readOperations>, { refused: string }>, matchers: LabelMatcher[]) {
  return [...new Set(matchers.filter(row => Object.entries(row.labels).every(([key, value]) =>
    key === "tag" ? reading.tags.includes(value) : key === "entity" && reading.entity === value)).map(row => row.componentId))];
}

export function operationsEvidence(payload: unknown, receivedAt: string) {
  const reading = readOperations(payload);
  if ("refused" in reading || reading.action === "AddNote") return undefined;
  const actor = reading.action === "Escalate" && reading.escalationNotify
    ? `Escalation target: ${reading.escalationNotify.name} (${reading.escalationNotify.entity}, ${reading.escalationNotify.type})`
    : `Responder: ${reading.actor || "not supplied"}; provider role not supplied`;
  return `${reading.action} received at ${receivedAt}. ${actor}.`;
}
