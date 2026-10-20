import { z } from "zod";
import { constantTimeEqual } from "../../platform/security/opaque-tokens";
import type { LabelMatcher } from "./grouped-alerts";

const eventTypes = ["incident.triggered", "incident.acknowledged", "incident.escalated", "incident.resolved"] as const;
const envelope = z.object({ event: z.object({
  event_type: z.enum(eventTypes), agent: z.object({ summary: z.string().max(2000).optional(), type: z.string().max(200).optional() }).passthrough().nullable().optional(), occurred_at: z.string().datetime({ offset: true }),
  data: z.object({ id: z.string().min(1).max(200), title: z.string().max(2000),
    service: z.object({ id: z.string().min(1).max(200), summary: z.string().max(2000).optional(), name: z.string().max(2000).optional() }).passthrough(),
  }).passthrough(),
}).passthrough() }).passthrough();

export function readPagerDuty(payload: unknown) {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success) return { refused: "Expected a PagerDuty v3 incident.triggered, incident.acknowledged, incident.escalated or incident.resolved event with incident, service and event time." };
  const event = parsed.data.event;
  return { key: event.data.id, title: event.data.title.trim().slice(0, 250) || "PagerDuty incident", recovered: event.event_type === "incident.resolved", state: "Major outage" as const,
    action: event.event_type, occurredAt: event.occurred_at, actor: event.agent?.summary ?? event.agent?.type,
    labels: { service_id: event.data.service.id, service_name: event.data.service.summary ?? event.data.service.name ?? "" } };
}
export function pagerDutyComponents(labels: Record<string, string>, matchers: LabelMatcher[]) {
  return [...new Set(matchers.filter(row => Object.entries(row.labels).every(([key, value]) => labels[key] === value)).map(row => row.componentId))];
}

/** Verify the subscription signature over received bytes, before JSON decoding. */
export async function verifyPagerDuty(secret: string, body: Uint8Array<ArrayBuffer>, header: string | null) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, body)), byte => byte.toString(16).padStart(2, "0")).join("");
  let matched = 0;
  for (const entry of (header ?? "").split(",")) {
    const value = entry.trim().match(/^v1=([0-9a-fA-F]{64})$/)?.[1];
    if (value) matched |= Number(constantTimeEqual(expected, value.toLowerCase()));
  }
  return matched !== 0;
}
export function pagerDutyEvidence(payload: unknown): string | undefined {
  const reading = readPagerDuty(payload);
  if ("refused" in reading) return undefined;
  return `PagerDuty ${reading.action.slice("incident.".length)} at ${reading.occurredAt}${reading.actor ? ` (${reading.actor})` : ""}.`;
}
