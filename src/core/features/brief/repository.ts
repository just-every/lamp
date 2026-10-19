import type { AlertPreset } from "../intake/presets";
import type { ComponentState, IncidentLifecycle } from "../../shared/domain";

/** Exactly the incident data a brief may use (DRAFT-002): accepted alerts,
 * published updates, attached components and their claimed states, the tone
 * instructions, and whether the saved draft has filled its required fields.
 * Internal notes (INCIDENT-008) and internal components are never read here: the brief lists only components customers
 * can see (as the public page does), and counts every attached one so it can still ask when none is. */
export interface BriefFacts {
  incident: { reference: string; title: string; lifecycle: IncidentLifecycle; openedAt: string };
  components: Array<{ name: string; state: ComponentState; relationship: string }>;
  attachedComponents: number;
  updates: Array<{ lifecycle: IncidentLifecycle; affectedAudience: string; customerImpact: string; whatStillWorks: string; details: string; nextUpdateAt: string | null; publishedAt: string }>;
  alerts: Array<{ source: string; preset: AlertPreset | null; titlePath: string; state: "firing" | "recovered"; receivedAt: string; payloadJson: string }>;
  draft: { lifecycle: IncidentLifecycle; hasAffectedAudience: boolean; hasCustomerImpact: boolean; nextUpdateAt: string | null } | null;
  toneInstructions: string;
}

export interface BriefRepository { loadFacts(incidentId: string): Promise<BriefFacts | null>; }

export function createBriefRepository(binding: D1Database): BriefRepository {
  return {
    async loadFacts(incidentId) {
      const incident = await binding.prepare(`SELECT reference, title, lifecycle, opened_at AS openedAt FROM incidents WHERE id = ? AND deleted_at IS NULL`).bind(incidentId).first<BriefFacts["incident"]>();
      if (!incident) return null;
      const [components, updates, alerts, draft, settings] = await Promise.all([
        binding.prepare(`SELECT ic.component_name AS name, ic.state, ic.relationship, COALESCE(c.internal, 0) AS internal FROM incident_components ic LEFT JOIN components c ON c.id = ic.component_id WHERE ic.incident_id = ? ORDER BY ic.created_at ASC, ic.id ASC`).bind(incidentId).all<BriefFacts["components"][number] & { internal: number }>(),
        binding.prepare(`SELECT lifecycle, affected_audience AS affectedAudience, customer_impact AS customerImpact, what_still_works AS whatStillWorks, details, next_update_at AS nextUpdateAt, published_at AS publishedAt FROM incident_updates WHERE incident_id = ? ORDER BY published_at ASC, id ASC`).bind(incidentId).all<BriefFacts["updates"][number]>(),
        binding.prepare(`SELECT s.name AS source, COALESCE(s.uptime_preset,s.grouped_preset,s.preset) AS preset, s.title_path AS titlePath, r.state, r.received_at AS receivedAt, r.payload_json AS payloadJson FROM alert_receipts r JOIN alert_sources s ON s.id = r.source_id WHERE r.incident_id = ? AND r.state IN ('firing', 'recovered') ORDER BY r.received_at ASC, r.id ASC`).bind(incidentId).all<BriefFacts["alerts"][number]>(),
        binding.prepare(`SELECT lifecycle, affected_audience <> '' AS hasAffectedAudience, customer_impact <> '' AS hasCustomerImpact, next_update_at AS nextUpdateAt FROM incident_drafts WHERE incident_id = ?`).bind(incidentId).first<{ lifecycle: IncidentLifecycle; hasAffectedAudience: number; hasCustomerImpact: number; nextUpdateAt: string | null }>(),
        binding.prepare(`SELECT ai_tone_instructions AS tone FROM page_settings WHERE id = 'default'`).first<{ tone: string | null }>(),
      ]);
      return {
        incident,
        components: components.results.filter((component) => !component.internal).map(({ name, state, relationship }) => ({ name, state, relationship })),
        attachedComponents: components.results.length,
        updates: updates.results,
        alerts: alerts.results,
        draft: draft ? { lifecycle: draft.lifecycle, hasAffectedAudience: Boolean(draft.hasAffectedAudience), hasCustomerImpact: Boolean(draft.hasCustomerImpact), nextUpdateAt: draft.nextUpdateAt } : null,
        toneInstructions: settings?.tone ?? "",
      };
    },
  };
}
