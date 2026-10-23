import { z } from "zod";

export const eventKinds = ["incidents", "maintenance", "components"] as const;
export type SubscriberEventKind = (typeof eventKinds)[number];
export const preferencesSchema = z.object({
  eventKinds: z.array(z.enum(eventKinds)).max(3).transform(values => [...new Set(values)]),
  minimumImpact: z.literal("Partially unavailable").nullable().default(null),
});
export type SubscriberPreferences = z.infer<typeof preferencesSchema>;
export function defaultPreferences(channel: string): SubscriberPreferences {
  return { eventKinds: channel === "webhook" ? ["incidents", "maintenance", "components"] : ["incidents", "maintenance"], minimumImpact: null };
}
export function storedPreferences(input: { eventKindsJson: string; minimumImpact: string | null }): SubscriberPreferences {
  return preferencesSchema.parse({ eventKinds: JSON.parse(input.eventKindsJson), minimumImpact: input.minimumImpact });
}
export function formPreferences(body: Record<string, unknown>): SubscriberPreferences | undefined {
  if (body.preferencesPresent === undefined && body.eventKind === undefined && body.minimumImpact === undefined) return undefined;
  const values = body.eventKind === undefined ? [] : Array.isArray(body.eventKind) ? body.eventKind : [body.eventKind];
  return preferencesSchema.parse({ eventKinds: values, minimumImpact: body.minimumImpact || null });
}
export function renderPreferenceFields(preferences: SubscriberPreferences = defaultPreferences("email")): string {
  const labels: Record<SubscriberEventKind, string> = { incidents: "Incidents", maintenance: "Maintenance", components: "Component status changes" };
  return `<input type="hidden" name="preferencesPresent" value="1"><fieldset class="subscription-preferences"><legend>Updates to receive</legend>${eventKinds.map(kind => `<label><input type="checkbox" name="eventKind" value="${kind}"${preferences.eventKinds.includes(kind) ? " checked" : ""}> ${labels[kind]}</label>`).join("")}<label><input type="checkbox" name="minimumImpact" value="Partially unavailable"${preferences.minimumImpact ? " checked" : ""}> Only incidents reaching Partially unavailable or worse</label></fieldset>`;
}
