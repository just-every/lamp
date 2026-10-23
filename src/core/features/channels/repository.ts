import { incidentThresholdSql } from "../deliveries/subscriber-eligibility";
import { createUlid } from "../../shared/ids";
import type { IncidentImpact } from "../../shared/incident-impact";
import type { IncidentLifecycle } from "../../shared/domain";

export type ChannelKind = "slack" | "teams";
export interface ChannelDestination { id: string; kind: ChannelKind; name: string; sealedUrl: string; host: string; selectionMode: "all" | "selected"; createdAt: string; componentIds: string[] }
export interface PendingPost { incidentImpact: IncidentImpact | null; componentChangesJson: string; id: string; destinationId: string; kind: ChannelKind; incidentUpdateId: string; reference: string; title: string; lifecycle: IncidentLifecycle; customerImpact: string; affectedAudience: string; whatStillWorks: string; details: string; nextUpdateAt: string | null; timezone: string; publishedAt: string }

/** Slack and Teams channels a page posts its incident updates to, and the
 * posts each published update committed to them. */
export function createChannelRepository(db: D1Database) {
  return {
    async list(): Promise<ChannelDestination[]> {
      const rows = (await db.prepare("SELECT id, kind, name, sealed_url AS sealedUrl, host, selection_mode AS selectionMode, created_at AS createdAt FROM channel_destinations WHERE removed_at IS NULL ORDER BY created_at, id").all<Omit<ChannelDestination, "componentIds">>()).results;
      const selections = (await db.prepare("SELECT destination_id AS destinationId, component_id AS componentId FROM channel_destination_components").all<{ destinationId: string; componentId: string }>()).results;
      return rows.map((row) => ({ ...row, componentIds: selections.filter((selection) => selection.destinationId === row.id).map((selection) => selection.componentId) }));
    },
    async find(id: string) { return (await this.list()).find((row) => row.id === id) ?? null; },
    async insert(destination: Omit<ChannelDestination, "componentIds">, componentIds: string[], operatorId: string) {
      await db.batch([
        db.prepare("INSERT INTO channel_destinations (id, kind, name, sealed_url, host, selection_mode, created_by_operator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(destination.id, destination.kind, destination.name, destination.sealedUrl, destination.host, destination.selectionMode, operatorId, destination.createdAt, destination.createdAt),
        ...componentIds.map((componentId) => db.prepare("INSERT INTO channel_destination_components (destination_id, component_id) SELECT ?, id FROM components WHERE id = ?").bind(destination.id, componentId)),
      ]);
    },
    async remove(id: string, operatorId: string, removedAt: string) {
      // D1 batches commit atomically: a competing/repeated removal sees no active
      // row and records nothing. Never copy the sealed URL into the audit log.
      const results = await db.batch([
        db.prepare("INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at) SELECT ?, 'channel', id, 'deleted', ?, json_object('kind', kind, 'name', name), ?, ? FROM channel_destinations WHERE id = ? AND removed_at IS NULL").bind(createUlid(), operatorId, removedAt, removedAt, id),
        db.prepare("UPDATE channel_destinations SET removed_at = ?, updated_at = ? WHERE id = ? AND removed_at IS NULL").bind(removedAt, removedAt, id),
      ]);
      return results[1].meta.changes === 1;
    },
    /** Placed in the publish batch: one post per eligible channel, committed with the update. */
    postStatements(input: { updateId: string; componentIds: readonly string[]; queuedAt: string }): D1PreparedStatement[] {
      if (!input.componentIds.length) return [];
      const placeholders = input.componentIds.map(() => "?").join(", ");
      return [db.prepare(`INSERT OR IGNORE INTO channel_posts (id, incident_update_id, destination_id, queued_at)
        SELECT ? || '.' || d.id, ?, d.id, ? FROM channel_destinations d
        WHERE d.removed_at IS NULL AND (d.created_by_operator_id IS NOT NULL OR EXISTS(SELECT 1 FROM subscribers own WHERE own.id=d.id AND own.state='active')) AND NOT EXISTS (SELECT 1 FROM subscribers cs WHERE cs.id=d.id AND (cs.state<>'active' OR NOT EXISTS(SELECT 1 FROM json_each(cs.event_kinds_json) WHERE value='incidents') OR NOT ${incidentThresholdSql("(SELECT incident_id FROM incident_updates WHERE id = ?)", "cs")})) AND (
          (COALESCE((SELECT cs.selection_mode FROM subscribers cs WHERE cs.id=d.id),d.selection_mode) = 'all' AND EXISTS (SELECT 1 FROM components c WHERE c.id IN (${placeholders}) AND c.internal = 0))
          OR (COALESCE((SELECT cs.selection_mode FROM subscribers cs WHERE cs.id=d.id),d.selection_mode) = 'selected' AND (EXISTS (SELECT 1 FROM channel_destination_components s JOIN components c ON c.id = s.component_id WHERE s.destination_id = d.id AND NOT EXISTS(SELECT 1 FROM subscribers cs WHERE cs.id=d.id) AND s.component_id IN (${placeholders}) AND c.internal = 0) OR EXISTS(SELECT 1 FROM subscriber_components s JOIN components c ON c.id=s.component_id WHERE s.subscriber_id=d.id AND s.component_id IN (${placeholders}) AND c.internal=0))))`)
        .bind(input.updateId, input.updateId, input.queuedAt,input.updateId, ...input.componentIds, ...input.componentIds,...input.componentIds)];
    },
    async pending(limit: number): Promise<PendingPost[]> {
      return (await db.prepare(`SELECT p.id, p.incident_impact AS incidentImpact, p.destination_id AS destinationId, d.kind, p.incident_update_id AS incidentUpdateId, i.reference, i.title, u.lifecycle, u.customer_impact AS customerImpact, u.affected_audience AS affectedAudience, u.published_at AS publishedAt, u.component_changes_json AS componentChangesJson, u.what_still_works AS whatStillWorks, u.details, u.next_update_at AS nextUpdateAt, settings.timezone
        FROM channel_posts p JOIN channel_destinations d ON d.id = p.destination_id JOIN incident_updates u ON u.id = p.incident_update_id JOIN incidents i ON i.id = u.incident_id JOIN page_settings settings ON settings.id = 'default'
        WHERE d.removed_at IS NULL AND (d.created_by_operator_id IS NOT NULL OR EXISTS(SELECT 1 FROM subscribers own WHERE own.id=d.id AND own.state='active')) AND NOT EXISTS(SELECT 1 FROM subscribers cs WHERE cs.id=d.id AND cs.state<>'active') AND i.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM integration_deliveries x WHERE x.namespace = 'lamp-channels' AND x.id = p.id)
        ORDER BY p.queued_at, p.id LIMIT ?`).bind(limit).all<PendingPost>()).results;
    },
    async log(limit: number) {
      return (await db.prepare(`SELECT p.id, d.name AS channel, d.kind, i.reference, p.queued_at AS queuedAt, coalesce(x.state, 'queued') AS state, x.attempts
        FROM channel_posts p JOIN channel_destinations d ON d.id = p.destination_id JOIN incident_updates u ON u.id = p.incident_update_id JOIN incidents i ON i.id = u.incident_id
        LEFT JOIN integration_deliveries x ON x.namespace = 'lamp-channels' AND x.id = p.id ORDER BY p.queued_at DESC LIMIT ?`).bind(limit).all()).results;
    },
  };
}
export type ChannelRepository = ReturnType<typeof createChannelRepository>;
