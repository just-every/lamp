import { z } from "zod";

// Official tagged OpenAPI resources: status-pages-v2, status-page-structures-v2,
// status-page-components-v2, status-page-incidents-v2 and status-page-maintenances-v2.
export const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const text = z.string().max(20_000), time = z.string().datetime({ offset: true });
const componentStatus = z.enum(["operational", "degraded_performance", "partial_outage", "full_outage"]);
const lifecycle = z.enum(["investigating", "identified", "monitoring", "resolved"]);
export const page = z.object({ id, name: text, description: text.optional(), public_url: z.string().url().optional() }).passthrough();
export const component = z.object({ id, name: text, description: text.optional() }).passthrough();
export const structureComponent = z.object({ component_id: id, name: text, hidden: z.boolean(), display_uptime: z.boolean() }).passthrough();
export const group = z.object({ id, name: text, description: text.optional(), hidden: z.boolean(), display_aggregated_uptime: z.boolean(), components: z.array(structureComponent) }).passthrough();
const item = z.object({ component: structureComponent.optional(), group: group.optional() }).passthrough();
export const structure = z.object({ current_structure: z.object({ items: z.array(item.extend({ sub_page: z.object({ id, name: text, items: z.array(item) }).passthrough().optional() })) }) }).passthrough();
export const incident = z.object({
  id, status_page_id: id, name: text, published_at: time, incident_status: lifecycle,
  updates: z.array(z.object({ id, status_page_incident_id: id, published_at: time, message: text, incident_status: lifecycle, component_statuses: z.array(z.object({ component_id: id, component_status: componentStatus }).passthrough()) }).passthrough()),
  component_impacts: z.array(z.object({ component_id: id, component_status: componentStatus, start_at: time, end_at: time.nullable().optional() }).passthrough()),
}).passthrough();
const maintenanceStatus = z.enum(["maintenance_scheduled", "maintenance_in_progress", "maintenance_complete"]);
export const maintenance = z.object({
  id, status_page_id: id, name: text, published_at: time, maintenance_status: maintenanceStatus, automate_maintenance_status: z.boolean(),
  updates: z.array(z.object({ id, status_page_maintenance_id: id, published_at: time, message: text, maintenance_status: maintenanceStatus, component_statuses: z.array(z.object({ component_id: id, component_status: z.enum(["operational", "under_maintenance"]) }).passthrough()) }).passthrough()),
  component_maintenance_periods: z.array(z.object({ component_id: id, start_at: time, end_at: time.nullable().optional() }).passthrough()),
}).passthrough();
export const pagination = z.object({ page_size: z.number().int().min(1).max(250), after: z.string().min(1).max(2048).optional() }).passthrough();
export const schemas = {
  page: z.object({ status_page: page }).passthrough(),
  components: z.object({ status_page_components: z.array(component) }).passthrough(),
  structure,
  incidents: z.object({ status_page_incidents: z.array(incident), pagination_meta: pagination }).passthrough(),
  maintenances: z.object({ status_page_maintenances: z.array(maintenance), pagination_meta: pagination }).passthrough(),
};
export const limits = { maxBytes: 8 * 1024 * 1024, maxRecords: 5000, maxRecordBytes: 512 * 1024, files: 200, pages: 50 };
