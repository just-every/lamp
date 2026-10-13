import { buildIncidentBrief, type IncidentBrief } from "./build";
import type { BriefRepository } from "./repository";

export interface BriefService { get(incidentId: string, now?: Date): Promise<IncidentBrief | null>; }

export function createBriefService(repository: BriefRepository): BriefService {
  return {
    async get(incidentId, now = new Date()) {
      const facts = await repository.loadFacts(incidentId);
      return facts ? buildIncidentBrief(facts, now) : null;
    },
  };
}
