import { renderIncidentUpdate, type IncidentUpdateRenderInput } from "../features/incidents/renderer";
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
