import { createIncidentSubscriptionLifecycleRepository } from "./incident-lifecycle.repository";
import { createIncidentSubscriptionRepository } from "./incident.repository";
import { createSubscriberPreferencesRepository } from "./preferences.repository";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import { componentGroups, components, subscriberComponents, subscribers, subscriberDirectory } from "../../shared/schema";
import { publicComponentOrder } from "../../shared/component-order";
import { subscriberTokens } from "../deliveries/schema";
import { createUlid } from "../../shared/ids";
import { subscriberExpiryAudit } from "../statuspage-import/expiry-audit";
import { createSubscriberTransitions, type SubscriberTransitions } from "./transitions.repository";
import { retireSubscriberCustody, subjectsInCustody } from "../statuspage-import/custody";
import type { D1Sql } from "../../../../modules/import-kit/src/d1/index.ts";
import { createSubscriberIntakeRepository, type SubscriberIntakeRepository } from "./intake.repository";
import { createSubscriberLimitRepository } from "./limits.repository";
import { SubscriberLimitError } from "./limits";
import { createWebhookFormatRepository } from "./webhook-format.repository";

export type StoredSubscriber = typeof subscribers.$inferSelect;
export type StoredSubscriberComponent = typeof subscriberComponents.$inferSelect;
export type StoredSubscriberToken = typeof subscriberTokens.$inferSelect;
export type SubscriptionMailKind = "confirmation" | "already-subscribed" | "subscribed";

export interface SubscriberRepository extends SubscriberTransitions {
  incidentLifecycle: ReturnType<typeof createIncidentSubscriptionLifecycleRepository>;
  incidents: ReturnType<typeof createIncidentSubscriptionRepository>;
  preferences: ReturnType<typeof createSubscriberPreferencesRepository>;
  intake: SubscriberIntakeRepository;
  limits: ReturnType<typeof createSubscriberLimitRepository>;
  formats: ReturnType<typeof createWebhookFormatRepository>;
  listSubscribers(limit: number, offset?: number): Promise<StoredSubscriber[]>;
  listComponents(subscriberId: string): Promise<StoredSubscriberComponent[]>;
  listVisibleComponents(): Promise<Array<{ id: string; name: string }>>;
  findSubscriber(subscriberId: string): Promise<StoredSubscriber | null>;
  findSubscriberByDestination(destination: string): Promise<StoredSubscriber | null>;
  findSubscriberByToken(tokenHash: string, scope: "confirm" | "manage" | "unsubscribe", now: string): Promise<{ subscriber: StoredSubscriber; token: StoredSubscriberToken } | null>;
  createPendingSubscriber(input: typeof subscribers.$inferInsert): Promise<void>;
  updateSelection(subscriberId: string, componentIds: string[], now: string): Promise<void>;
  ensureToken(subscriberId: string, scope: "confirm" | "manage" | "unsubscribe", candidate: { id: string; tokenHash: string; expiresAt: string | null }, now: string): Promise<string>;
  ensureManagedUnsubscribeToken(subscriberId: string, manageTokenHash: string, candidate: { id: string; tokenHash: string }, now: string): Promise<string | null>;
  revokeTokens(subscriberId: string, now: string, scope?: "confirm" | "manage" | "unsubscribe"): Promise<void>;
  deactivateSubscriber(subscriberId: string, reason: string, now: string): Promise<void>;
  anonymizeAndDeactivate(subscriberId: string, operatorId: string | null, now: string): Promise<void>;
  /** Deletes expired unconfirmed subscribers, erasing at most `custodyErasures` of
   * those an import holds from its custody (each is its own D1 batch); the
   * rest wait for a later run. */
  deleteExpiredPending(cutoff: string, custodyErasures: number): Promise<void>;
  recordConfirmationSendIfAllowed(emailHash: string, cutoff: string, now: string): Promise<boolean>;
  /** An audit entry on the subscriber: no address is copied, so erasure of the subscriber erases what it shows. */
  recordSubscriptionMail(subscriberId: string, kind: SubscriptionMailKind, outcome: "accepted" | "suppressed" | "failed", now: string): Promise<void>;
}

