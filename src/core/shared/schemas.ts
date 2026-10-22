import { z } from "zod";
import { emailBrandingSchema } from "./email-branding";

import { COMPONENT_STATES, INCIDENT_LIFECYCLES } from "./domain";
import { INCIDENT_CLAIM_STATES } from "./incident-component-changes";
import { ulidSchema } from "./ids";

const nonEmptyText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) => z.string().trim().max(maximum);

export const componentStandingClaimSchema = z.object({
  state: z.enum(COMPONENT_STATES).nullable(),
}).strict();

const widgetOriginSchema = z.string().url().refine((value) => {
  const origin = new URL(value);
  return (origin.protocol === "https:" || origin.protocol === "http:") && origin.origin === value;
}, "Widget origins must be http or https origins without a path.");

export const pageSettingsSchema = z.object({
  pageName: nonEmptyText(120),
  tagline: nonEmptyText(280),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "accentColor must be a six-digit hex colour"),
  timezone: nonEmptyText(100),
  hostname: nonEmptyText(253),
  footerCreditEnabled: z.boolean(),
  template: z.enum(["default", "calm", "uptime", "regions"]).optional(),
  widgetAllowedOrigins: z.array(widgetOriginSchema).max(100).optional(),
  mailFromAddress: z.email().optional(),
  emailBranding: emailBrandingSchema.optional(),
  aiToneInstructions: optionalText(2_000).default(""),
  wordingBlockedTerms: z.array(nonEmptyText(100)).max(100).optional(),
  wordingFriendlyLength: z.number().int().min(1).max(500).optional(),
}).strict();

export const componentSchema = z.object({
  groupId: z.string().nullable(),
  name: nonEmptyText(120),
  description: optionalText(500),
  region: optionalText(80).nullable().transform((value) => value || null).optional(),
  internal: z.boolean(),
  onlyShowIfDegraded: z.boolean().optional(),
  uptimeStartDate: z.iso.date().nullable().optional(),
  displayOrder: z.number().int().min(0),
  note: optionalText(250),
}).strict();

export const componentGroupSchema = z.object({
  name: nonEmptyText(120),
  displayOrder: z.number().int().min(0),
}).strict();

// Ordinary edits omit ordering; only an explicit order changes it. Creation still
// requires a selected starting position.
export const componentUpdateSchema = componentSchema.partial({ displayOrder: true });
export const componentGroupUpdateSchema = componentGroupSchema.partial({ displayOrder: true });

export const componentHistoryCorrectionSchema = z.object({
  state: z.enum(COMPONENT_STATES),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  reason: nonEmptyText(500),
}).strict().refine((value) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
  message: "The correction end must be after its start.",
  path: ["endsAt"],
});

export const incidentDraftSchema = z.object({
  lifecycle: z.enum(INCIDENT_LIFECYCLES),
  affectedAudience: optionalText(250),
  customerImpact: optionalText(250),
  whatStillWorks: optionalText(250),
  details: optionalText(500),
  nextUpdateAt: z.iso.datetime().nullable().default(null),
  componentChanges: z.array(z.object({
    componentId: ulidSchema,
    state: z.enum(INCIDENT_CLAIM_STATES),
    relationship: z.enum(["Primary", "Dependent"]).optional(),
  }).strict()).max(200).refine((changes) => new Set(changes.map(change => change.componentId)).size === changes.length, "A component may appear only once.").optional(),
}).strict();
/** The update fields written on the new-incident screen, before the incident (and so any staged component change) exists. */
export const incidentFirstUpdateSchema = incidentDraftSchema.omit({ componentChanges: true });

export type ComponentStandingClaimInput = z.infer<typeof componentStandingClaimSchema>;
export type PageSettingsInput = z.input<typeof pageSettingsSchema>;
export type ComponentInput = z.infer<typeof componentSchema>;
export type ComponentUpdateInput = z.infer<typeof componentUpdateSchema>;
export type ComponentGroupUpdateInput = z.infer<typeof componentGroupUpdateSchema>;
export type ComponentGroupInput = z.infer<typeof componentGroupSchema>;
export type ComponentHistoryCorrectionInput = z.infer<typeof componentHistoryCorrectionSchema>;
export type IncidentDraftInput = z.infer<typeof incidentDraftSchema>;
export type IncidentFirstUpdateInput = z.infer<typeof incidentFirstUpdateSchema>;
