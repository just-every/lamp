import { z } from "zod";
import type { PresetReading } from "./presets";

export const monitorMappingSchema = z.object({ monitorId: z.string().trim().min(1).max(200), componentId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/) }).strict();
export type MonitorMapping = z.infer<typeof monitorMappingSchema>;
const probe = z.object({ name: z.string(), outcome: z.string(), reason: z.string() }).passthrough();
// run-uptime's default NOTIFY-001 body, not a custom destination template.
const envelope = z.object({ schemaVersion: z.literal(2), id: z.string().min(1), kind: z.enum(["trigger", "recovery"]), eventType: z.enum(["uptime.incident.firing", "uptime.incident.recovered"]), incidentKey: z.string().min(1).max(1000), state: z.enum(["firing", "recovered"]), title: z.string().trim().min(1), monitorId: z.string().min(1).max(200), observedAt: z.number().int().min(0).max(8640000000000000), probes: z.array(probe),
  webhookContext: z.object({ failedAssertion: z.string().optional() }).passthrough().optional(),
  incidentContext: z.object({ confirmedStartedAt: z.number().int().min(0).max(8640000000000000), originalReason: z.string(), failedLocations: z.array(z.object({ probe: z.string(), name: z.string(), reason: z.string() })) }).passthrough().optional(),
}).passthrough();

export function readUptime(payload: unknown): PresetReading {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success) return { refused: "Not Uptime's default signed JSON incident envelope (schema 2)." };
  const event = parsed.data;
  const recovered = event.kind === "recovery";
  if (event.state !== (recovered ? "recovered" : "firing") || event.eventType !== (recovered ? "uptime.incident.recovered" : "uptime.incident.firing")) return { refused: "Uptime's kind, event type and confirmed transition disagree." };
  return { key: JSON.stringify([event.monitorId, event.incidentKey]), monitorId: event.monitorId, title: event.title.trim().slice(0, 250), recovered, state: "Major outage" };
}

export function uptimeEvidence(payload: unknown): string | undefined {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success) return undefined;
  const event = parsed.data;
  const locations = event.incidentContext?.failedLocations;
  const vantages = locations?.length ? locations.map(row => `${row.name} (${row.probe}): ${row.reason}`) : event.probes.map(row => `${row.name}: ${row.outcome} — ${row.reason}`);
  const started = event.incidentContext?.confirmedStartedAt;
  return `Vantages: ${vantages.join("; ") || "not supplied"}. Error category: ${event.webhookContext?.failedAssertion ?? (event.probes.filter(row => row.outcome !== "pass").map(row => row.outcome).join(", ") || "not supplied")}. Confirmed failure time: ${started === undefined ? "not supplied" : new Date(started).toISOString()}.`;
}
