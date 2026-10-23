import type { z } from "zod";
import type { SourceData } from "../source";
import { component, structure } from "./schema";

/** Components are organisation-wide; only the selected page's explicit,
 * visible structure can select them. Sub-pages need audience-page support. */
export function pageStructure(raw: z.infer<typeof structure>, catalogue: z.infer<typeof component>[]) {
  const groups: SourceData["groups"] = [], components: SourceData["components"] = [];
  const used = new Set<string>(), groupIds = new Set<string>();
  function add(row: { component_id: string; name: string; hidden: boolean }, position: number, groupId?: string) {
    if (row.hidden) throw new Error("Hidden incident.io components cannot become public Lamp components.");
    if (used.has(row.component_id)) throw new Error("The incident.io page structure repeats a component.");
    used.add(row.component_id);
    const source = catalogue.find(item => item.id === row.component_id);
    if (!source) throw new Error("The incident.io page structure names an absent component.");
    // No source current state or creation timestamp is exposed. The shared
    // history mapper starts this catalogue record at import and applies only
    // the explicit incident update states, without a fabricated standing claim.
    components.push({ id: source.id, name: row.name, description: source.description, position, group_id: groupId, status: "", created_at: "" });
  }
  for (const [position, item] of raw.current_structure.items.entries()) {
    if ([item.component, item.group, item.sub_page].filter(Boolean).length !== 1) throw new Error("An incident.io structure item must identify exactly one component, group or sub-page.");
    if (item.sub_page) throw new Error("incident.io sub-pages cannot be moved into Lamp's one public page.");
    if (item.component) add(item.component, position);
    if (item.group) {
      if (item.group.hidden || groupIds.has(item.group.id)) throw new Error("Hidden or repeated incident.io groups cannot become public Lamp groups.");
      groupIds.add(item.group.id);
      groups.push({ id: item.group.id, name: item.group.name, description: item.group.description, position, components: item.group.components.map(row => row.component_id), created_at: "" });
      for (const [index, row] of item.group.components.entries()) add(row, index, item.group.id);
    }
  }
  return { groups, components };
}
