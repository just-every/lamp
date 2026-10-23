import type { ComponentState } from "../../shared/domain";
import type { IncidentImpact } from "../../shared/incident-impact";
import { parsePublishedComponentChanges, type PublishedIncidentComponentChange } from "../../shared/incident-component-changes";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import { maintenance, notificationDeliveries, operators, subscribers } from "../../shared/schema";
import { notificationOutbox } from "./schema";
import { createUlid } from "../../shared/ids";
import { createStatuspageWebhookRepository } from "./statuspage-webhook.repository";
import type { WebhookFormat } from "../subscribers/webhook-format";

export type DeliveryRow = typeof notificationDeliveries.$inferSelect & { destination: string; subscriberState: "pending" | "active" | "deactivated"; providerAcceptedAt: string | null; latestError: string | null; localCaptureId: string | null; localCapturedAt: string | null; maintenanceReference: string | null; maintenanceTitle: string | null; maintenanceNoticeKind: string | null; incidentReference: string | null; incidentTitle: string | null; incidentLifecycle: string | null };

/** A confirmation or other subscription email, sent outside notification deliveries (subscribers/service.ts). */
export interface SubscriptionMailRow { id: string; destination: string; subscriberState: "pending" | "active" | "deactivated"; kind: "confirmation" | "already-subscribed" | "subscribed"; outcome: "accepted" | "suppressed" | "failed"; sentAt: string }

export interface DispatchableDelivery {
  componentEventId: string | null;
  componentId: string | null;
  componentName: string | null;
  componentCreatedAt: string | null;
  previousComponentState: ComponentState | null;
  newComponentState: ComponentState | null;
  componentChangedAt: string | null;
  componentClaimantKind: string | null;
  webhookFormat:WebhookFormat;
  statuspageIncidentId:string|null;
  id: string;
  notificationEventId: string | null;
  subscriberId: string;
  channel: "email" | "webhook";
  subscriberState: "pending" | "active" | "deactivated";
  destination: string;
  contactEmail: string | null;
  incidentUpdateId: string | null;
  incidentReportId: string | null;
  maintenanceId: string | null;
  maintenanceReference: string | null;
  maintenanceTitle: string | null;
  maintenanceState: "Scheduled" | "In progress" | "Completed" | "Cancelled" | null;
  maintenanceStartsAt: string | null;
  maintenanceEndsAt: string | null;
  maintenanceNoticeKind: "scheduled" | "rescheduled" | "reminder" | "started" | "completed" | "cancelled" | null;
  maintenanceNoticeBody: string | null;
  incidentId: string | null;
  incidentImpact: IncidentImpact | null;
  isFirstIncidentUpdate: number;
  mailPayloadJson: string | null;
  incidentReference: string | null;
  incidentTitle: string | null;
  lifecycle: "Investigating" | "Identified" | "Monitoring" | "Resolved" | null;
  affectedAudience: string | null;
  customerImpact: string | null;
  whatStillWorks: string | null;
  details: string | null;
  nextUpdateAt: string | null;
  componentChangesJson: string | null;
  reportSummary: string | null;
  reportTimeline: string | null;
  reportCause: string | null;
  reportRemediation: string | null;
  timezone: string | null;
}

export interface IncidentWebhookPayload {
  incident: { reference: string; title: string };
  updates: Array<{ id: string; lifecycle: string; affectedAudience: string; customerImpact: string; whatStillWorks: string; details: string; nextUpdateAt: string | null; publishedAt: string; componentChanges: PublishedIncidentComponentChange[] }>;
  components: Array<{ id: string | null; name: string; previousState: string; newState: string }>;
}

export interface PendingProviderEvent {
  id: string;
  eventType: "delivered" | "bounced" | "complained";
  hardBounce: boolean;
}

export type NotificationTokenCandidates = Record<"manage" | "unsubscribe", { id: string; tokenHash: string }>;

