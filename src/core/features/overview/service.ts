import type { SetupChecklistService } from "./setup-checklist";
import type { ComponentsService } from "../components";
import type { IncidentsService } from "../incidents";
import type { MaintenanceService } from "../maintenance";

export interface OverviewService {
  setup: SetupChecklistService;
  get(): Promise<{
    checklist: Awaited<ReturnType<SetupChecklistService["get"]>>;
    components: Awaited<ReturnType<ComponentsService["list"]>>;
    activeIncidents: Awaited<ReturnType<IncidentsService["list"]>>;
    maintenance: Awaited<ReturnType<MaintenanceService["list"]>>;
  }>;
}

export function createOverviewService(
  componentsService: ComponentsService,
  incidentsService: IncidentsService,
  maintenanceService: MaintenanceService,
  setup: SetupChecklistService,
): OverviewService {
  return {
    setup,
    async get() {
      const componentsPromise = componentsService.list();
      const [components, incidents, maintenance, checklist] = await Promise.all([
        componentsPromise,
        incidentsService.list(),
        maintenanceService.list(),
        componentsPromise.then(components => setup.get(components.length > 0)),
      ]);
      return {
        checklist,
        components,
        activeIncidents: incidents.filter((incident) => incident.lifecycle !== "Resolved"),
        maintenance,
      };
    },
  };
}
