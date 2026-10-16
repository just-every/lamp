import type { Accounting } from "../rows.ts";
import type { SourceData } from "../source.ts";
import type { SorryComponent } from "./schema.ts";

const states = { operational: "operational", degraded: "degraded_performance", "partially-degraded": "partial_outage", "under-maintenance": "under_maintenance" } as const;

export function normalizeSorryComponents(rows: SorryComponent[], accounting: Accounting[]): Pick<SourceData, "groups" | "components"> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const parentIds = new Set(rows.flatMap((row) => row.parent_id ? [row.parent_id] : []));
  function ancestors(row: SorryComponent): SorryComponent[] {
    const result: SorryComponent[] = [], seen = new Set([row.id]);
    let parent = row.parent_id;
    while (parent) {
      if (seen.has(parent) || seen.size > 32) throw new Error("Sorry component hierarchy contains a cycle or exceeds 32 levels.");
      seen.add(parent);
      const next = byId.get(parent);
      if (!next) throw new Error("A Sorry component parent is missing from the saved responses.");
      result.unshift(next); parent = next.parent_id;
    }
    return result;
  }
  const groups: SourceData["groups"] = [], components: SourceData["components"] = [];
  for (const row of rows) {
    const parents = ancestors(row);
    if (parentIds.has(row.id)) {
      groups.push({ id: row.id, name: [...parents.map((parent) => parent.name), row.name].join(" / "), description: row.description, components: rows.filter((child) => child.parent_id === row.id).map((child) => child.id), position: row.position ?? rows.indexOf(row), created_at: row.created_at });
      accounting.push({ kind: "group", sourceId: row.id, name: row.name, outcome: "changed", reason: parents.length ? "Nested Sorry component grouping is represented as a named flat group; the parent remains an affected component." : "Sorry parent is retained as a component and as its children's visual group." });
    }
    components.push({ id: row.id, name: row.name, description: row.description, group_id: row.parent_id, position: row.position ?? rows.indexOf(row), status: states[row.state], created_at: row.created_at });
  }
  return { groups, components };
}
