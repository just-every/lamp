import { renderImpactWording, renderIncidentUpdate, type IncidentUpdateRenderInput } from "../features/incidents/renderer";
import { impactLabel, type IncidentImpact } from "./incident-impact";

/** Only notification envelopes include their committed impact in update text. */
export function renderNotificationUpdate(input: IncidentUpdateRenderInput & { incidentImpact: IncidentImpact | null }) {
  const rendered = renderIncidentUpdate(input);
  if (input.incidentImpact === null) return rendered;
  const field = { label: "Incident impact", value: impactLabel(input.incidentImpact) };
  return {
    public: { ...rendered.public, fields: [field, ...rendered.public.fields] },
    email: { ...rendered.email, plainText: `${rendered.email.plainText}\n\n${field.label}: ${field.value}` },
  };
}

/** Freeze each native maintenance notice's wording at publication. Legacy and
 * imported title-only windows have no wording; their content is unchanged. */
export function renderMaintenanceWording(input: { reference: string; title: string; affectedAudience: string | null; customerImpact: string | null }): string {
  const heading = `${input.reference}: ${input.title}`;
  if (input.affectedAudience === null && input.customerImpact === null) return heading;
  if (input.affectedAudience === null || input.customerImpact === null) throw new Error("Maintenance wording must contain both statements.");
  return [heading, ...renderImpactWording({ affectedAudience: input.affectedAudience, customerImpact: input.customerImpact }).map(field => `${field.label}: ${field.value}`)].join("\n\n");
}
