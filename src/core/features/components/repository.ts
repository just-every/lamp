import { and, desc, eq, isNull, lte, ne, sql } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import {
  componentGroups,
  componentClaimEvents,
  componentStandingClaims,
  components,
  componentStateHistory,
  componentStateCorrections,
  incidentComponents,
  incidents,
  maintenance,
  maintenanceComponents,
} from "../../shared/schema";
import type { ComponentState } from "../../shared/domain";
import type { ComponentGroupUpdateInput, ComponentUpdateInput } from "../../shared/schemas";

export type StoredComponent = typeof components.$inferSelect;
export type StateClaimCause = { type: "standing-claim" | "incident" | "maintenance" | "correction"; id: string | null; operatorId: string | null };
export type StoredComponentGroup = typeof componentGroups.$inferSelect;
export type ComponentHistoryEntry = Pick<typeof componentStateHistory.$inferSelect, "id" | "previousState" | "newState" | "causeType" | "causeId" | "operatorId" | "changedAt" | "createdAt">;
export type ComponentHistoryCorrection = Pick<typeof componentStateCorrections.$inferSelect, "id" | "historyId" | "state" | "startsAt" | "endsAt" | "reason" | "operatorId" | "createdAt">;
export type ComponentClaimEvent = Pick<typeof componentClaimEvents.$inferSelect, "id" | "componentId" | "causeType" | "causeId" | "state" | "changedAt" | "createdAt">;
export type ComponentClaimEventInput = typeof componentClaimEvents.$inferInsert;
export type ComponentStateHistoryInput = { id: string; componentId: string; previousState: ComponentState; newState: ComponentState; cause: StateClaimCause; changedAt: string; createdAt: string; updatedAt: string };

export interface ComponentRepository {
  listComponents(): Promise<Array<StoredComponent & { groupName: string | null }>>;
  reorder(kind: "components" | "groups", expectedIds: string[], orderedIds: string[], groupId: string | null): Promise<void>;
  listGroups(): Promise<StoredComponentGroup[]>;
  findComponent(componentId: string): Promise<StoredComponent | null>;
  findStandingClaimState(componentId: string): Promise<ComponentState | null>;
  listClaims(componentId: string): Promise<ComponentState[]>;
  listClaimEventsAt(componentId: string, instant: string): Promise<ComponentClaimEvent[]>;
  listClaimEventTimes(componentId: string, startsAt: string, endsAt: string): Promise<string[]>;
  listHistoryBetween(componentId: string, startsAt: string, endsAt: string): Promise<ComponentHistoryEntry[]>;
  findStateBefore(componentId: string, instant: string): Promise<ComponentState | null>;
  hasUnprovenClaimHistorySince(componentId: string, instant: string): Promise<boolean>;
  findLastState(componentId: string): Promise<ComponentState | null>;
  appendStateHistory(input: ComponentStateHistoryInput): Promise<void>;
  findStateAt(componentId: string, instant: string): Promise<ComponentState | null>;
  listHistory(componentId: string): Promise<ComponentHistoryEntry[]>;
  listCorrections(componentId: string): Promise<ComponentHistoryCorrection[]>;
  appendCorrection(input: typeof componentStateCorrections.$inferInsert): Promise<void>;
  appendCorrectionAudit(input: { id: string; historyId: string; operatorId: string; reason: string; payloadJson: string; createdAt: string; updatedAt: string }): Promise<void>;
  replaceStandingClaim(input: { id: string; componentId: string; state: ComponentState | null; operatorId: string; createdAt: string; updatedAt: string; event: ComponentClaimEventInput }): Promise<void>;
  insertGroup(input: typeof componentGroups.$inferInsert): Promise<void>;
  updateGroup(groupId: string, input: ComponentGroupUpdateInput & { updatedAt: string }): Promise<boolean>;
  deleteGroup(groupId: string): Promise<boolean>;
  insertComponent(input: typeof components.$inferInsert, initialState: { event: ComponentClaimEventInput; history: ComponentStateHistoryInput }): Promise<void>;
  updateComponent(componentId: string, input: ComponentUpdateInput & { updatedAt: string }): Promise<boolean>;
  deleteComponent(componentId: string): Promise<boolean>;
}