export interface DeliveryRepository {
  statuspage:ReturnType<typeof createStatuspageWebhookRepository>;
  hasMailSendClaim(providerMessageId: string): Promise<boolean>;
  listDeliveries(input: { limit?: number; offset?: number; channel?: "email" | "webhook"; outcome?: DeliveryRow["outcome"]; incidentUpdateId?: string }): Promise<DeliveryRow[]>;
  listSubscriptionMail(limit: number): Promise<SubscriptionMailRow[]>;
  getDelivery(deliveryId: string): Promise<DispatchableDelivery | null>;
  claimAndGetDelivery(deliveryId: string, now: string, reclaimBefore: string): Promise<{ claimed: boolean; delivery: DispatchableDelivery | null }>;
  claimDelivery(deliveryId: string, now: string, reclaimBefore: string): Promise<boolean>;
  releaseDeliveryClaim(deliveryId: string): Promise<void>;
  listQueuedDeliveryIdsForEvent(eventId: string): Promise<string[]>;
  getAttemptCount(deliveryId: string): Promise<number>;
  recordAttempt(input: { id: string; deliveryId: string; attemptNumber: number; attemptedAt: string; providerMessageId: string | null; error: string | null; createdAt: string; localCaptureId?: string | null }): Promise<void>;
  recordAcceptedEmailAttempt(input: { id: string; deliveryId: string; attemptedAt: string; providerMessageId: string; createdAt: string }): Promise<PendingProviderEvent[]>;
  markOutcome(deliveryId: string, outcome: "queued" | "delivered" | "bounced" | "complained" | "suppressed" | "failed", outcomeAt: string | null, updatedAt: string): Promise<void>;
  markProviderOutcome(deliveryId: string, outcome: "delivered" | "bounced" | "complained", now: string): Promise<boolean>;
  freezeMailPayload(deliveryId: string, payloadJson: string): Promise<string>;
  ensureNotificationTokens(subscriberId: string, candidates: NotificationTokenCandidates, now: string): Promise<{ manage: string; unsubscribe: string } | null>;
  listOutbox(limit: number, now: string): Promise<Array<typeof notificationOutbox.$inferSelect>>;
  claimOutbox(id: string, now: string, reclaimBefore: string): Promise<boolean>;
  completeOutbox(id: string, now: string): Promise<void>;
  completeOutboxForEvent(eventId: string, now: string): Promise<void>;
  retryOutbox(id: string, input: { attempts: number; availableAt: string; error: string; now: string; failed: boolean }): Promise<void>;
  enqueueOperatorAlert(input: { id: string; eventId: string; payloadJson: string; now: string }): Promise<void>;
  listActiveOperatorEmails(): Promise<string[]>;
  isProviderWebhookNew(input: { providerEventId: string; providerMessageId: string; eventType: "delivered" | "bounced" | "complained"; hardBounce: boolean; now: string }): Promise<boolean>;
  findDeliveryByProviderMessageId(providerMessageId: string): Promise<{ id: string; subscriberId: string; channel: "email" | "webhook" } | null>;
  listPendingProviderEvents(providerMessageId: string): Promise<PendingProviderEvent[]>;
  listPendingProviderMessageIds(limit: number): Promise<string[]>;
  claimProviderEvent(eventId: string, now: string, reclaimBefore: string): Promise<boolean>;
  completeProviderEvent(eventId: string, deliveryId: string, now: string): Promise<void>;
  countConsecutiveOutcomes(subscriberId: string, channel: "email" | "webhook", outcomes: string[], limit: number): Promise<number>;
  deactivateSubscriber(subscriberId: string, reason: string, now: string): Promise<boolean>;
  getIncidentWebhookPayload(incidentId: string, updateId: string, eventId: string | null): Promise<IncidentWebhookPayload | null>;
}

