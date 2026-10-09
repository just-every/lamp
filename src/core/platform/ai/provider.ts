import type { ComponentState, IncidentLifecycle } from "../../shared/domain";

export interface AiSuggestion { lifecycle: IncidentLifecycle; affectedAudience: string; customerImpact: string; whatStillWorks: string; details: string; nextUpdateAt: string; }
export interface AiSuggestionContext {
  incident: { reference: string; title: string; lifecycle: IncidentLifecycle };
  components: Array<{ name: string; state: ComponentState }>;
  publishedUpdates: Array<{ lifecycle: IncidentLifecycle; affectedAudience: string; customerImpact: string; whatStillWorks: string; details: string; nextUpdateAt: string; publishedAt: string }>;
  acceptedAlerts: Array<{ receivedAt: string; payload: unknown }>;
  toneInstructions: string;
}
export interface AiProvider { suggestUpdate(context: AiSuggestionContext): Promise<AiSuggestion>; }
