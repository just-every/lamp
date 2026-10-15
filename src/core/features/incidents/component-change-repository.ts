import type { ComponentState } from "../../shared/domain";
import { incidentCatchupRecipients } from "../deliveries/incident-catchup";

/** Read-only effect of releasing this incident's claim and attaching its audience. */
export async function previewComponentChange(binding: D1Database, incidentId: string, componentId: string) {
  const recipients = incidentCatchupRecipients({ incidentId, componentId });
  const [claims, count] = await Promise.all([
    binding.prepare(`SELECT state FROM component_standing_claims WHERE component_id = ?
      UNION ALL SELECT attached.state FROM incident_components attached JOIN incidents incident ON incident.id = attached.incident_id
        WHERE attached.component_id = ? AND incident.id <> ? AND attached.published_at IS NOT NULL AND incident.deleted_at IS NULL AND incident.lifecycle <> 'Resolved'
      UNION ALL SELECT attached.state FROM maintenance_components attached JOIN maintenance window ON window.id = attached.maintenance_id
        WHERE attached.component_id = ? AND window.state = 'In progress'`)
      .bind(componentId,componentId,incidentId,componentId).all<{ state: ComponentState }>(),
    binding.prepare(`SELECT count(CASE WHEN channel = 'email' THEN 1 END) AS email, count(CASE WHEN channel = 'webhook' THEN 1 END) AS webhook FROM (${recipients.sql})`)
      .bind(...recipients.bindings).first<{ email: number; webhook: number }>(),
  ]);
  return { remainingStates: claims.results.map((claim) => claim.state), emailRecipients: count!.email, webhookRecipients: count!.webhook };
}
