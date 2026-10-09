import type { ComponentsService } from "../components";
import type { IncidentsService } from "../incidents";
import type { MaintenanceService } from "../maintenance";

export interface OverviewService {
  get(): Promise<{
    components: Awaited<ReturnType<ComponentsService["list"]>>;
    activeIncidents: Awaited<ReturnType<IncidentsService["list"]>>;
    maintenance: Awaited<ReturnType<MaintenanceService["list"]>>;
  }>;
}

export function createOverviewService(
  componentsService: ComponentsService,
  incidentsService: IncidentsService,
  maintenanceService: MaintenanceService,
): OverviewService {
  return {
    async get() {
      const [components, incidents, maintenance] = await Promise.all([
        componentsService.list(),
        incidentsService.list(),
        maintenanceService.list(),
      ]);
      return {
        components,
        activeIncidents: incidents.filter((incident) => incident.lifecycle !== "Resolved"),
        maintenance,
      };
    },
  };
}
