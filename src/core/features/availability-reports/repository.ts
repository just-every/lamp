import { eq, asc } from "drizzle-orm";
import { createDatabase } from "../../platform/db/client";
import { components, componentStateHistory, componentStateCorrections, pageSettings } from "../../shared/schema";
import type { AffectedRecord, AvailabilityFacts, ClaimEvent } from "./types";

export interface AvailabilityReportRepository { read(componentId: string): Promise<AvailabilityFacts> }

export function createAvailabilityReportRepository(binding: D1Database): AvailabilityReportRepository {
  const db = createDatabase(binding);
  return {
    async read(componentId) {
      const [settings, component, history, corrections, events, incidents, maintenance] = await Promise.all([
        db.select({ timezone: pageSettings.timezone }).from(pageSettings).where(eq(pageSettings.id, "default")).get(),
        db.select({ id: components.id, name: components.name, uptimeStartDate: components.uptimeStartDate }).from(components).where(eq(components.id, componentId)).get(),
        db.select().from(componentStateHistory).where(eq(componentStateHistory.componentId, componentId)).orderBy(asc(componentStateHistory.changedAt), asc(componentStateHistory.createdAt)).all(),
        db.select().from(componentStateCorrections).where(eq(componentStateCorrections.componentId, componentId)).orderBy(asc(componentStateCorrections.createdAt)).all(),
        binding.prepare(`SELECT id,cause_type AS causeType,cause_id AS causeId,state,changed_at AS changedAt,created_at AS createdAt FROM component_claim_events WHERE component_id = ? ORDER BY changed_at,created_at,id`).bind(componentId).all<ClaimEvent>(),
        binding.prepare(`SELECT i.id,i.reference,i.title,i.lifecycle AS state,i.opened_at AS startsAt,COALESCE(i.resolved_at,i.deleted_at) AS endsAt,
          (SELECT MIN(published_at) FROM incident_components a WHERE a.incident_id=i.id AND a.component_id=?) AS attachedAt
          FROM incidents i WHERE EXISTS (SELECT 1 FROM incident_components a WHERE a.incident_id=i.id AND a.component_id=? AND a.published_at IS NOT NULL)
          OR EXISTS (SELECT 1 FROM component_claim_events e WHERE e.component_id=? AND e.cause_type='incident' AND e.cause_id=i.id)
          OR EXISTS (SELECT 1 FROM component_state_history h WHERE h.component_id=? AND h.cause_type='incident' AND h.cause_id=i.id)
          ORDER BY i.opened_at,i.id`).bind(componentId, componentId, componentId, componentId).all<AffectedRecord & { attachedAt: string | null }>(),
        binding.prepare(`SELECT m.id,m.reference,m.title,m.state,m.starts_at AS startsAt,COALESCE(m.completed_at,m.ends_at) AS endsAt FROM maintenance m
          WHERE EXISTS (SELECT 1 FROM maintenance_components a WHERE a.maintenance_id=m.id AND a.component_id=?)
          OR EXISTS (SELECT 1 FROM component_claim_events e WHERE e.component_id=? AND e.cause_type='maintenance' AND e.cause_id=m.id)
          OR EXISTS (SELECT 1 FROM component_state_history h WHERE h.component_id=? AND h.cause_type='maintenance' AND h.cause_id=m.id)
          ORDER BY m.starts_at,m.id`).bind(componentId, componentId, componentId).all<AffectedRecord>(),
      ]);
      if (!settings) throw new Error("Page settings are not configured.");
      return { pageTimezone: settings.timezone, component: component ?? null, history, corrections, events: events.results, incidents: incidents.results, maintenance: maintenance.results };
    },
  };
}
