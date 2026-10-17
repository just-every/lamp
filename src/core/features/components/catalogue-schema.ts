import { z } from "zod";
import { ulidSchema } from "../../shared/ids";
import { componentSchema, componentGroupSchema } from "../../shared/schemas";

export const catalogueComponentSchema = componentSchema.extend({
  id: ulidSchema,
  onlyShowIfDegraded: z.boolean().default(false),
  uptimeStartDate: z.iso.date().nullable().default(null),
});
export const catalogueSchema = z.object({
  groups: z.array(componentGroupSchema.extend({ id: ulidSchema })).max(1000),
  components: z.array(catalogueComponentSchema).max(1000),
}).strict().superRefine((catalogue, context) => {
  const groupIds = new Set(catalogue.groups.map(group => group.id));
  if (groupIds.size !== catalogue.groups.length) context.addIssue({ code: "custom", message: "Group identifiers must be unique.", path: ["groups"] });
  if (new Set(catalogue.groups.map(group => group.displayOrder)).size !== catalogue.groups.length) context.addIssue({ code: "custom", message: "Group positions must be unique.", path: ["groups"] });
  if (new Set(catalogue.components.map(component => component.id)).size !== catalogue.components.length) context.addIssue({ code: "custom", message: "Component identifiers must be unique.", path: ["components"] });
  catalogue.components.forEach((component, index) => {
    if (component.groupId && !groupIds.has(component.groupId)) context.addIssue({ code: "custom", message: "Choose a group in this catalogue.", path: ["components", index, "groupId"] });
  });
});

export type ComponentCatalogue = z.output<typeof catalogueSchema>;
export interface CatalogueSnapshot { revision: number; catalogue: ComponentCatalogue }
export interface CataloguePreview extends CatalogueSnapshot {
  reviewToken: string;
  counts: { components: { created: number; changed: number; deleted: number }; groups: { created: number; changed: number; deleted: number } };
  removed: { components: string[]; groups: string[] };
}
