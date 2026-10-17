import { createUlid } from "../../shared/ids";
import { catalogueSchema, type CatalogueSnapshot, type ComponentCatalogue } from "./catalogue-schema";

export class CatalogueChangedError extends Error {
  constructor() { super("The catalogue or published state changed. Refresh and review the changes again."); }
}

export function createCatalogueRepository(binding: D1Database) {
  return {
    async read(): Promise<CatalogueSnapshot> {
      const results = await binding.batch<Record<string, unknown>>([
        binding.prepare("SELECT requested_revision AS revision FROM public_snapshot_work WHERE id = 'default'"),
        binding.prepare("SELECT id,name,display_order AS displayOrder FROM component_groups ORDER BY display_order,id"),
        binding.prepare("SELECT id,group_id AS groupId,name,description,internal,only_show_if_degraded AS onlyShowIfDegraded,uptime_start_date AS uptimeStartDate,display_order AS displayOrder,note FROM components ORDER BY display_order,id"),
      ]);
      const revision = results[0].results[0]?.revision;
      if (typeof revision !== "number") throw new Error("Catalogue revision is unavailable.");
      return {
        revision,
        catalogue: catalogueSchema.parse({
          groups: results[1].results,
          components: results[2].results.map(component => ({ ...component, internal: component.internal === 1, onlyShowIfDegraded: component.onlyShowIfDegraded === 1 })),
        }),
      };
    },
    async apply(previous: CatalogueSnapshot, catalogue: ComponentCatalogue, operatorId: string) {
      const now = new Date().toISOString();
      const statements = [binding.prepare("SELECT CASE WHEN (SELECT requested_revision FROM public_snapshot_work WHERE id = 'default') = ? THEN 1 ELSE json('Catalogue changed; review again.') END").bind(previous.revision)];
      const groupIds = new Set(catalogue.groups.map(group => group.id));
      const componentIds = new Set(catalogue.components.map(component => component.id));
      const previousComponents = new Map(previous.catalogue.components.map(component => [component.id, component]));
      const previousGroups = new Map(previous.catalogue.groups.map(group => [group.id, group]));
      const groupsChanged = JSON.stringify(previous.catalogue.groups) !== JSON.stringify(catalogue.groups);
      if (groupsChanged) statements.push(binding.prepare("UPDATE component_groups SET display_order = -rowid - 1"));
      for (const group of catalogue.groups) {
        if (!groupsChanged && previousGroups.has(group.id)) continue;
        statements.push(binding.prepare("INSERT INTO component_groups (id,name,display_order,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,display_order=excluded.display_order,updated_at=excluded.updated_at").bind(group.id, group.name, group.displayOrder, now, now));
      }
      for (const component of catalogue.components) {
        const existing = previousComponents.get(component.id);
        if (existing && JSON.stringify(existing) === JSON.stringify(component)) continue;
        statements.push(binding.prepare("INSERT INTO components (id,group_id,name,description,internal,only_show_if_degraded,uptime_start_date,display_order,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id,name=excluded.name,description=excluded.description,internal=excluded.internal,only_show_if_degraded=excluded.only_show_if_degraded,uptime_start_date=excluded.uptime_start_date,display_order=excluded.display_order,note=excluded.note,updated_at=excluded.updated_at")
          .bind(component.id, component.groupId, component.name, component.description, component.internal ? 1 : 0, component.onlyShowIfDegraded ? 1 : 0, component.uptimeStartDate, component.displayOrder, component.note, now, now));
        if (!existing) {
          statements.push(binding.prepare("INSERT INTO component_claim_events (id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at) VALUES (?,?,'standing-claim',NULL,'Operational',?,?,?)").bind(createUlid(), component.id, now, now, now));
          statements.push(binding.prepare("INSERT INTO component_state_history (id,component_id,previous_state,new_state,cause_type,cause_id,operator_id,changed_at,created_at,updated_at) VALUES (?,?,'Operational','Operational','standing-claim',NULL,?,?,?,?)").bind(createUlid(), component.id, operatorId, now, now, now));
        }
      }
      for (const component of previous.catalogue.components) if (!componentIds.has(component.id)) statements.push(binding.prepare("DELETE FROM components WHERE id=?").bind(component.id));
      for (const group of previous.catalogue.groups) if (!groupIds.has(group.id)) statements.push(binding.prepare("DELETE FROM component_groups WHERE id=?").bind(group.id));
      try { await binding.batch(statements); }
      catch (cause) {
        if (cause instanceof Error && cause.message.includes("malformed JSON")) throw new CatalogueChangedError();
        throw cause;
      }
    },
  };
}

export type CatalogueRepository = ReturnType<typeof createCatalogueRepository>;