export function createDeliveryRepository(binding: D1Database): DeliveryRepository {
  const database = createDatabase(binding);
  function deliveryStatement(deliveryId: string) {
    return binding.prepare(`
        SELECT component_event.id AS componentEventId, component_event.component_id AS componentId, component_event.component_name AS componentName, component_event.component_created_at AS componentCreatedAt, component_event.previous_state AS previousComponentState, component_event.new_state AS newComponentState, component_event.changed_at AS componentChangedAt, component_event.claimant_kind AS componentClaimantKind,
          d.id, d.notification_event_id AS notificationEventId, d.subscriber_id AS subscriberId, d.channel, s.state AS subscriberState, s.destination, s.contact_email AS contactEmail,
          COALESCE(s.webhook_format,'lamp') AS webhookFormat,COALESCE(i.id,reportIncident.id) AS statuspageIncidentId,
          d.incident_update_id AS incidentUpdateId, d.incident_report_id AS incidentReportId, d.maintenance_id AS maintenanceId,
          d.incident_impact AS incidentImpact, i.id AS incidentId, CASE WHEN u.id IS NOT NULL AND u.id = (SELECT first_update.id FROM incident_updates first_update WHERE first_update.incident_id = i.id ORDER BY first_update.published_at ASC, first_update.id ASC LIMIT 1) THEN 1 ELSE 0 END AS isFirstIncidentUpdate,
          COALESCE(i.reference, reportIncident.reference) AS incidentReference, COALESCE(i.title, reportIncident.title) AS incidentTitle, u.lifecycle, u.affected_audience AS affectedAudience,
          u.customer_impact AS customerImpact, u.what_still_works AS whatStillWorks, u.details, u.next_update_at AS nextUpdateAt, u.component_changes_json AS componentChangesJson,
          report.summary AS reportSummary, report.timeline AS reportTimeline, report.cause AS reportCause, report.remediation AS reportRemediation,
          maintenance.reference AS maintenanceReference, maintenance.title AS maintenanceTitle, maintenance.state AS maintenanceState, maintenance.starts_at AS maintenanceStartsAt, maintenance.ends_at AS maintenanceEndsAt,
          notice.kind AS maintenanceNoticeKind, notice.body AS maintenanceNoticeBody, settings.timezone, d.mail_payload_json AS mailPayloadJson
        FROM notification_deliveries d
        JOIN subscribers s ON s.id = d.subscriber_id
        LEFT JOIN component_notification_events component_event ON component_event.id = d.notification_event_id
        LEFT JOIN incident_updates u ON u.id = d.incident_update_id
        LEFT JOIN incidents i ON i.id = u.incident_id
        LEFT JOIN incident_reports report ON report.id = d.incident_report_id
        LEFT JOIN incidents reportIncident ON reportIncident.id = report.incident_id
        LEFT JOIN maintenance ON maintenance.id = d.maintenance_id
        LEFT JOIN maintenance_notices notice ON notice.id = d.notification_event_id
        LEFT JOIN page_settings settings ON settings.id = 'default'
        WHERE d.id = ?
      `).bind(deliveryId);
  }

  function claimStatement(deliveryId: string, now: string, reclaimBefore: string) {
    return binding.prepare(`
        UPDATE notification_deliveries
        SET dispatch_locked_at = ?
        WHERE id = ? AND outcome = 'queued'
          AND (dispatch_locked_at IS NULL OR dispatch_locked_at < ?)
          AND NOT EXISTS (
            SELECT 1 FROM notification_delivery_attempts
            WHERE delivery_id = notification_deliveries.id AND (provider_message_id IS NOT NULL OR local_capture_id IS NOT NULL)
          )
      `).bind(now, deliveryId, reclaimBefore);
  }

  function pendingEventsStatement(providerMessageId: string) {
    return binding.prepare("SELECT id, event_type AS eventType, hard_bounce AS hardBounce FROM mail_provider_webhook_events WHERE provider_message_id = ? AND applied_at IS NULL ORDER BY received_at ASC, id ASC").bind(providerMessageId);
  }
  return {
    statuspage:createStatuspageWebhookRepository(binding),
    async listDeliveries(input) {
      const conditions = [];
      if (input.channel) conditions.push(eq(notificationDeliveries.channel, input.channel));
      if (input.outcome) conditions.push(eq(notificationDeliveries.outcome, input.outcome));
      if (input.incidentUpdateId) conditions.push(eq(notificationDeliveries.incidentUpdateId, input.incidentUpdateId));
      const query = database.select({
        id: notificationDeliveries.id, subscriberId: notificationDeliveries.subscriberId, incidentUpdateId: notificationDeliveries.incidentUpdateId, maintenanceId: notificationDeliveries.maintenanceId,
        channel: notificationDeliveries.channel, outcome: notificationDeliveries.outcome, queuedAt: notificationDeliveries.queuedAt, outcomeAt: notificationDeliveries.outcomeAt,
        createdAt: notificationDeliveries.createdAt, updatedAt: notificationDeliveries.updatedAt, destination: subscribers.destination, subscriberState: subscribers.state,
        maintenanceReference: maintenance.reference, maintenanceTitle: maintenance.title,
        maintenanceNoticeKind: sql<string | null>`(SELECT kind FROM maintenance_notices WHERE id = notification_deliveries.notification_event_id)`,
        incidentReference: sql<string | null>`(SELECT i.reference FROM incident_updates u JOIN incidents i ON i.id = u.incident_id WHERE u.id = notification_deliveries.incident_update_id)`,
        incidentTitle: sql<string | null>`(SELECT i.title FROM incident_updates u JOIN incidents i ON i.id = u.incident_id WHERE u.id = notification_deliveries.incident_update_id)`,
        incidentLifecycle: sql<string | null>`(SELECT lifecycle FROM incident_updates WHERE id = notification_deliveries.incident_update_id)`,
        providerAcceptedAt: sql<string | null>`(SELECT attempted_at FROM notification_delivery_attempts WHERE delivery_id = ${notificationDeliveries.id} AND provider_message_id IS NOT NULL AND error IS NULL ORDER BY attempted_at LIMIT 1)`,
        localCaptureId: sql<string | null>`(SELECT local_capture_id FROM notification_delivery_attempts WHERE delivery_id = ${notificationDeliveries.id} AND local_capture_id IS NOT NULL ORDER BY attempted_at LIMIT 1)`,
        localCapturedAt: sql<string | null>`(SELECT attempted_at FROM notification_delivery_attempts WHERE delivery_id = ${notificationDeliveries.id} AND local_capture_id IS NOT NULL ORDER BY attempted_at LIMIT 1)`,
        latestError: sql<string | null>`(SELECT error FROM notification_delivery_attempts WHERE delivery_id = ${notificationDeliveries.id} ORDER BY attempted_at DESC, attempt_number DESC LIMIT 1)`,
      }).from(notificationDeliveries).innerJoin(subscribers, eq(notificationDeliveries.subscriberId, subscribers.id)).leftJoin(maintenance, eq(notificationDeliveries.maintenanceId, maintenance.id)).where(conditions.length ? and(...conditions) : undefined).orderBy(asc(notificationDeliveries.queuedAt));
      return input.limit === undefined ? query.all() : query.limit(input.limit).offset(input.offset ?? 0).all();
    },
    async listSubscriptionMail(limit) {
      const result = await binding.prepare(`SELECT a.id, s.destination, s.state AS subscriberState, json_extract(a.payload_json, '$.kind') AS kind, json_extract(a.payload_json, '$.outcome') AS outcome, a.created_at AS sentAt
        FROM audit_entries a JOIN subscribers s ON s.id = a.entity_id
        WHERE a.entity_type = 'subscriber' AND a.action = 'subscription-mail' ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).bind(limit).all<SubscriptionMailRow>();
      return result.results;
    },
    async getDelivery(deliveryId) {
      const result = await deliveryStatement(deliveryId).first<DispatchableDelivery>();
      return result ?? null;
    },
    async claimAndGetDelivery(deliveryId, now, reclaimBefore) {
      const [claim, rows] = await binding.batch<DispatchableDelivery>([
        claimStatement(deliveryId, now, reclaimBefore),
        deliveryStatement(deliveryId),
      ]);
      const claimed = claim.meta.changes === 1;
      return { claimed, delivery: claimed ? rows.results[0] ?? null : null };
    },
    async claimDelivery(deliveryId, now, reclaimBefore) {
      const result = await claimStatement(deliveryId, now, reclaimBefore).run();
      return result.meta.changes === 1;
    },
    async releaseDeliveryClaim(deliveryId) {
      await binding.prepare("UPDATE notification_deliveries SET dispatch_locked_at = NULL WHERE id = ?").bind(deliveryId).run();
    },
    async listQueuedDeliveryIdsForEvent(eventId) {
      const result = await binding.prepare(`SELECT id FROM notification_deliveries WHERE notification_event_id = ? AND outcome = 'queued'
        AND NOT EXISTS (SELECT 1 FROM notification_delivery_attempts WHERE delivery_id = notification_deliveries.id AND local_capture_id IS NOT NULL)`).bind(eventId).all<{ id: string }>();
      return result.results.map((row) => row.id);
    },
    async getAttemptCount(deliveryId) {
      const result = await binding.prepare("SELECT COUNT(*) AS count FROM notification_delivery_attempts WHERE delivery_id = ?").bind(deliveryId).first<{ count: number }>();
      return result?.count ?? 0;
    },
    async hasMailSendClaim(providerMessageId) {
      return Boolean(await binding.prepare("SELECT id FROM mail_send_ledger WHERE id = ?").bind(providerMessageId).first());
    },
    async recordAttempt(input) {
      await binding.prepare(`INSERT INTO notification_delivery_attempts
        (id, delivery_id, attempt_number, attempted_at, provider_message_id, error, created_at, local_capture_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
        .bind(input.id, input.deliveryId, input.attemptNumber, input.attemptedAt, input.providerMessageId, input.error, input.createdAt, input.localCaptureId ?? null).run();
    },
    async recordAcceptedEmailAttempt(input) {
      // Acceptance is durable before callbacks can resolve this provider ID.
      // COUNT + 1 is the existing numbering rule, evaluated inside the write.
      const [, pending] = await binding.batch<Omit<PendingProviderEvent, "hardBounce"> & { hardBounce: number }>([
        binding.prepare(`INSERT INTO notification_delivery_attempts
          (id, delivery_id, attempt_number, attempted_at, provider_message_id, error, created_at, local_capture_id)
          SELECT ?, ?, COUNT(*) + 1, ?, ?, NULL, ?, NULL
          FROM notification_delivery_attempts WHERE delivery_id = ? ON CONFLICT DO NOTHING`)
          .bind(input.id, input.deliveryId, input.attemptedAt, input.providerMessageId, input.createdAt, input.deliveryId),
        pendingEventsStatement(input.providerMessageId),
      ]);
      return pending.results.map((event) => ({ ...event, hardBounce: Boolean(event.hardBounce) }));
    },
    async markOutcome(deliveryId, outcome, outcomeAt, updatedAt) {
      await database.update(notificationDeliveries).set({ outcome, outcomeAt, updatedAt }).where(eq(notificationDeliveries.id, deliveryId));
    },
    async markProviderOutcome(deliveryId, outcome, now) {
      const transition = outcome === "delivered"
        ? "outcome IN ('queued', 'failed')"
        : outcome === "bounced"
          ? "outcome IN ('queued', 'delivered', 'failed')"
          : "outcome IN ('queued', 'delivered', 'bounced', 'failed')";
      const result = await binding.prepare(`UPDATE notification_deliveries SET outcome = ?, outcome_at = ?, updated_at = ? WHERE id = ? AND ${transition}
        AND NOT EXISTS (SELECT 1 FROM notification_delivery_attempts WHERE delivery_id = notification_deliveries.id AND local_capture_id IS NOT NULL)`)
        .bind(outcome, now, now, deliveryId).run();
      return result.meta.changes === 1;
    },
    async freezeMailPayload(deliveryId, payloadJson) {
      // Read the authoritative first winner in the same ordered transaction.
      const [, stored] = await binding.batch<{ payloadJson: string | null }>([
        binding.prepare("UPDATE notification_deliveries SET mail_payload_json = ? WHERE id = ? AND mail_payload_json IS NULL").bind(payloadJson, deliveryId),
        binding.prepare("SELECT mail_payload_json AS payloadJson FROM notification_deliveries WHERE id = ?").bind(deliveryId),
      ]);
      const row = stored.results[0];
      if (!row?.payloadJson) throw new Error("Delivery envelope could not be frozen.");
      return row.payloadJson;
    },
    async ensureNotificationTokens(subscriberId, candidates, now) {
      // Both scopes and their authoritative winners share one transaction. A
      // concurrent delivery reuses the committed tokens; a revoked token is
      // never reused, and an inactive/deleted subscriber gets no new links.
      const insert = (scope: "manage" | "unsubscribe") => binding.prepare(`
        INSERT INTO subscriber_tokens (id, subscriber_id, scope, token_hash, expires_at, revoked_at, created_at, updated_at)
        SELECT ?, id, ?, ?, NULL, NULL, ?, ? FROM subscribers
        WHERE id = ? AND state = 'active'
          AND NOT EXISTS (SELECT 1 FROM subscriber_tokens WHERE subscriber_id = ? AND scope = ? AND revoked_at IS NULL)
      `).bind(candidates[scope].id, scope, candidates[scope].tokenHash, now, now, subscriberId, subscriberId, scope);
      const [, , stored] = await binding.batch<{ state: string; manage: string | null; unsubscribe: string | null }>([
        insert("manage"), insert("unsubscribe"),
        binding.prepare(`SELECT state,
          (SELECT id FROM subscriber_tokens WHERE subscriber_id = subscribers.id AND scope = 'manage' AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1) AS manage,
          (SELECT id FROM subscriber_tokens WHERE subscriber_id = subscribers.id AND scope = 'unsubscribe' AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1) AS unsubscribe
          FROM subscribers WHERE id = ?`).bind(subscriberId),
      ]);
      const row = stored.results[0];
      if (!row || row.state !== "active") return null;
      if (!row.manage || !row.unsubscribe) throw new Error("Subscriber notification links could not be persisted.");
      return { manage: row.manage, unsubscribe: row.unsubscribe };
    },
    async listOutbox(limit, now) {
      return database.select().from(notificationOutbox).where(and(isNull(notificationOutbox.completedAt), isNull(notificationOutbox.failedAt), lte(notificationOutbox.availableAt, now))).orderBy(asc(notificationOutbox.availableAt)).limit(limit).all();
    },
    async claimOutbox(id, now, reclaimBefore) {
      const result = await binding.prepare(`UPDATE notification_outbox SET locked_at = ?, updated_at = ?
        WHERE id = ? AND completed_at IS NULL AND failed_at IS NULL AND available_at <= ?
          AND (locked_at IS NULL OR locked_at < ?)`)
        .bind(now, now, id, now, reclaimBefore).run();
      return result.meta.changes === 1;
    },
    async completeOutbox(id, now) { await database.update(notificationOutbox).set({ completedAt: now, lockedAt: null, updatedAt: now }).where(eq(notificationOutbox.id, id)); },
    async completeOutboxForEvent(eventId, now) {
      await binding.prepare(`UPDATE notification_outbox SET completed_at = ?, locked_at = NULL, updated_at = ?
        WHERE kind = 'delivery-dispatch' AND aggregate_id = ? AND completed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM notification_deliveries d
            WHERE d.notification_event_id = ? AND d.outcome = 'queued'
              AND NOT EXISTS (SELECT 1 FROM notification_delivery_attempts a
                WHERE a.delivery_id = d.id AND (a.provider_message_id IS NOT NULL OR a.local_capture_id IS NOT NULL)))`)
        .bind(now, now, eventId, eventId).run();
    },
    async retryOutbox(id, input) { await database.update(notificationOutbox).set({ attempts: input.attempts, availableAt: input.availableAt, lastError: input.error, failedAt: input.failed ? input.now : null, lockedAt: null, updatedAt: input.now }).where(eq(notificationOutbox.id, id)); },
    async enqueueOperatorAlert(input) {
      await binding.prepare("INSERT OR IGNORE INTO notification_outbox (id, kind, aggregate_id, payload_json, available_at, attempts, locked_at, completed_at, failed_at, last_error, created_at, updated_at) VALUES (?, 'operator-alert', ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?)")
        .bind(input.id, input.eventId, input.payloadJson, input.now, input.now, input.now).run();
    },
    async listActiveOperatorEmails() {
      return (await database.select({ email: operators.email }).from(operators).where(isNull(operators.deactivatedAt)).all()).map((operator) => operator.email);
    },
    async isProviderWebhookNew(input) {
      const result = await binding.prepare("INSERT INTO mail_provider_webhook_events (id, provider_event_id, provider_message_id, event_type, hard_bounce, received_at, claimed_at, applied_at, delivery_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?) ON CONFLICT(provider_event_id) DO NOTHING")
        .bind(createUlid(), input.providerEventId, input.providerMessageId, input.eventType, input.hardBounce ? 1 : 0, input.now, input.now).run();
      return result.meta.changes === 1;
    },
    async findDeliveryByProviderMessageId(providerMessageId) {
      return (await binding.prepare(`SELECT a.delivery_id AS id, d.subscriber_id AS subscriberId, d.channel FROM notification_delivery_attempts a JOIN notification_deliveries d ON d.id = a.delivery_id WHERE a.provider_message_id = ?
        AND NOT EXISTS (SELECT 1 FROM notification_delivery_attempts captured WHERE captured.delivery_id = d.id AND captured.local_capture_id IS NOT NULL)
        ORDER BY a.attempted_at DESC LIMIT 1`).bind(providerMessageId).first<{ id: string; subscriberId: string; channel: "email" | "webhook" }>()) ?? null;
    },
    async listPendingProviderEvents(providerMessageId) {
      const result = await pendingEventsStatement(providerMessageId).all<Omit<PendingProviderEvent, "hardBounce"> & { hardBounce: number }>();
      return result.results.map((event) => ({ ...event, hardBounce: Boolean(event.hardBounce) }));
    },
    async listPendingProviderMessageIds(limit) {
      const result = await binding.prepare(`SELECT DISTINCT event.provider_message_id AS providerMessageId
        FROM mail_provider_webhook_events event
        JOIN notification_delivery_attempts attempt ON attempt.provider_message_id = event.provider_message_id
        WHERE event.applied_at IS NULL AND event.provider_message_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM notification_delivery_attempts captured WHERE captured.delivery_id = attempt.delivery_id AND captured.local_capture_id IS NOT NULL)
        ORDER BY event.received_at ASC LIMIT ?`).bind(limit).all<{ providerMessageId: string }>();
      return result.results.map((event) => event.providerMessageId);
    },
    async claimProviderEvent(eventId, now, reclaimBefore) {
      const result = await binding.prepare("UPDATE mail_provider_webhook_events SET claimed_at = ? WHERE id = ? AND applied_at IS NULL AND (claimed_at IS NULL OR claimed_at < ?)")
        .bind(now, eventId, reclaimBefore).run();
      return result.meta.changes === 1;
    },
    async completeProviderEvent(eventId, deliveryId, now) {
      await binding.prepare("UPDATE mail_provider_webhook_events SET applied_at = ?, delivery_id = ?, claimed_at = NULL WHERE id = ? AND applied_at IS NULL")
        .bind(now, deliveryId, eventId).run();
    },
    async countConsecutiveOutcomes(subscriberId, channel, outcomes, limit) {
      // Outstanding newer work says nothing about the outcome sequence. Count
      // completed deliveries only, otherwise a queued backlog permanently
      // breaks the five-bounce / ten-webhook-failure safety thresholds.
      const rows = await binding.prepare("SELECT outcome FROM notification_deliveries WHERE subscriber_id = ? AND channel = ? AND outcome <> 'queued' ORDER BY outcome_at DESC, queued_at DESC LIMIT ?").bind(subscriberId, channel, limit).all<{ outcome: string }>();
      let count = 0;
      for (const row of rows.results) { if (!outcomes.includes(row.outcome)) break; count += 1; }
      return count;
    },
    async deactivateSubscriber(subscriberId, reason, now) {
      const result = await binding.batch([
        binding.prepare("UPDATE subscribers SET state = 'deactivated', deactivation_reason = ?, deactivated_at = ?, updated_at = ? WHERE id = ? AND state = 'active' RETURNING id").bind(reason, now, now, subscriberId),
        binding.prepare("UPDATE subscriber_tokens SET revoked_at = ?, updated_at = ? WHERE subscriber_id = ? AND revoked_at IS NULL").bind(now, now, subscriberId),
      ]);
      return result[0]?.results.length === 1;
    },
    async getIncidentWebhookPayload(incidentId, updateId, eventId) {
      const incident = await binding.prepare("SELECT reference, title FROM incidents WHERE id = ?").bind(incidentId).first<{ reference: string; title: string }>();
      if (!incident) return null;
      const [updates, snapshot] = await Promise.all([
        binding.prepare(`SELECT id, lifecycle, affected_audience AS affectedAudience, customer_impact AS customerImpact, what_still_works AS whatStillWorks, details, next_update_at AS nextUpdateAt, published_at AS publishedAt, component_changes_json AS componentChangesJson
          FROM incident_updates WHERE incident_id = ? ORDER BY published_at ASC, id ASC`)
          .bind(incidentId).all<Omit<IncidentWebhookPayload["updates"][number], "componentChanges"> & { componentChangesJson: string }>(),
        binding.prepare("SELECT component_snapshot_json AS snapshot FROM incident_updates WHERE id = ? AND incident_id = ?").bind(updateId,incidentId).first<{ snapshot: string }>(),
      ]);
      if (!snapshot) return null;
      // An explicit live attachment is its own catch-up event. Its historical
      // update supplies the text; the newly attached component supplies state.
      const attachmentEvent = eventId?.startsWith("incident-attachment/")
        ? await binding.prepare(`SELECT ic.component_id AS id, ic.component_name AS name,
            COALESCE((SELECT h.previous_state FROM component_state_history h WHERE h.component_id = ic.component_id AND h.cause_type = 'incident' AND h.cause_id = ? ORDER BY h.changed_at DESC,h.id DESC LIMIT 1), ic.state) AS previousState,
            COALESCE((SELECT h.new_state FROM component_state_history h WHERE h.component_id = ic.component_id AND h.cause_type = 'incident' AND h.cause_id = ? ORDER BY h.changed_at DESC,h.id DESC LIMIT 1), ic.state) AS newState
          FROM incident_components ic JOIN components c ON c.id = ic.component_id WHERE ic.incident_id = ? AND ic.published_at IS NOT NULL AND c.internal = 0 ORDER BY ic.created_at,ic.id`)
          .bind(incidentId,incidentId,incidentId).all<IncidentWebhookPayload["components"][number]>() : null;
      return {
        incident,
        updates: updates.results.map(({ componentChangesJson, ...row }) => ({ ...row, componentChanges: parsePublishedComponentChanges(componentChangesJson).filter(change => !change.internal) })),
        components: attachmentEvent ? attachmentEvent.results : parsePublishedComponentChanges(snapshot.snapshot).filter(change => !change.internal).map(change => ({ id: change.componentId, name: change.name, previousState: change.previousState, newState: change.newState })),
      };
    },
  };
}