export function createComponentRepository(binding: D1Database): ComponentRepository {
  const database = createDatabase(binding);

  return {
    async listComponents() {
      return database
        .select({
          id: components.id,
          groupId: components.groupId,
          name: components.name,
          description: components.description,
          internal: components.internal,
          displayOrder: components.displayOrder,
          note: components.note,
          createdAt: components.createdAt,
          updatedAt: components.updatedAt,
          groupName: componentGroups.name,
        })
        .from(components)
        .leftJoin(componentGroups, eq(components.groupId, componentGroups.id))
        .orderBy(componentGroups.displayOrder, components.displayOrder, components.id)
        .all();
    },
    async reorder(kind, expectedIds, orderedIds, groupId) {
      const table = kind === "groups" ? "component_groups" : "components";
      const scope = kind === "groups" ? "1 = 1" : "group_id IS ?";
      const scopeBindings = kind === "groups" ? [] : [groupId];
      // D1 batches are transactions. Compare the complete current membership and
      // order inside that transaction, before touching ordering alone. A stale
      // move cannot partially apply or move a concurrently regrouped component.
      const guard = binding.prepare(`SELECT CASE WHEN
        (SELECT json_group_array(id) FROM (SELECT id FROM ${table} WHERE ${scope} ORDER BY display_order, id)) = ?
        THEN 1 ELSE json('Ordering changed; refresh and try again.') END`)
        .bind(...scopeBindings, JSON.stringify(expectedIds));
      const timestamp = new Date().toISOString();
      const statements = [guard];
      // Group positions are unique; first move all into a disjoint negative
      // range, then assign the complete contiguous order in the same batch.
      if (kind === "groups") statements.push(binding.prepare("UPDATE component_groups SET display_order = -display_order - 1"));
      statements.push(...orderedIds.map((id, index) => binding.prepare(`UPDATE ${table} SET display_order = ?, updated_at = ? WHERE id = ?`).bind(index, timestamp, id)));
      try { await binding.batch(statements); }
      catch (cause) { if (cause instanceof Error && cause.message.includes("malformed JSON")) throw new Error("Ordering changed in another tab. Refresh and try again."); throw cause; }
    },
    async listGroups() {
      return database.select().from(componentGroups).orderBy(componentGroups.displayOrder, componentGroups.id).all();
    },
    async findComponent(componentId) {
      const component = await database.select().from(components).where(eq(components.id, componentId)).get();
      return component ?? null;
    },
    async findStandingClaimState(componentId) {
      const claim = await database
        .select({ state: componentStandingClaims.state })
        .from(componentStandingClaims)
        .where(eq(componentStandingClaims.componentId, componentId))
        .get();
      return claim?.state ?? null;
    },
    async listClaims(componentId) {
      const [standing, incident, scheduledMaintenance] = await Promise.all([
        database.select({ state: componentStandingClaims.state }).from(componentStandingClaims).where(eq(componentStandingClaims.componentId, componentId)).all(),
        database
          .select({ state: incidentComponents.state })
          .from(incidentComponents)
          .innerJoin(incidents, eq(incidentComponents.incidentId, incidents.id))
          .where(and(eq(incidentComponents.componentId, componentId), isNull(incidents.deletedAt), ne(incidents.lifecycle, "Resolved"), sql`incident_components.published_at IS NOT NULL`))
          .all(),
        database
          .select({ state: maintenanceComponents.state })
          .from(maintenanceComponents)
          .innerJoin(maintenance, eq(maintenanceComponents.maintenanceId, maintenance.id))
          .where(and(eq(maintenanceComponents.componentId, componentId), eq(maintenance.state, "In progress")))
          .all(),
      ]);

      return [...standing, ...incident, ...scheduledMaintenance].map((claim) => claim.state);
    },
    async listClaimEventsAt(componentId, instant) {
      const events = await binding.prepare(`
        SELECT id, component_id AS componentId, cause_type AS causeType, cause_id AS causeId, state, changed_at AS changedAt, created_at AS createdAt
        FROM (
          SELECT id, component_id, cause_type, cause_id, state, changed_at, created_at,
            ROW_NUMBER() OVER (
              PARTITION BY cause_type, COALESCE(cause_id, '')
              ORDER BY changed_at DESC, created_at DESC, id DESC
            ) AS position
          FROM component_claim_events
          WHERE component_id = ? AND changed_at <= ?
        ) AS latest
        WHERE position = 1
      `).bind(componentId, instant).all<ComponentClaimEvent>();
      return events.results;
    },
    async listClaimEventTimes(componentId, startsAt, endsAt) {
      const result = await binding.prepare(`SELECT DISTINCT changed_at AS changedAt FROM component_claim_events WHERE component_id = ? AND changed_at >= ? AND changed_at <= ? ORDER BY changed_at ASC`)
        .bind(componentId, startsAt, endsAt).all<{ changedAt: string }>();
      return result.results.map((entry) => entry.changedAt);
    },
    async listHistoryBetween(componentId, startsAt, endsAt) {
      return database
        .select({
          id: componentStateHistory.id,
          previousState: componentStateHistory.previousState,
          newState: componentStateHistory.newState,
          causeType: componentStateHistory.causeType,
          causeId: componentStateHistory.causeId,
          operatorId: componentStateHistory.operatorId,
          changedAt: componentStateHistory.changedAt,
          createdAt: componentStateHistory.createdAt,
        })
        .from(componentStateHistory)
        .where(and(eq(componentStateHistory.componentId, componentId), sql`${componentStateHistory.changedAt} >= ${startsAt}`, lte(componentStateHistory.changedAt, endsAt)))
        .orderBy(componentStateHistory.changedAt, componentStateHistory.createdAt, componentStateHistory.id)
        .all();
    },
    async findStateBefore(componentId, instant) {
      const state = await database
        .select({ state: componentStateHistory.newState })
        .from(componentStateHistory)
        .where(and(eq(componentStateHistory.componentId, componentId), sql`${componentStateHistory.changedAt} < ${instant}`))
        .orderBy(desc(componentStateHistory.changedAt), desc(componentStateHistory.createdAt), desc(componentStateHistory.id))
        .get();
      return state?.state ?? null;
    },
    async hasUnprovenClaimHistorySince(componentId, instant) {
      const result = await binding.prepare(`
        SELECT EXISTS(
          SELECT 1
          FROM component_state_history AS history
          WHERE history.component_id = ?
            AND history.cause_type <> 'correction'
            AND (
              (
                history.changed_at >= ?
                AND NOT (history.previous_state = 'Operational' AND history.new_state = 'Operational')
              )
              OR (
                history.id = (
                  SELECT baseline.id
                  FROM component_state_history AS baseline
                  WHERE baseline.component_id = history.component_id
                    AND baseline.cause_type <> 'correction'
                    AND baseline.changed_at <= ?
                  ORDER BY baseline.changed_at DESC, baseline.created_at DESC, baseline.id DESC
                  LIMIT 1
                )
                AND history.new_state <> 'Operational'
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM component_claim_events AS event
              WHERE event.component_id = history.component_id
                AND event.cause_type = history.cause_type
                AND event.cause_id IS history.cause_id
                AND (
                  event.changed_at = history.changed_at
                  OR (
                    event.state IS NOT NULL
                    AND event.changed_at < history.changed_at
                    AND NOT EXISTS (
                      SELECT 1
                      FROM component_claim_events AS later_event
                      WHERE later_event.component_id = event.component_id
                        AND later_event.cause_type = event.cause_type
                        AND later_event.cause_id IS event.cause_id
                        AND later_event.changed_at > event.changed_at
                        AND later_event.changed_at <= history.changed_at
                    )
                  )
                )
            )
        ) AS hasUnprovenHistory
      `).bind(componentId, instant, instant).first<{ hasUnprovenHistory: number }>();
      return result?.hasUnprovenHistory === 1;
    },
    async findLastState(componentId) {
      const state = await database
        .select({ state: componentStateHistory.newState })
        .from(componentStateHistory)
        .where(eq(componentStateHistory.componentId, componentId))
        .orderBy(desc(componentStateHistory.changedAt), desc(componentStateHistory.createdAt), desc(componentStateHistory.id))
        .get();
      return state?.state ?? null;
    },
    async appendStateHistory(input) {
      await database.insert(componentStateHistory).values({
        id: input.id,
        componentId: input.componentId,
        previousState: input.previousState,
        newState: input.newState,
        causeType: input.cause.type,
        causeId: input.cause.id,
        operatorId: input.cause.operatorId,
        changedAt: input.changedAt,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      });
    },
    async findStateAt(componentId, instant) {
      const state = await database
        .select({ state: componentStateHistory.newState })
        .from(componentStateHistory)
        .where(and(eq(componentStateHistory.componentId, componentId), lte(componentStateHistory.changedAt, instant)))
        .orderBy(desc(componentStateHistory.changedAt), desc(componentStateHistory.createdAt), desc(componentStateHistory.id))
        .get();
      return state?.state ?? null;
    },
    async listHistory(componentId) {
      return database
        .select({
          id: componentStateHistory.id,
          previousState: componentStateHistory.previousState,
          newState: componentStateHistory.newState,
          causeType: componentStateHistory.causeType,
          causeId: componentStateHistory.causeId,
          operatorId: componentStateHistory.operatorId,
          changedAt: componentStateHistory.changedAt,
          createdAt: componentStateHistory.createdAt,
        })
        .from(componentStateHistory)
        .where(eq(componentStateHistory.componentId, componentId))
        .orderBy(desc(componentStateHistory.changedAt), desc(componentStateHistory.createdAt))
        .all();
    },
    async listCorrections(componentId) {
      return database
        .select({
          id: componentStateCorrections.id,
          historyId: componentStateCorrections.historyId,
          state: componentStateCorrections.state,
          startsAt: componentStateCorrections.startsAt,
          endsAt: componentStateCorrections.endsAt,
          reason: componentStateCorrections.reason,
          operatorId: componentStateCorrections.operatorId,
          createdAt: componentStateCorrections.createdAt,
        })
        .from(componentStateCorrections)
        .where(eq(componentStateCorrections.componentId, componentId))
        .orderBy(desc(componentStateCorrections.createdAt))
        .all();
    },
    async appendCorrection(input) {
      await database.insert(componentStateCorrections).values(input);
    },
    async appendCorrectionAudit(input) {
      await binding.prepare(`INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, reason, payload_json, created_at, updated_at) VALUES (?, 'component-state-history', ?, 'corrected', ?, ?, ?, ?, ?)`)
        .bind(input.id, input.historyId, input.operatorId, input.reason, input.payloadJson, input.createdAt, input.updatedAt).run();
    },
    async replaceStandingClaim(input) {
      const claim = input.state
        ? binding.prepare(`INSERT INTO component_standing_claims (id, component_id, state, operator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(component_id) DO UPDATE SET state = excluded.state, operator_id = excluded.operator_id, updated_at = excluded.updated_at`)
          .bind(input.id, input.componentId, input.state, input.operatorId, input.createdAt, input.updatedAt)
        : binding.prepare(`DELETE FROM component_standing_claims WHERE component_id = ?`).bind(input.componentId);
      const event = binding.prepare(`INSERT INTO component_claim_events (id, component_id, cause_type, cause_id, state, changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(input.event.id, input.event.componentId, input.event.causeType, input.event.causeId, input.event.state, input.event.changedAt, input.event.createdAt, input.event.updatedAt);
      await binding.batch([claim, event]);
    },
    async insertGroup(input) {
      await database.insert(componentGroups).values(input);
    },
    async updateGroup(groupId, input) {
      // A name edit must not read and rewrite a position that can move meanwhile.
      if (input.displayOrder === undefined) {
        const result = await database.update(componentGroups).set({ name: input.name, updatedAt: input.updatedAt }).where(eq(componentGroups.id, groupId)).returning({ id: componentGroups.id });
        return result.length > 0;
      }
      const current = await database.select().from(componentGroups).where(eq(componentGroups.id, groupId)).get();
      if (!current) return false;
      const displaced = current.displayOrder === input.displayOrder
        ? null
        : await database.select().from(componentGroups).where(eq(componentGroups.displayOrder, input.displayOrder)).get();
      if (!displaced) {
        const result = await database.update(componentGroups).set(input).where(eq(componentGroups.id, groupId)).returning({ id: componentGroups.id });
        return result.length > 0;
      }

      // `display_order` is unique. Free the target's old position before
      // moving the occupied position into it, so an operator can set a group
      // order to any currently visible value without a transient constraint
      // failure. D1 executes its batch atomically.
      await binding.batch([
        binding.prepare("UPDATE component_groups SET display_order = ?, updated_at = ? WHERE id = ?").bind(-1, input.updatedAt, current.id),
        binding.prepare("UPDATE component_groups SET display_order = ?, updated_at = ? WHERE id = ?").bind(current.displayOrder, input.updatedAt, displaced.id),
        binding.prepare("UPDATE component_groups SET name = ?, display_order = ?, updated_at = ? WHERE id = ?").bind(input.name, input.displayOrder, input.updatedAt, current.id),
      ]);
      return true;
    },
    async deleteGroup(groupId) {
      const result = await database.delete(componentGroups).where(eq(componentGroups.id, groupId)).returning({ id: componentGroups.id });
      return result.length > 0;
    },
    async insertComponent(input, initialState) {
      await binding.batch([
        binding.prepare(`INSERT INTO components (id,group_id,name,description,internal,display_order,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .bind(input.id, input.groupId, input.name, input.description, input.internal ? 1 : 0, input.displayOrder, input.note, input.createdAt, input.updatedAt),
        binding.prepare(`INSERT INTO component_claim_events (id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
          .bind(initialState.event.id, initialState.event.componentId, initialState.event.causeType, initialState.event.causeId, initialState.event.state, initialState.event.changedAt, initialState.event.createdAt, initialState.event.updatedAt),
        binding.prepare(`INSERT INTO component_state_history (id,component_id,previous_state,new_state,cause_type,cause_id,operator_id,changed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .bind(initialState.history.id, initialState.history.componentId, initialState.history.previousState, initialState.history.newState, initialState.history.cause.type, initialState.history.cause.id, initialState.history.cause.operatorId, initialState.history.changedAt, initialState.history.createdAt, initialState.history.updatedAt),
      ]);
    },
    async updateComponent(componentId, input) {
      // Drizzle omits undefined fields: an edit without an explicit order leaves
      // display_order untouched in the UPDATE itself, even across concurrent moves.
      const result = await database.update(components).set(input).where(eq(components.id, componentId)).returning({ id: components.id });
      return result.length > 0;
    },
    async deleteComponent(componentId) {
      const result = await database.delete(components).where(eq(components.id, componentId)).returning({ id: components.id });
      return result.length > 0;
    },
  };
}
