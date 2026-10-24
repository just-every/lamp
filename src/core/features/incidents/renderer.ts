import type { IncidentLifecycle } from "../../shared/domain";
import type { PublishedIncidentComponentChange } from "../../shared/incident-component-changes";

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
  componentChanges?: PublishedIncidentComponentChange[];
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
    from?: string;
    replyTo?: string;
    logoUrl?: string;
    logoAlt?: string;
  };
}

export function componentChangeLines(changes: PublishedIncidentComponentChange[] = []): string[] {
  return changes.filter(change => !change.internal && change.previousState !== change.newState).map(change => `${change.name}: ${change.previousState} → ${change.newState}`);
}

/** UPDATE-002 uses the same plain wording fields for incident and maintenance notices. */
export function renderImpactWording(input: Pick<IncidentUpdateRenderInput, "affectedAudience" | "customerImpact">) {
  return [
    { label: "Who is affected", value: input.affectedAudience },
    { label: "Customer impact", value: input.customerImpact },
  ];
}

export function renderIncidentUpdate(input: IncidentUpdateRenderInput): RenderedIncidentUpdate {
  const fields = [
    ...renderImpactWording(input),
    { label: "What still works", value: input.whatStillWorks },
    ...(input.lifecycle === "Resolved" ? [] : [{ label: "Next update by", value: input.nextUpdateDisplay ?? input.nextUpdateAt ?? "Not yet committed", instant: input.nextUpdateAt ?? undefined }]),
    { label: "Additional details", value: input.details },
    ...componentChangeLines(input.componentChanges).map(value => ({ label: "Component state", value })),
  ].filter((field) => field.value.length > 0);
  const heading = `${input.incidentReference}: ${input.incidentTitle}`;

  return {
    public: { heading, lifecycle: input.lifecycle, fields },
    email: {
      // A resolution says so in the subject; earlier updates keep the incident's own subject so the thread stays together.
      subject: `[${input.incidentReference}] ${input.lifecycle === "Resolved" ? "Resolved: " : ""}${input.incidentTitle}`,
      plainText: [heading, `Status: ${input.lifecycle}`, ...fields.map((field) => `${field.label}: ${field.value}`)].join("\n\n"),
    },
  };
}
