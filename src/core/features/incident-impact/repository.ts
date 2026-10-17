import type { ComponentState } from "../../shared/domain";
import { incidentImpact, type IncidentImpact } from "../../shared/incident-impact";

export interface ImpactChange {
  id: string;
  operatorId: string;
  operatorName: string;
  previousOverride: IncidentImpact | null;
  impactOverride: IncidentImpact | null;
  createdAt: string;
}

export interface IncidentImpactView {
  incidentId: string;
  derivedImpact: IncidentImpact;
  impactOverride: IncidentImpact | null;
  effectiveImpact: IncidentImpact;
  history: ImpactChange[];
}

export function createIncidentImpactRepository(db: D1Database) {
  return {
    async get(incidentId: string): Promise<IncidentImpactView | null> {
      const row = await db.prepare(`SELECT id, peak_impact AS peakImpact, impact_override AS impactOverride
        FROM incidents WHERE id = ? AND deleted_at IS NULL`).bind(incidentId)
        .first<{ id: string; peakImpact: ComponentState | null; impactOverride: IncidentImpact | null }>();
      if (!row) return null;
      const [claims, history] = await Promise.all([
        db.prepare("SELECT state FROM incident_components WHERE incident_id = ?")
          .bind(incidentId).all<{ state: ComponentState }>(),
        db.prepare(`SELECT c.id, c.operator_id AS operatorId, o.display_name AS operatorName,
          c.previous_override AS previousOverride, c.impact_override AS impactOverride, c.created_at AS createdAt
          FROM incident_impact_changes c JOIN operators o ON o.id = c.operator_id
          WHERE c.incident_id = ? ORDER BY c.created_at DESC, c.id DESC`).bind(incidentId).all<ImpactChange>(),
      ]);
      return { incidentId: row.id, ...incidentImpact(row.peakImpact, row.impactOverride, claims.results.map(claim => claim.state)), history: history.results };
    },
    async set(input: { id: string; incidentId: string; impactOverride: IncidentImpact | null; operatorId: string; now: string }) {
      // Capture the previous value and attribution in the same transaction as
      // the mutation. Identical choices produce no misleading timeline event.
      const results = await db.batch([
        db.prepare(`INSERT INTO incident_impact_changes (id,incident_id,operator_id,impact_override,previous_override,created_at)
          SELECT ?,id,?,?,impact_override,? FROM incidents
          WHERE id = ? AND deleted_at IS NULL AND impact_override IS NOT ?`)
          .bind(input.id,input.operatorId,input.impactOverride,input.now,input.incidentId,input.impactOverride),
        db.prepare(`UPDATE incidents SET impact_override = ?, updated_at = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM incident_impact_changes WHERE id = ?)`)
          .bind(input.impactOverride,input.now,input.incidentId,input.id),
        db.prepare(`INSERT INTO audit_entries (id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
          SELECT id,'incident',incident_id,'impact-changed',operator_id,
            json_object('previousOverride',previous_override,'impactOverride',impact_override),created_at,created_at
          FROM incident_impact_changes WHERE id = ?`).bind(input.id),
      ]);
      return results[0]!.meta.changes === 1;
    },
  };
}
export type IncidentImpactRepository = ReturnType<typeof createIncidentImpactRepository>;
