import type { IncidentLifecycle } from "../../shared/domain";

export interface IncidentUpdateRenderInput {
  incidentReference: string;
  incidentTitle: string;
  lifecycle: IncidentLifecycle;
  affectedAudience: string;
  customerImpact: string;
  whatStillWorks: string;
  details: string;
  nextUpdateAt: string | null;
  /** Public and email surfaces supply their configured-zone representation. */
  nextUpdateDisplay?: string | null;
}

export interface RenderedIncidentUpdate {
  public: {
    heading: string;
    lifecycle: IncidentLifecycle;
    fields: Array<{ label: string; value: string; instant?: string }>;
  };
  email: {
    subject: string;
    plainText: string;
  };
}

export function renderIncidentUpdate(input: IncidentUpdateRenderInput): RenderedIncidentUpdate {
  const fields = [
    { label: "Who is affected", value: input.affectedAudience },
    { label: "Customer impact", value: input.customerImpact },
    { label: "What still works", value: input.whatStillWorks },
    ...(input.lifecycle === "Resolved" ? [] : [{ label: "Next update by", value: input.nextUpdateDisplay ?? input.nextUpdateAt ?? "Not yet committed", instant: input.nextUpdateAt ?? undefined }]),
    { label: "Additional details", value: input.details },
  ].filter((field) => field.value.length > 0);
  const heading = `${input.incidentReference}: ${input.incidentTitle}`;

  return {
    public: { heading, lifecycle: input.lifecycle, fields },
    email: {
      subject: `[${input.incidentReference}] ${input.incidentTitle}`,
      plainText: [heading, `Status: ${input.lifecycle}`, ...fields.map((field) => `${field.label}: ${field.value}`)].join("\n\n"),
    },
  };
}
