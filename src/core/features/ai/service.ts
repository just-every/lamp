import { SUGGESTED_FIELDS, type AiProvider, type AiSuggestion } from "../../platform/ai";
import { briefReferences, type BriefService, type IncidentBrief } from "../brief";

/** A suggestion whose every source names an item of the brief it was built from. */
export interface CheckedSuggestion { suggestion: AiSuggestion; brief: IncidentBrief }
export interface AiService { configured(): boolean; unavailable: string | null; suggest(incidentId: string): Promise<CheckedSuggestion | null>; check(): Promise<{ ok: boolean; message: string }>; }

// A fixed, fictional brief: the connection check sends no installation data.
const CHECK_BRIEF: IncidentBrief = {
  incident: { reference: "CHECK-1", title: "Connection check: card payments are slow", lifecycle: "Investigating", openedAt: "2026-01-01T00:00:00.000Z" },
  whatWeKnow: { alerts: [], updates: [], components: [] },
  whatWeDoNotKnowYet: [],
  toneInstructions: "",
};

export function createAiService(briefs: BriefService, provider: AiProvider | null, unavailable: string | null = null): AiService {
  return {
    configured: () => provider !== null,
    unavailable,
    async check() {
      if (!provider) return { ok: false, message: unavailable ?? "No AI provider is configured." };
      try {
        const answer = await provider.suggestUpdate(CHECK_BRIEF);
        return { ok: true, message: `The provider answered with a suggestion: “${answer.customerImpact.text || answer.details.text || answer.affectedAudience.text}”` };
      } catch (cause) {
        return { ok: false, message: cause instanceof Error ? cause.message : "The AI provider did not answer." };
      }
    },
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
