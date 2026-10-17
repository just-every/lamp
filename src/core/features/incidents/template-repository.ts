import type { ComponentState, IncidentLifecycle } from "../../shared/domain";
import { TEMPLATE_WORDING_FIELDS, templateFieldsToShorten, type TemplateWording, type TemplateWordingField } from "./template-fields";

export interface IncidentTemplateRecord extends TemplateWording {
  id: string;
  name: string;
  title: string;
  folder: string;
  shouldSendNotifications: boolean | null;
  fieldsToShorten: TemplateWordingField[];
  lifecycle: IncidentLifecycle;
  nextUpdateOffsetMinutes: number | null;
  createdByOperatorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentTemplateComponentRecord {
  id: string;
  templateId: string;
  componentId: string | null;
  componentName: string;
  state: ComponentState;
  relationship: "Primary" | "Dependent";
  createdAt: string;
  updatedAt: string;
}

export type IncidentTemplate = IncidentTemplateRecord & { components: IncidentTemplateComponentRecord[] };
type TemplateRow = Omit<IncidentTemplateRecord, "fieldsToShorten" | "shouldSendNotifications"> & { shouldSendNotifications: number | null; importedFieldsJson: string | null };
const columns = `id, name, title, folder, should_send_notifications AS shouldSendNotifications, lifecycle, affected_audience AS affectedAudience, customer_impact AS customerImpact, what_still_works AS whatStillWorks, details, next_update_offset_minutes AS nextUpdateOffsetMinutes, imported_fields_json AS importedFieldsJson, created_by_operator_id AS createdByOperatorId, created_at AS createdAt, updated_at AS updatedAt`;
const componentColumns = `id, template_id AS templateId, component_id AS componentId, component_name AS componentName, state, relationship, created_at AS createdAt, updated_at AS updatedAt`;

function decodeTemplate({ importedFieldsJson, shouldSendNotifications, ...row }: TemplateRow): IncidentTemplateRecord {
  if (importedFieldsJson !== null) {
    const imported: unknown = JSON.parse(importedFieldsJson);
    if (!imported || typeof imported !== "object" || Array.isArray(imported)) throw new Error("Imported template wording must be an object.");
    for (const field of Object.keys(TEMPLATE_WORDING_FIELDS) as TemplateWordingField[]) {
      const value = (imported as Record<string, unknown>)[field];
      if (value !== undefined) {
        if (typeof value !== "string") throw new Error(`Imported template ${field} must be text.`);
        row[field] = value;
      }
    }
  }
  return { ...row, shouldSendNotifications: shouldSendNotifications === null ? null : shouldSendNotifications === 1, fieldsToShorten: templateFieldsToShorten(row) };
}

export function createIncidentTemplateRepository(binding: D1Database) {
  const componentsFor = async (templateId: string) => (await binding.prepare(`SELECT ${componentColumns} FROM incident_template_components WHERE template_id = ? ORDER BY created_at, id`).bind(templateId).all<IncidentTemplateComponentRecord>()).results;
  const componentStatements = (templateId: string, components: IncidentTemplateComponentRecord[]) => components.map(component => binding.prepare(`INSERT INTO incident_template_components (id,template_id,component_id,component_name,state,relationship,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(component.id, templateId, component.componentId, component.componentName, component.state, component.relationship, component.createdAt, component.updatedAt));
  return {
    async listTemplates(): Promise<IncidentTemplate[]> {
      const [templates, components] = await Promise.all([
        binding.prepare(`SELECT ${columns} FROM incident_templates ORDER BY folder COLLATE NOCASE, name COLLATE NOCASE`).all<TemplateRow>(),
        binding.prepare(`SELECT ${componentColumns} FROM incident_template_components ORDER BY created_at, id`).all<IncidentTemplateComponentRecord>(),
      ]);
      return templates.results.map(row => ({ ...decodeTemplate(row), components: components.results.filter(component => component.templateId === row.id) }));
    },
    async findTemplate(templateId: string): Promise<IncidentTemplate | null> {
      const [row, components] = await Promise.all([
        binding.prepare(`SELECT ${columns} FROM incident_templates WHERE id = ?`).bind(templateId).first<TemplateRow>(), componentsFor(templateId),
      ]);
      return row ? { ...decodeTemplate(row), components } : null;
    },
    async saveTemplate(input: IncidentTemplateRecord, components: IncidentTemplateComponentRecord[]) {
      await binding.batch([
        binding.prepare(`INSERT INTO incident_templates (id,name,title,folder,should_send_notifications,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_offset_minutes,created_by_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET lifecycle=excluded.lifecycle,affected_audience=excluded.affected_audience,customer_impact=excluded.customer_impact,what_still_works=excluded.what_still_works,details=excluded.details,next_update_offset_minutes=excluded.next_update_offset_minutes,imported_fields_json=NULL,updated_at=excluded.updated_at`).bind(input.id, input.name, input.title, input.folder, input.shouldSendNotifications === null ? null : Number(input.shouldSendNotifications), input.lifecycle, input.affectedAudience, input.customerImpact, input.whatStillWorks, input.details, input.nextUpdateOffsetMinutes, input.createdByOperatorId, input.createdAt, input.updatedAt),
        binding.prepare(`DELETE FROM incident_template_components WHERE template_id = (SELECT id FROM incident_templates WHERE name = ?)`).bind(input.name),
        ...components.map(component => binding.prepare(`INSERT INTO incident_template_components (id,template_id,component_id,component_name,state,relationship,created_at,updated_at) SELECT ?,id,?,?,?,?,?,? FROM incident_templates WHERE name = ?`).bind(component.id, component.componentId, component.componentName, component.state, component.relationship, component.createdAt, component.updatedAt, input.name)),
      ]);
    },
    async updateTemplate(input: IncidentTemplateRecord, components?: IncidentTemplateComponentRecord[]) {
      await binding.batch([
        binding.prepare(`UPDATE incident_templates SET name=?,title=?,folder=?,should_send_notifications=?,lifecycle=?,affected_audience=?,customer_impact=?,what_still_works=?,details=?,next_update_offset_minutes=?,imported_fields_json=NULL,updated_at=? WHERE id=?`).bind(input.name, input.title, input.folder, input.shouldSendNotifications === null ? null : Number(input.shouldSendNotifications), input.lifecycle, input.affectedAudience, input.customerImpact, input.whatStillWorks, input.details, input.nextUpdateOffsetMinutes, input.updatedAt, input.id),
        ...(components === undefined ? [] : [binding.prepare(`DELETE FROM incident_template_components WHERE template_id = ?`).bind(input.id), ...componentStatements(input.id, components)]),
      ]);
    },
  };
}
