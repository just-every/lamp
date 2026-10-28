import type { ComponentsService } from "../components";
import { createUlid, nowIso } from "../../shared/ids";
import type { IncidentRepository, StoredIncidentDraft } from "./repository";
import { stageComponentChoices } from "./component-staging";
import { assertTemplateWordingLimits } from "./template-fields";
import { templateSchema, templateUpdateSchema, type IncidentTemplateInput, type IncidentTemplateEdit } from "./template-schema";
import type { IncidentTemplate, IncidentTemplateComponentRecord } from "./template-repository";

export type AppliedIncidentTemplate = { draft: StoredIncidentDraft; template: Pick<IncidentTemplate, "id" | "name" | "title" | "folder" | "shouldSendNotifications"> };

export interface IncidentTemplateService {
  listTemplates(): Promise<IncidentTemplate[]>;
  saveTemplate(input: IncidentTemplateInput, operatorId: string): Promise<IncidentTemplate>;
  updateTemplate(templateId: string, input: IncidentTemplateEdit, operatorId: string): Promise<IncidentTemplate | null>;
  applyTemplate(incidentId: string, templateId: string, operatorId: string, expectedVersion: string): Promise<AppliedIncidentTemplate | null>;
}

export function createIncidentTemplateService(repository: IncidentRepository, componentsService: ComponentsService): IncidentTemplateService {
  const componentRecords = async (components: IncidentTemplateInput["components"], templateId: string, timestamp: string): Promise<IncidentTemplateComponentRecord[]> => {
    return Promise.all(components.map(async claim => {
      const component = await componentsService.get(claim.componentId);
      if (!component) throw new Error("A template component no longer exists.");
      return { ...claim, id: createUlid(), templateId, componentName: component.name, createdAt: timestamp, updatedAt: timestamp };
    }));
  };
  return {
    listTemplates: () => repository.listTemplates(),
    async saveTemplate(input, operatorId) {
      const parsed = templateSchema.parse(input);
      const timestamp = nowIso(); const id = createUlid();
      const components = await componentRecords(parsed.components, id, timestamp);
      await repository.saveTemplate({ ...parsed, channels: parsed.channels ?? [], resolvedUpdate: parsed.resolvedUpdate ?? null, id, title: "", folder: "", shouldSendNotifications: null, fieldsToShorten: [], affectedAudience: parsed.affectedAudience.trim(), customerImpact: parsed.customerImpact.trim(), whatStillWorks: parsed.whatStillWorks.trim(), details: parsed.details.trim(), createdByOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp }, components);
      const saved = (await repository.listTemplates()).find(template => template.name === parsed.name);
      if (!saved) throw new Error("Incident template could not be saved.");
      return saved;
    },
    async updateTemplate(templateId, input, operatorId) {
      const edit = templateUpdateSchema.parse(input);
      const existing = await repository.findTemplate(templateId);
      if (!existing) return null;
      const updated = { ...existing, ...edit };
      assertTemplateWordingLimits(updated);
      // Imported templates may have no relative commitment. Editing wording
      // does not invent one, nor require the owner to replace source metadata.
      const fields = templateSchema.omit({ components: true, nextUpdateOffsetMinutes: true }).parse({
        name: updated.name, lifecycle: updated.lifecycle, affectedAudience: updated.affectedAudience,
        customerImpact: updated.customerImpact, whatStillWorks: updated.whatStillWorks, details: updated.details,
      });
      const timestamp = new Date(Math.max(Date.now(), Date.parse(existing.updatedAt) + 1)).toISOString();
      const components = edit.components === undefined ? undefined : await componentRecords(edit.components, templateId, timestamp);
      await repository.updateTemplate({ ...existing, ...edit, ...fields, fieldsToShorten: [], updatedAt: timestamp }, components, operatorId);
      return repository.findTemplate(templateId);
    },
    async applyTemplate(incidentId, templateId, operatorId, expectedVersion) {
      const [incident, template, current, currentDraft] = await Promise.all([
        repository.findIncident(incidentId), repository.findTemplate(templateId), repository.listComponents(incidentId), repository.findPublishingDraft(incidentId),
      ]);
      if (!incident || !template) return null;
      assertTemplateWordingLimits(template);
      if (!template.components.length) throw new Error("A template must attach at least one component.");
      if (template.nextUpdateOffsetMinutes !== null && (!Number.isInteger(template.nextUpdateOffsetMinutes) || template.nextUpdateOffsetMinutes < 1 || template.nextUpdateOffsetMinutes > 10_080)) throw new Error("Template next-update offset must be between 1 minute and 7 days.");
      const choices = new Map(current.flatMap(component => component.componentId ? [[component.componentId, { componentId: component.componentId, state: component.state, relationship: component.relationship }] as const] : []));
      for (const component of template.components) {
        if (!component.componentId) throw new Error("A template component no longer exists.");
        choices.set(component.componentId, { componentId: component.componentId, state: component.state, relationship: component.relationship });
      }
      const componentChanges = await stageComponentChoices([...choices.values()], currentDraft?.componentChanges ?? [], current, componentsService);
      const timestamp = nowIso();
      const draft: StoredIncidentDraft = { id: createUlid(), incidentId, lifecycle: template.lifecycle, affectedAudience: template.affectedAudience, customerImpact: template.customerImpact, whatStillWorks: template.whatStillWorks, details: template.details, nextUpdateAt: template.lifecycle === "Resolved" || template.nextUpdateOffsetMinutes === null ? null : new Date(Date.now() + template.nextUpdateOffsetMinutes * 60_000).toISOString(), componentChanges, authorOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp };
      await repository.applyTemplate(incidentId, draft, expectedVersion);
      const { id, name, title, folder, shouldSendNotifications } = template;
      return { draft, template: { id, name, title, folder, shouldSendNotifications } };
    },
  };
}