export function createSubscriberRepository(binding: D1Database): SubscriberRepository {
  const database = createDatabase(binding);
  return {
    incidentLifecycle: createIncidentSubscriptionLifecycleRepository(binding),
    incidents: createIncidentSubscriptionRepository(binding),
    preferences: createSubscriberPreferencesRepository(binding),
    intake: createSubscriberIntakeRepository(binding),
    limits: createSubscriberLimitRepository(binding),
    formats: createWebhookFormatRepository(binding),
    ...createSubscriberTransitions(binding),
    async listSubscribers(limit, offset = 0) {
      return database.select().from(subscriberDirectory).orderBy(asc(subscriberDirectory.createdAt)).limit(limit).offset(offset).all();
    },
    async listComponents(subscriberId) {
      return database.select().from(subscriberComponents).where(eq(subscriberComponents.subscriberId, subscriberId)).all();
    },
    async listVisibleComponents() {
      const rows = await database.select({ id: components.id, name: components.name, groupName: componentGroups.name, groupOrder: componentGroups.displayOrder, displayOrder: components.displayOrder })
        .from(components)
        .leftJoin(componentGroups, eq(components.groupId, componentGroups.id))
        .where(eq(components.internal, false))
        .all();
      return publicComponentOrder(rows).map(({ id, name }) => ({ id, name }));
    },
    async findSubscriber(subscriberId) {
      return (await database.select().from(subscriberDirectory).where(eq(subscriberDirectory.id, subscriberId)).get()) ?? null;
    },
    async findSubscriberByDestination(destination) {
      return (await database.select().from(subscriberDirectory).where(and(eq(subscriberDirectory.destination, destination), sql`NOT EXISTS (SELECT 1 FROM incident_subscriptions f WHERE f.subscriber_id = ${subscriberDirectory.id})`)).get()) ?? null;
    },
    async findSubscriberByToken(tokenHash, scope, now) {
      const row = await database.select({ subscriber: subscriberDirectory, token: subscriberTokens }).from(subscriberTokens)
        .innerJoin(subscriberDirectory, eq(subscriberTokens.subscriberId, subscriberDirectory.id))
        .where(and(eq(subscriberTokens.tokenHash, tokenHash), eq(subscriberTokens.scope, scope), isNull(subscriberTokens.revokedAt), gt(subscriberTokens.expiresAt, now))).get();
      // Non-expiring manage and unsubscribe tokens have a NULL expires_at.
      if (row) return row;
      return (await database.select({ subscriber: subscriberDirectory, token: subscriberTokens }).from(subscriberTokens)
        .innerJoin(subscriberDirectory, eq(subscriberTokens.subscriberId, subscriberDirectory.id))
        .where(and(eq(subscriberTokens.tokenHash, tokenHash), eq(subscriberTokens.scope, scope), isNull(subscriberTokens.revokedAt), isNull(subscriberTokens.expiresAt))).get()) ?? null;
    },
    async createPendingSubscriber(input) {
      try { await database.insert(subscribers).values(input).onConflictDoUpdate({
        target: subscribers.destination,
        set: { state: input.state, selectionMode: input.selectionMode, deactivationReason: null, deactivatedAt: null,
          // A fresh opt-in starts a fresh pending lifetime. Ordinary repeated
          // requests and import invitations retain their original deadline.
          createdAt: sql`CASE WHEN ${subscribers.state} = 'deactivated' THEN ${input.createdAt} ELSE ${subscribers.createdAt} END`,
          updatedAt: input.updatedAt },
      }); } catch(cause) {if(cause instanceof Error && cause.message.includes("over the subscriber limit"))throw new SubscriberLimitError();throw cause;}
    },
    async updateSelection(subscriberId, componentIds, now) {
      const statements: D1PreparedStatement[] = [binding.prepare("DELETE FROM subscriber_components WHERE subscriber_id = ?").bind(subscriberId)];
      for (const componentId of componentIds) {
        statements.push(binding.prepare("INSERT INTO subscriber_components (id, subscriber_id, component_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
          .bind(createUlid(), subscriberId, componentId, now, now));
      }
      statements.push(binding.prepare("UPDATE subscribers SET selection_mode = ?, updated_at = ? WHERE id = ?").bind(componentIds.length ? "selected" : "all", now, subscriberId));
      await binding.batch(statements);
    },
    async ensureToken(subscriberId, scope, candidate, now) {
      // Allocate or reuse in one transaction. Reuse may shorten a deadline but
      // never extend it: a public request racing an import invitation must not
      // replace its original confirmation window with a fresh 72 hours.
      const results = await binding.batch<{ id: string }>([
        binding.prepare(`UPDATE subscriber_tokens SET revoked_at = ?, updated_at = ?
          WHERE subscriber_id = ? AND scope = ? AND revoked_at IS NULL
            AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
          .bind(now, now, subscriberId, scope),
        binding.prepare(`UPDATE subscriber_tokens SET expires_at = ?, updated_at = ?
          WHERE subscriber_id = ? AND scope = ? AND revoked_at IS NULL
            AND ? IS NOT NULL AND (expires_at IS NULL OR expires_at > ?)`)
          .bind(candidate.expiresAt, now, subscriberId, scope, candidate.expiresAt, candidate.expiresAt),
        binding.prepare(`INSERT INTO subscriber_tokens (id, subscriber_id, scope, token_hash, expires_at, revoked_at, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, NULL, ?, ? WHERE NOT EXISTS (
            SELECT 1 FROM subscriber_tokens WHERE subscriber_id = ? AND scope = ? AND revoked_at IS NULL
          )`)
          .bind(candidate.id, subscriberId, scope, candidate.tokenHash, candidate.expiresAt, now, now, subscriberId, scope),
        binding.prepare('SELECT id FROM subscriber_tokens WHERE subscriber_id = ? AND scope = ? AND revoked_at IS NULL')
          .bind(subscriberId, scope),
      ]);
      const id = results[3].results[0]?.id;
      if (!id) throw new Error("Subscriber token was not stored.");
      return id;
    },
    async ensureManagedUnsubscribeToken(subscriberId, manageTokenHash, candidate, now) {
      // Both allocation and reuse require the originating manage permission in
      // this transaction. Active state alone would authorize an old request
      // after the same subscriber row has opted out and joined again.
      const authorized = `EXISTS (
        SELECT 1 FROM subscriber_tokens AS permission
        JOIN subscriber_directory AS subscribers ON subscribers.id = permission.subscriber_id
        WHERE subscribers.id = ? AND subscribers.state = 'active'
          AND permission.token_hash = ? AND permission.scope = 'manage'
          AND permission.revoked_at IS NULL
          AND (permission.expires_at IS NULL OR permission.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`;
      const results = await binding.batch<{ id: string }>([
        binding.prepare(`UPDATE subscriber_tokens SET revoked_at = ?, updated_at = ?
          WHERE subscriber_id = ? AND scope = 'unsubscribe' AND revoked_at IS NULL
            AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AND ${authorized}`)
          .bind(now, now, subscriberId, subscriberId, manageTokenHash),
        binding.prepare(`INSERT INTO subscriber_tokens (id, subscriber_id, scope, token_hash, expires_at, revoked_at, created_at, updated_at)
          SELECT ?, ?, 'unsubscribe', ?, NULL, NULL, ?, ? WHERE ${authorized}
            AND NOT EXISTS (SELECT 1 FROM subscriber_tokens WHERE subscriber_id = ? AND scope = 'unsubscribe' AND revoked_at IS NULL)`)
          .bind(candidate.id, subscriberId, candidate.tokenHash, now, now, subscriberId, manageTokenHash, subscriberId),
        binding.prepare(`SELECT id FROM subscriber_tokens
          WHERE subscriber_id = ? AND scope = 'unsubscribe' AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AND ${authorized}`)
          .bind(subscriberId, subscriberId, manageTokenHash),
      ]);
      return results[2].results[0]?.id ?? null;
    },
    async revokeTokens(subscriberId, now, scope) {
      const clause = scope ? and(eq(subscriberTokens.subscriberId, subscriberId), eq(subscriberTokens.scope, scope), isNull(subscriberTokens.revokedAt)) : and(eq(subscriberTokens.subscriberId, subscriberId), isNull(subscriberTokens.revokedAt));
      await database.update(subscriberTokens).set({ revokedAt: now, updatedAt: now }).where(clause);
    },
    async deactivateSubscriber(subscriberId, reason, now) {
      await binding.batch([
        binding.prepare("UPDATE subscribers SET state = 'deactivated', deactivation_reason = ?, deactivated_at = ?, updated_at = ? WHERE id = ?").bind(reason, now, now, subscriberId),
        binding.prepare("UPDATE subscriber_tokens SET revoked_at = ?, updated_at = ? WHERE subscriber_id = ? AND revoked_at IS NULL").bind(now, now, subscriberId),
      ]);
    },
    async anonymizeAndDeactivate(subscriberId, operatorId, now) {
      // Keep the opaque core identifier and the responsible operator, but no
      // personally identifying destination or contact address in the audit.
      const subscriber = await database.select({ destination: subscriberDirectory.destination, contactEmail: subscriberDirectory.contactEmail }).from(subscriberDirectory).where(eq(subscriberDirectory.id, subscriberId)).get();
      if (!subscriber || subscriber.destination === `deleted:${subscriberId}`) return;
      const replacement = `deleted:${subscriberId}`;
      const personalValues = [...new Set([subscriber.destination, subscriber.contactEmail].filter((value): value is string => Boolean(value)))];
      const removeRecipients = personalValues.map((value): D1Sql => ({
        // A deleted webhook contact must not be replaced with a synthetic
        // email-like destination. Keep the operator-alert record, but remove
        // this recipient before a later outbox attempt can address it. Only
        // the alert addressed to this subscriber's contact is touched: the
        // same address may be an operator's, and their other alerts stay.
        sql: `UPDATE notification_outbox
          SET payload_json = json_set(payload_json, '$.recipients', json((SELECT json_group_array(value) FROM json_each(notification_outbox.payload_json, '$.recipients') WHERE value <> ?)))
          WHERE kind = 'operator-alert' AND aggregate_id = ? AND json_valid(payload_json)
            AND EXISTS (SELECT 1 FROM json_each(notification_outbox.payload_json, '$.recipients') WHERE value = ?)`,
        params: [value, `webhook-deactivated/${subscriberId}`, value],
      }));
      // A frozen envelope is retained for idempotency, but its recipient
      // cannot outlive an operator-initiated subscriber deletion. Only this
      // subscriber's own envelopes are rewritten; alert text never carries an
      // address, and another person's address may contain this one.
      const redactions = personalValues.flatMap((value) => ["notification_deliveries", "component_notification_deliveries"].map((table): D1Sql => ({
        sql: `UPDATE ${table} SET mail_payload_json = replace(mail_payload_json, ?, ?) WHERE subscriber_id = ? AND mail_payload_json IS NOT NULL`,
        params: [value, replacement, subscriberId],
      })));
      const native: D1Sql[] = [
        ...removeRecipients,
        ...redactions,
        { sql: "DELETE FROM subscriber_chat_destinations WHERE subscriber_id = ?", params: [subscriberId] },
        { sql: "UPDATE subscribers SET destination = ?, contact_email = NULL, state = 'deactivated', deactivation_reason = 'deleted by operator', deactivated_at = ?, updated_at = ? WHERE id = ?", params: [`deleted:${subscriberId}`, now, now, subscriberId] },
        { sql: "UPDATE subscriber_tokens SET revoked_at = ?, updated_at = ? WHERE subscriber_id = ? AND revoked_at IS NULL", params: [now, now, subscriberId] },
      ];
      // An imported subscriber stops being an import target: its selections and
      // import marker go, and only the anonymised record stays.
      const imported: D1Sql[] = [
        { sql: "DELETE FROM subscriber_components WHERE subscriber_id = ?", params: [subscriberId] },
        { sql: "DELETE FROM statuspage_import_targets WHERE kind = 'subscriber' AND id = ?", params: [subscriberId] },
      ];
      const audit: D1Sql = { sql: "INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at) SELECT ?, 'subscriber', ?, 'deleted', ?, '{}', ?, ? WHERE NOT EXISTS (SELECT 1 FROM audit_entries WHERE entity_type = 'subscriber' AND entity_id = ? AND action = 'deleted')", params: [createUlid(), subscriberId, operatorId, now, now, subscriberId] };
      // An import's retained copies of this subscriber go in the same batch.
      const subject = { id: subscriberId, values: personalValues };
      if ((await subjectsInCustody(binding, [subject])).length) {
        await retireSubscriberCustody(binding, subject, [...native, ...imported], [audit], { principalId: operatorId ?? "lamp:incident-follow-expiry", authority: operatorId
          ? { sql: "EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active')", params: [operatorId] }
          : { sql: "EXISTS(SELECT 1 FROM incident_subscriptions WHERE subscriber_id=? AND ended_at<=?)", params: [subscriberId,new Date(Date.parse(now)-24*60*60*1000).toISOString()] } });
        return;
      }
      await binding.batch([...native, audit].map((statement) => binding.prepare(statement.sql).bind(...statement.params ?? [])));
    },
    async deleteExpiredPending(cutoff, custodyErasures) {
      const expired = (await binding.prepare("SELECT id, destination, contact_email FROM subscriber_directory AS subscribers WHERE state = 'pending' AND created_at < ?").bind(cutoff).all<{ id: string; destination: string; contact_email: string | null }>()).results;
      if (!expired.length) return;
      // An unconfirmed subscriber an import holds leaves import custody with
      // its row; the rest are ordinary deletions.
      const held = await subjectsInCustody(binding, expired.map((row) => ({ id: row.id, values: [row.destination, row.contact_email ?? ""].filter(Boolean) })));
      const predicate = { sql: "state = 'pending' AND created_at < ? AND id NOT IN (SELECT value FROM json_each(?))", params: [cutoff, JSON.stringify(held.map((subject) => subject.id))] };
      const at = new Date().toISOString();
      const audit = subscriberExpiryAudit(predicate, at);
      await binding.batch([
        binding.prepare(audit.sql).bind(...audit.params ?? []),
        binding.prepare(`DELETE FROM subscribers WHERE ${predicate.sql}`).bind(...predicate.params),
      ]);
      for (const subject of held.slice(0, custodyErasures)) {
        const deletion: D1Sql = { sql: "DELETE FROM subscribers WHERE id = ? AND state = 'pending' AND created_at < ?", params: [subject.id, cutoff] };
        // Admitted while the row is still expired and unconfirmed, and after its deletion.
        const marker: D1Sql = { sql: "DELETE FROM statuspage_import_targets WHERE kind = 'subscriber' AND id = ?", params: [subject.id] };
        await retireSubscriberCustody(binding, subject, [marker], [subscriberExpiryAudit({ sql: "id = ? AND state = 'pending' AND created_at < ?", params: [subject.id, cutoff] }, at), deletion], { principalId: "lamp:pending-expiry", authority: { sql: "NOT EXISTS(SELECT 1 FROM subscriber_directory AS subscribers WHERE id = ? AND (state <> 'pending' OR created_at >= ?))", params: [subject.id, cutoff] } });
      }
    },
    async recordConfirmationSendIfAllowed(emailHash, cutoff, now) {
      const result = await binding.prepare(
        "INSERT INTO subscriber_confirmation_attempts (email_hash, last_sent_at, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(email_hash) DO UPDATE SET last_sent_at = excluded.last_sent_at, updated_at = excluded.updated_at WHERE subscriber_confirmation_attempts.last_sent_at < ?",
      ).bind(emailHash, now, now, now, cutoff).run();
      return result.meta.changes === 1;
    },
    async recordSubscriptionMail(subscriberId, kind, outcome, now) {
      await binding.prepare("INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at) VALUES (?, 'subscriber', ?, 'subscription-mail', NULL, ?, ?, ?)")
        .bind(createUlid(), subscriberId, JSON.stringify({ kind, outcome }), now, now).run();
    },
  };
}
