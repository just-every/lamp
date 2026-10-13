import { z } from "zod";

export const instatusId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const text = z.string().max(20_000);
const time = z.string().datetime({ offset: true });
const nullableText = text.nullable().optional();
export const componentStatus = z.enum(["OPERATIONAL", "UNDERMAINTENANCE", "DEGRADEDPERFORMANCE", "PARTIALOUTAGE", "MAJOROUTAGE"]);
const incidentStatus = z.enum(["INVESTIGATING", "IDENTIFIED", "MONITORING", "RESOLVED"]);
const maintenanceStatus = z.enum(["NOTSTARTEDYET", "INPROGRESS", "COMPLETED"]);
const componentFields = {
  id: instatusId, name: text, description: nullableText, status: componentStatus.optional(),
  order: z.number().int().nullable().optional(), isParent: z.boolean().optional(),
  groupId: instatusId.nullable().optional(), createdAt: time.optional(), updatedAt: time.optional(),
  archivedAt: time.nullable().optional(), siteId: instatusId.optional(),
};
// Recursive parent fields are inspected explicitly, with a bounded nesting depth.
export const componentSchema = z.object({ ...componentFields, group: z.unknown().optional() }).passthrough();
const componentRef = z.object({ id: instatusId, status: componentStatus.optional() }).passthrough();
const updateFields = {
  id: instatusId, message: text, started: time, ended: time.nullable().optional(),
  duration: z.number().int().nonnegative().nullable().optional(), createdAt: time.optional(), updatedAt: time.optional(),
  notify: z.boolean().optional(),
};
export const incidentUpdateSchema = z.object({ ...updateFields, status: incidentStatus }).passthrough();
export const maintenanceUpdateSchema = z.object({ ...updateFields, status: maintenanceStatus }).passthrough();
export const incidentSchema = z.object({
  id: instatusId, name: text, status: incidentStatus, started: time, resolved: time.nullable().optional(),
  updates: z.array(incidentUpdateSchema), components: z.array(componentRef),
}).passthrough();
export const maintenanceSchema = z.object({
  id: instatusId, name: text, status: maintenanceStatus, start: time, end: time.nullable().optional(),
  duration: z.number().int().nonnegative().nullable().optional(), autoEnd: z.boolean().optional(),
  updates: z.array(maintenanceUpdateSchema), components: z.array(componentRef).optional(),
}).passthrough();
export const subscriberSchema = z.object({
  id: instatusId, email: z.string().max(320).nullable().optional(), phone: nullableText,
  webhook: nullableText, webhookEmail: nullableText, confirmed: z.boolean(), approved: z.boolean(),
  all: z.boolean(), components: z.array(instatusId),
}).passthrough();
export const pageSchema = z.object({
  id: instatusId, name: text, subdomain: text, customDomain: nullableText, createdAt: time.optional(),
  private: z.boolean().optional(), useAllowList: z.boolean().optional(), allowList: z.array(text).optional(),
  secureLink: nullableText,
}).passthrough();
const publicLink = z.object({ id: instatusId, url: z.string().url() }).passthrough();
export const publicSummarySchema = z.object({
  page: z.object({ id: instatusId.optional(), url: z.string().url() }).passthrough(),
  activeIncidents: z.array(publicLink), activeMaintenances: z.array(publicLink),
  recentlyResolvedIncidents: z.array(publicLink).optional(),
}).passthrough();
export type InstatusComponent = z.infer<typeof componentSchema>;
export type InstatusIncident = z.infer<typeof incidentSchema>;
export type InstatusMaintenance = z.infer<typeof maintenanceSchema>;
export type InstatusSubscriber = z.infer<typeof subscriberSchema>;
