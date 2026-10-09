import type { AiSuggestionContext } from "../../platform/ai";
import type { ComponentState, IncidentLifecycle } from "../../shared/domain";

export interface AiRepository { loadContext(incidentId: string): Promise<AiSuggestionContext | null>; }

export function createAiRepository(binding: D1Database): AiRepository {
  return {
    async loadContext(incidentId) {
      const incident = await binding.prepare(`SELECT reference, title, lifecycle FROM incidents WHERE id = ? AND deleted_at IS NULL`).bind(incidentId).first<{ reference: string; title: string; lifecycle: IncidentLifecycle }>();
      if (!incident) return null;
      const [components, updates, alerts, settings] = await Promise.all([
        binding.prepare(`SELECT component_name AS name, state FROM incident_components WHERE incident_id = ?`).bind(incidentId).all<{ name: string; state: ComponentState }>(),
        binding.prepare(`SELECT lifecycle, affected_audience AS affectedAudience, customer_impact AS customerImpact, what_still_works AS whatStillWorks, details, next_update_at AS nextUpdateAt, published_at AS publishedAt FROM incident_updates WHERE incident_id = ? ORDER BY published_at ASC`).bind(incidentId).all<AiSuggestionContext["publishedUpdates"][number]>(),
        binding.prepare(`SELECT received_at AS receivedAt, payload_json AS payloadJson FROM alert_receipts WHERE incident_id = ? AND state = 'firing' ORDER BY received_at ASC`).bind(incidentId).all<{ receivedAt: string; payloadJson: string }>(),
        binding.prepare(`SELECT ai_tone_instructions AS tone FROM page_settings WHERE id = 'default'`).first<{ tone: string }>(),
      ]);
      return { incident, components: components.results, publishedUpdates: updates.results, acceptedAlerts: alerts.results.map((alert) => ({ receivedAt: alert.receivedAt, payload: JSON.parse(alert.payloadJson) })), toneInstructions: settings?.tone ?? "" };
    },
  };
}
