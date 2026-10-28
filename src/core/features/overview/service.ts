import type { LiveStatusService } from "./live-status";
import type { ComponentsService } from "../components";
import type { IncidentsService } from "../incidents";
import type { MaintenanceService } from "../maintenance";

export interface OverviewService {
  live: LiveStatusService;
  get(options?: {readOnly?: boolean}): Promise<{
    live: Awaited<ReturnType<LiveStatusService["get"]>>;
    components: Awaited<ReturnType<ComponentsService["list"]>>;
    activeIncidents: Awaited<ReturnType<IncidentsService["list"]>>;
    maintenance: Awaited<ReturnType<MaintenanceService["list"]>>;
  }>;
  /** First run: add the groups and components the owner kept, skipping any a group (or the ungrouped list) already
   * holds by name, then store completion. Groups that share a name stay separate groups. */
  finishFirstRun(operatorId: string, layout: { components: string[]; groups?: Array<{ name: string; components: string[] }> }): Promise<void>;
}

export function createOverviewService(
  componentsService: ComponentsService,
  incidentsService: IncidentsService,
  maintenanceService: MaintenanceService,
  live: LiveStatusService,
): OverviewService {
  return {
    live,
    async get(options = {}) {
      const [components, incidents, maintenance, status] = await Promise.all([
        componentsService.list(),
        incidentsService.list(),
        maintenanceService.list({notifyOverruns: !options.readOnly}),
        live.get({refresh: !options.readOnly}),
      ]);
      return {
        live: status,
        components,
        activeIncidents: incidents.filter((incident) => incident.lifecycle !== "Resolved"),
        maintenance,
      };
    },
    async finishFirstRun(operatorId, layout) {
      const [existing, groups] = await Promise.all([componentsService.list(), componentsService.listGroups()]);
      const key = (groupId: string | null, name: string) => `${groupId ?? ""}\n${name.trim().toLowerCase()}`;
      const taken = new Set(existing.map((component) => key(component.groupId, component.name)));
      let displayOrder = existing.length, groupOrder = Math.max(-1, ...groups.map((group) => group.displayOrder)) + 1;
      const add = async (names: string[], groupId: string | null) => {
        for (const name of names.map((value) => value.trim()).filter(Boolean)) {
          if (taken.has(key(groupId, name))) continue;
          taken.add(key(groupId, name));
          await componentsService.create({ groupId, name, description: "", internal: false, displayOrder: displayOrder++, note: "" }, operatorId);
        }
      };
      const named = groups.map(({ id, name }) => ({ id, name }));
      const claimed = new Set<string>();
      for (const group of layout.groups ?? []) {
        if (!group.components.some((name) => name.trim())) continue;
        // A group of that name an import brought takes the rest of its components, once: another group of the same
        // name is a group of its own, never the same one.
        let target = named.find((candidate) => !claimed.has(candidate.id) && candidate.name.trim().toLowerCase() === group.name.trim().toLowerCase());
        if (!target) { target = await componentsService.createGroup({ name: group.name.trim(), displayOrder: groupOrder++ }); named.push(target); }
        claimed.add(target.id);
        await add(group.components, target.id);
      }
      await add(layout.components, null);
      await live.completeFirstRun();
    },
  };
}
