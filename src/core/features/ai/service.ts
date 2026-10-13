import { SUGGESTED_FIELDS, type AiProvider, type AiSuggestion } from "../../platform/ai";
import { briefReferences, type BriefService, type IncidentBrief } from "../brief";

/** A suggestion whose every source names an item of the brief it was built from. */
export interface CheckedSuggestion { suggestion: AiSuggestion; brief: IncidentBrief }
export interface AiService { configured(): boolean; suggest(incidentId: string): Promise<CheckedSuggestion | null>; }

export function createAiService(briefs: BriefService, provider: AiProvider | null): AiService {
  return {
    configured: () => provider !== null,
    async suggest(incidentId) {
      if (!provider) return null;
      const brief = await briefs.get(incidentId);
      if (!brief) return null;
      const answer = await provider.suggestUpdate(brief);
      // A provider may cite a reference the brief does not contain; keep only real ones.
      const known = briefReferences(brief);
      const suggestion = Object.fromEntries(SUGGESTED_FIELDS.map((name) => {
        const field = answer[name];
        return [name, { text: field.text.trim(), sources: [...new Set(field.sources)].filter((ref) => known.has(ref)) }];
      })) as unknown as AiSuggestion;
      return { suggestion, brief };
    },
  };
}
