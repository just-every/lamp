import type { AiProvider, AiSuggestion } from "../../platform/ai";
import type { AiRepository } from "./repository";

export interface AiService { configured(): boolean; suggest(incidentId: string): Promise<AiSuggestion | null>; }

export function createAiService(repository: AiRepository, provider: AiProvider | null): AiService {
  return { configured: () => provider !== null, async suggest(incidentId) { if (!provider) return null; const context = await repository.loadContext(incidentId); return context ? provider.suggestUpdate(context) : null; } };
}
