import { GROUPED_PRESETS } from "./grouped-alerts";
import { z } from "zod";
import type { ComponentState } from "../../shared/domain";

/** Monitoring tools Lamp reads in their own documented alert shape. Each
 * parser accepts only that shape; anything else is refused and recorded.
 * Shapes: Datadog webhook variables (docs.datadoghq.com/integrations/webhooks),
 * UptimeRobot webhook JSON variables (help.uptimerobot.com, webhook integration),
 * Better Stack incident webhook (betterstack.com/docs/uptime/webhooks, incident object),
 * Pingdom state change webhook (pingdom.com state change webhooks). */
export const ALERT_PRESETS = ["datadog", "uptimerobot", "betterstack", "pingdom", ...GROUPED_PRESETS] as const;
export type AlertPreset = (typeof ALERT_PRESETS)[number];
export type PresetReading = { key: string; title: string; recovered: boolean; state: ComponentState } | { refused: string };

const text = z.string().max(2000);
const id = z.union([z.string().min(1).max(200), z.number().int()]).transform(String);

const datadog = z.object({ alert_id: id, alert_transition: z.string(), alert_cycle_key: z.string().max(200).optional(), alert_title: text.optional(), event_title: text.optional() }).passthrough();
const datadogFiring = new Set(["Triggered", "Re-Triggered", "No Data", "Re-No Data", "Warn", "Re-Warn", "Renotify"]);
const uptimerobot = z.object({ monitorID: id, alertType: z.union([z.string(), z.number()]).transform(String), monitorFriendlyName: text.optional(), alertDetails: text.optional() }).passthrough();
const betterstack = z.object({ data: z.object({ id, type: z.literal("incident"), attributes: z.object({ name: text.nullable().optional(), cause: text.nullable().optional(), status: z.string(), resolved_at: z.string().nullable().optional() }).passthrough() }).passthrough() }).passthrough();
const pingdom = z.object({ check_id: id, check_name: text, current_state: z.string(), previous_state: z.string().optional(), description: text.optional() }).passthrough();

const title = (value: string | null | undefined, fallback: string) => (value ?? "").trim().slice(0, 250) || fallback;

export function readPreset(preset: AlertPreset, payload: unknown): PresetReading {
  if (preset === "datadog") {
    const parsed = datadog.safeParse(payload);
    if (!parsed.success) return { refused: "Not a Datadog alert in the documented webhook template." };
    const transition = parsed.data.alert_transition;
    if (transition !== "Recovered" && !datadogFiring.has(transition)) return { refused: `Datadog transition '${transition.slice(0, 40)}' is not an alert state.` };
    return { key: parsed.data.alert_cycle_key || parsed.data.alert_id, title: title(parsed.data.alert_title ?? parsed.data.event_title, "Datadog monitor alert"), recovered: transition === "Recovered", state: transition.endsWith("Warn") ? "Degraded performance" : "Major outage" };
  }
  if (preset === "uptimerobot") {
    const parsed = uptimerobot.safeParse(payload);
    if (!parsed.success) return { refused: "Not an UptimeRobot webhook alert." };
    if (parsed.data.alertType !== "1" && parsed.data.alertType !== "2") return { refused: "UptimeRobot sent a certificate or domain expiry notice, not an outage." };
    return { key: parsed.data.monitorID, title: title(parsed.data.monitorFriendlyName ? `${parsed.data.monitorFriendlyName} is down` : null, "UptimeRobot monitor down"), recovered: parsed.data.alertType === "2", state: "Major outage" };
  }
  if (preset === "betterstack") {
    const parsed = betterstack.safeParse(payload);
    if (!parsed.success) return { refused: "Not a Better Stack incident webhook." };
    const { status, resolved_at, name, cause } = parsed.data.data.attributes;
    if (!["Started", "Acknowledged", "Resolved"].includes(status)) return { refused: `Better Stack status '${status.slice(0, 40)}' is not an incident state.` };
    return { key: parsed.data.data.id, title: title(name && cause ? `${name}: ${cause}` : name, "Better Stack incident"), recovered: status === "Resolved" || Boolean(resolved_at), state: "Major outage" };
  }
  const parsed = pingdom.safeParse(payload);
  if (!parsed.success) return { refused: "Not a Pingdom state change webhook." };
  if (!["UP", "DOWN"].includes(parsed.data.current_state)) return { refused: `Pingdom state '${parsed.data.current_state.slice(0, 40)}' is not UP or DOWN.` };
  return { key: parsed.data.check_id, title: title(`${parsed.data.check_name} is down`, "Pingdom check down"), recovered: parsed.data.current_state === "UP", state: "Major outage" };
}

/** What a Datadog monitor's webhook payload field holds: Datadog fills each documented variable. */
export const datadogPayloadTemplate = JSON.stringify({ alert_id: "$ALERT_ID", alert_cycle_key: "$ALERT_CYCLE_KEY", alert_transition: "$ALERT_TRANSITION", alert_title: "$ALERT_TITLE", event_title: "$EVENT_TITLE", date: "$DATE", link: "$LINK" }, null, 2);
// UptimeRobot replaces each *variable* in its webhook's "POST value (JSON format)" before sending.
export const uptimeRobotPayloadTemplate = JSON.stringify({ monitorID: "*monitorID*", monitorFriendlyName: "*monitorFriendlyName*", monitorURL: "*monitorURL*", alertType: "*alertType*", alertDetails: "*alertDetails*" }, null, 2);
export const presetLabels: Record<AlertPreset, string> = { datadog: "Datadog", uptimerobot: "UptimeRobot", betterstack: "Better Stack", pingdom: "Pingdom", alertmanager: "Prometheus Alertmanager", grafana: "Grafana Alerting" };
