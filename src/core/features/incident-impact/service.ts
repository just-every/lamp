import { createUlid, nowIso } from "../../shared/ids";
import type { IncidentImpact } from "../../shared/incident-impact";
import type { IncidentImpactRepository } from "./repository";

export function createIncidentImpactService(repository: IncidentImpactRepository, rebuildSnapshot: () => Promise<void>) {
  return {
    get: repository.get.bind(repository),
    async set(incidentId: string, impactOverride: IncidentImpact | null, operatorId: string) {
      const changed = await repository.set({ id: createUlid(), incidentId, impactOverride, operatorId, now: nowIso() });
      if (changed) await rebuildSnapshot();
      return repository.get(incidentId);
    },
  };
}
export type IncidentImpactService = ReturnType<typeof createIncidentImpactService>;
