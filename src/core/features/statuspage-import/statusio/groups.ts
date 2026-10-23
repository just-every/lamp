import type { z } from "zod";
import type { SourceData } from "../source";
import { component, summary } from "./schema";

export const statuses: Record<number, SourceData["components"][number]["status"]> = { 100: "operational", 200: "under_maintenance", 300: "degraded_performance", 400: "partial_outage", 500: "major_outage" };
export const pairId = (componentId: string, containerId: string) => componentId + "--" + containerId;

/** A container can belong to several components. Keep each infrastructure
 * pair distinct: source components are groups and their containers are children.
 * Never choose an arbitrary single parent for a shared container. */
export function statusioGroups(components: z.infer<typeof component>[], current: z.infer<typeof summary>) {
  const groups: SourceData["groups"] = [], children: SourceData["components"] = [];
  for (const row of components) {
    const state = current.status.find(item => item.id === row._id);
    if (!state) throw new Error("A Status.io component has no matching current summary.");
    if (new Set(row.containers.map(item => item._id)).size !== row.containers.length || new Set(state.containers.map(item => item.id)).size !== state.containers.length) throw new Error("Status.io repeats a container within a component.");
    if (row.containers.length) {
      groups.push({ id: row._id, name: row.name, components: row.containers.map(item => pairId(row._id, item._id)), position: row.position, created_at: "" });
      for (const [position, container] of row.containers.entries()) {
        const status = state.containers.find(item => item.id === container._id);
        if (!status || !statuses[status.status_code]) throw new Error("A Status.io container has no supported summary state. Security-event states cannot be mapped without changing their meaning.");
        children.push({ id: pairId(row._id, container._id), name: row.name + " · " + container.name, description: container.location ?? "", group_id: row._id, position, status: statuses[status.status_code], created_at: "" });
      }
      if (state.containers.length !== row.containers.length) throw new Error("Status.io component containers and summary disagree.");
    } else {
      if (!statuses[state.status_code]) throw new Error("A Status.io component state is unsupported.");
      children.push({ id: row._id, name: row.name, position: row.position, status: statuses[state.status_code], created_at: "" });
    }
  }
  if (current.status.length !== components.length) throw new Error("Status.io components and summary disagree.");
  return { groups, components: children };
}
