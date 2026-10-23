import { z } from "zod";

// Shapes follow the examples in developer.status.io/openapi.json. The legacy
// incident list is the only published incident response with a documented body.
export const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const text = z.string().max(20_000);
const time = z.string().datetime({ offset: true });
const reference = z.object({ _id: id }).passthrough();
export const container = z.object({ _id: id, name: text, location: text.optional() }).passthrough();
export const component = z.object({ _id: id, name: text, position: z.number().int(), statuspage: id, containers: z.array(container) }).passthrough();
export const message = z.object({
  _id: id, datetime: time, details: text, state: z.union([z.literal(100), z.literal(200), z.literal(300), z.literal(400)]),
  status: z.number().int(), components: z.array(id), containers: z.array(id), statuspage: id,
  incident: id.optional(), maintenance: id.optional(),
}).passthrough();
const history = {
  _id: id, name: text, statuspage: id, datetime_open: time, messages: z.array(message),
  components_affected: z.array(reference), containers_affected: z.array(reference),
  infrastructure_affected: z.array(z.object({ component: reference, container: reference }).passthrough()),
};
export const incident = z.object({ ...history, kind: z.literal("incident") }).passthrough();
export const maintenance = z.object({ ...history, kind: z.literal("maintenance"), datetime_planned_start: time, datetime_planned_end: time }).passthrough();
const status = z.object({ id, name: text, updated: time, status_code: z.number().int() }).passthrough();
export const summary = z.object({ status: z.array(status.extend({ containers: z.array(status) })) }).passthrough();
export const maintenanceIds = z.object({ active_maintenances: z.array(id), resolved_maintenances: z.array(id), upcoming_maintenances: z.array(id) }).strict();
export const incidents = z.object({ active_incidents: z.array(incident), resolved_incidents: z.array(incident) }).strict();
export const acl = z.object({ ipv4: z.string(), ipv6: z.string() }).passthrough();
export function result<T extends z.ZodType>(schema: T) {
  return z.object({ status: z.object({ error: z.literal("no"), message: z.string() }), result: schema }).passthrough();
}
export const schemas = { components: result(z.array(component)), summary: result(summary), incidents: result(incidents), maintenances: result(maintenanceIds), acl: result(acl), maintenance: result(maintenance) };
export const limits = { maxBytes: 8 * 1024 * 1024, maxRecords: 5000, maxRecordBytes: 512 * 1024, files: 200 };
