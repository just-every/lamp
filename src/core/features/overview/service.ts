import type { LiveStatusService } from "./live-status";
import type { ComponentsService } from "../components";
import type { IncidentsService } from "../incidents";
import type { MaintenanceService } from "../maintenance";

export interface OverviewService {
  live: LiveStatusService;
  get(): Promise<{
    live: Awaited<ReturnType<LiveStatusService["get"]>>;
    components: Awaited<ReturnType<ComponentsService["list"]>>;
    activeIncidents: Awaited<ReturnType<IncidentsService["list"]>>;
    maintenance: Awaited<ReturnType<MaintenanceService["list"]>>;
  }>;
  /** First run: add the components the owner kept, skipping names that already exist, then store completion. */
  finishFirstRun(operatorId: string, componentNames: string[]): Promise<void>;
}

export function createOverviewService(
  componentsService: ComponentsService,
  incidentsService: IncidentsService,
  maintenanceService: MaintenanceService,
  live: LiveStatusService,
  /** Runs once, when an install's first run is stored: Setup's starter template follows from it. */
  afterFirstRun: () => Promise<void> = async () => {},
): OverviewService {
  return {
    live,
    async get() {
      const [components, incidents, maintenance, status] = await Promise.all([
        componentsService.list(),
        incidentsService.list(),
        maintenanceService.list(),
        live.get(),
      ]);
      return {
        live: status,
        components,
        activeIncidents: incidents.filter((incident) => incident.lifecycle !== "Resolved"),
        maintenance,
      };
    },
    async finishFirstRun(operatorId, componentNames) {
      const fresh = !(await live.firstRunComplete());
      const existing = await componentsService.list();
      const taken = new Set(existing.map((component) => component.name.trim().toLowerCase()));
      let displayOrder = existing.length;
      for (const name of componentNames.map((value) => value.trim()).filter(Boolean)) {
        if (taken.has(name.toLowerCase())) continue;
        taken.add(name.toLowerCase());
        await componentsService.create({ groupId: null, name, description: "", internal: false, displayOrder: displayOrder++, note: "" }, operatorId);
      }
      await live.completeFirstRun();
      if (fresh) await afterFirstRun();
    },
  };
}
