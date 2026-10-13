import type { IncidentBrief } from "../../features/brief/build";

/** One composer field written by a provider, with the brief references it rests on. */
export interface SuggestedField { text: string; sources: string[] }
/** A suggestion fills only the text fields. The lifecycle and the next-update
 * time are the operator's commitments (UPDATE-001), so a provider proposes neither. */
export interface AiSuggestion { affectedAudience: SuggestedField; customerImpact: SuggestedField; whatStillWorks: SuggestedField; details: SuggestedField }
export const SUGGESTED_FIELDS = ["affectedAudience", "customerImpact", "whatStillWorks", "details"] as const;
/** The incident brief the operator reads is exactly what a provider receives. */
export type AiSuggestionContext = IncidentBrief;
export interface AiProvider { suggestUpdate(context: AiSuggestionContext): Promise<AiSuggestion>; }
