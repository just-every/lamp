import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import { componentGroups, components, subscriberComponents, subscribers } from "../../shared/schema";
import { publicComponentOrder } from "../../shared/component-order";
import { subscriberTokens } from "../deliveries/schema";
import { createUlid } from "../../shared/ids";
import { createSubscriberTransitions, type SubscriberTransitions } from "./transitions.repository";

export type StoredSubscriber = typeof subscribers.$inferSelect;
export type StoredSubscriberComponent = typeof subscriberComponents.$inferSelect;
export type StoredSubscriberToken = typeof subscriberTokens.$inferSelect;

export interface SubscriberRepository extends SubscriberTransitions {
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
  anonymizeAndDeactivate(subscriberId: string, operatorId: string, now: string): Promise<void>;
  deleteExpiredPending(cutoff: string): Promise<void>;
  recordConfirmationSendIfAllowed(emailHash: string, cutoff: string, now: string): Promise<boolean>;
}

export function createSubscriberRepository(binding: D1Database): SubscriberRepository {
  const database = createDatabase(binding);
  return {
    ...createSubscriberTransitions(binding),
    async listSubscribers(limit, offset = 0) {
      return database.select().from(subscribers).orderBy(asc(subscribers.createdAt)).limit(limit).offset(offset).all();
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
      return (await database.select().from(subscribers).where(eq(subscribers.id, subscriberId)).get()) ?? null;
    },
    async findSubscriberByDestination(destination) {
      return (await database.select().from(subscribers).where(eq(subscribers.destination, destination)).get()) ?? null;
    },
    async findSubscriberByToken(tokenHash, scope, now) {
      const row = await database.select({ subscriber: subscribers, token: subscriberTokens }).from(subscriberTokens)
        .innerJoin(subscribers, eq(subscriberTokens.subscriberId, subscribers.id))
        .where(and(eq(subscriberTokens.tokenHash, tokenHash), eq(subscriberTokens.scope, scope), isNull(subscriberTokens.revokedAt), gt(subscriberTokens.expiresAt, now))).get();
      // Non-expiring manage and unsubscribe tokens have a NULL expires_at.
      if (row) return row;
      return (await database.select({ subscriber: subscribers, token: subscriberTokens }).from(subscriberTokens)
        .innerJoin(subscribers, eq(subscriberTokens.subscriberId, subscribers.id))
        .where(and(eq(subscriberTokens.tokenHash, tokenHash), eq(subscriberTokens.scope, scope), isNull(subscriberTokens.revokedAt), isNull(subscriberTokens.expiresAt))).get()) ?? null;
    },
    async createPendingSubscriber(input) {
      await database.insert(subscribers).values(input).onConflictDoUpdate({
        target: subscribers.destination,
        set: { state: input.state, selectionMode: input.selectionMode, deactivationReason: null, deactivatedAt: null, updatedAt: input.updatedAt },
      });
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
        JOIN subscribers ON subscribers.id = permission.subscriber_id
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
      const subscriber = await database.select({ destination: subscribers.destination, contactEmail: subscribers.contactEmail }).from(subscribers).where(eq(subscribers.id, subscriberId)).get();
      if (!subscriber) return;
      const replacement = `deleted:${subscriberId}`;
      const personalValues = [...new Set([subscriber.destination, subscriber.contactEmail].filter((value): value is string => Boolean(value)))];
      const removeRecipients = personalValues.map((value) =>
        // A deleted webhook contact must not be replaced with a synthetic
        // email-like destination. Keep the operator-alert record, but remove
        // this recipient before a later outbox attempt can address it. Only
        // the alert addressed to this subscriber's contact is touched: the
        // same address may be an operator's, and their other alerts stay.
        binding.prepare(`UPDATE notification_outbox
          SET payload_json = json_set(payload_json, '$.recipients', json((SELECT json_group_array(value) FROM json_each(notification_outbox.payload_json, '$.recipients') WHERE value <> ?)))
          WHERE kind = 'operator-alert' AND aggregate_id = ? AND json_valid(payload_json)
            AND EXISTS (SELECT 1 FROM json_each(notification_outbox.payload_json, '$.recipients') WHERE value = ?)`)
          .bind(value, `webhook-deactivated/${subscriberId}`, value),
      );
      // A frozen envelope is retained for idempotency, but its recipient
      // cannot outlive an operator-initiated subscriber deletion. Only this
      // subscriber's own envelopes are rewritten; alert text never carries an
      // address, and another person's address may contain this one.
      const redactions = personalValues.map((value) =>
        binding.prepare("UPDATE notification_deliveries SET mail_payload_json = replace(mail_payload_json, ?, ?) WHERE subscriber_id = ? AND mail_payload_json IS NOT NULL")
          .bind(value, replacement, subscriberId),
      );
      await binding.batch([
        ...removeRecipients,
        ...redactions,
        binding.prepare("UPDATE subscribers SET destination = ?, contact_email = NULL, state = 'deactivated', deactivation_reason = 'deleted by operator', deactivated_at = ?, updated_at = ? WHERE id = ?").bind(`deleted:${subscriberId}`, now, now, subscriberId),
        binding.prepare("UPDATE subscriber_tokens SET revoked_at = ?, updated_at = ? WHERE subscriber_id = ? AND revoked_at IS NULL").bind(now, now, subscriberId),
        binding.prepare("INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at) VALUES (?, 'subscriber', ?, 'deleted', ?, '{}', ?, ?)").bind(createUlid(), subscriberId, operatorId, now, now),
      ]);
    },
    async deleteExpiredPending(cutoff) {
      await database.delete(subscribers).where(and(eq(subscribers.state, "pending"), lt(subscribers.createdAt, cutoff)));
    },
    async recordConfirmationSendIfAllowed(emailHash, cutoff, now) {
      const result = await binding.prepare(
        "INSERT INTO subscriber_confirmation_attempts (email_hash, last_sent_at, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(email_hash) DO UPDATE SET last_sent_at = excluded.last_sent_at, updated_at = excluded.updated_at WHERE subscriber_confirmation_attempts.last_sent_at < ?",
      ).bind(emailHash, now, now, now, cutoff).run();
      return result.meta.changes === 1;
    },
  };
}
