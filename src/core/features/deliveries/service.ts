import { resolveSlackWebhook } from "../../../../modules/integrations/slack/protocol.ts";
import { classifySlackIncomingWebhook } from "../../../../modules/integrations/slack/classify.ts";
import { renderSubscriberSlackMessage } from "./slack-message";
import { formatTime } from "../public-snapshot/format";
import { lampConfig } from "../../../ext/config";
import type { DeliveryChannel, DeliveryOutcome } from "../../shared/domain";
import { createUlid, nowIso } from "../../shared/ids";
import { parsePublishedComponentChanges } from "../../shared/incident-component-changes";
import { renderNotificationUpdate } from "../../shared/update-renderer";
import { impactLabel } from "../../shared/incident-impact";
import { brandEmail, defaultEmailBranding, type EmailBranding } from "../../shared/email-branding";
import { type MailMessage, type MailSender } from "../../platform/mail";
import { hmacSha256 } from "../../platform/security/opaque-tokens";
import { SubscriberTokenCodec } from "../subscribers/tokens";
import { defaultDeliveryEvents, type DeliveryEvents } from "./events";
import type { DeliveryRepository, DeliveryRow, DispatchableDelivery, PendingProviderEvent, SubscriptionMailRow } from "./repository";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 20 * 60_000, 20 * 60_000];
const RESEND_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DELIVERY_CLAIM_MS = 5 * 60 * 1000;
const PROVIDER_CALLBACK_CLAIM_MS = 5 * 60 * 1000;

type FrozenMailPayload = MailMessage & { frozenAt: string };

export interface DeliveriesService {
  list(filter?: { channel?: DeliveryChannel; outcome?: DeliveryOutcome; incidentUpdateId?: string; limit?: number; offset?: number }): Promise<DeliveryRow[]>;
  export(filter?: { channel?: DeliveryChannel; outcome?: DeliveryOutcome; incidentUpdateId?: string }): Promise<DeliveryRow[]>;
  listSubscriptionMail(limit?: number): Promise<SubscriptionMailRow[]>;
  dispatchDue(origin: string, limit?: number): Promise<void>;
  dispatchEvent(eventId: string, origin: string): Promise<void>;
  dispatchDelivery(deliveryId: string, origin: string): Promise<void>;
  handleProviderEvent(input: { id: string; providerMessageId: string | null; type: "delivered" | "bounced" | "complained"; hardBounce?: boolean }): Promise<void>;
  queueOperatorAlert(input: { eventId: string; title: string; text: string; recipients?: string[] }): Promise<void>;
}

function retryAt(attempt: number) {
  const delay = RETRY_DELAYS_MS[Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_MS.length - 1)];
  return new Date(Date.now() + delay).toISOString();
}

function isSafeWebhookDestination(destination: string) {
  try {
    const url = new URL(destination);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.port && host !== "localhost" && !host.endsWith(".localhost")
      && !/^(?:127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(host);
  } catch { return false; }
}

function htmlText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function permanentDeliveryError(message: string) {
  const error = new Error(message) as Error & { retryable?: boolean };
  error.retryable = false;
  return error;
}

function parseFrozenMailPayload(value: string): FrozenMailPayload {
  const payload = JSON.parse(value) as Partial<FrozenMailPayload>;
  if (typeof payload.frozenAt !== "string" || typeof payload.from !== "string" || typeof payload.to !== "string" || typeof payload.subject !== "string" || typeof payload.text !== "string" || typeof payload.idempotencyKey !== "string" || !payload.headers || typeof payload.headers !== "object") throw permanentDeliveryError("Stored delivery envelope is invalid.");
  return payload as FrozenMailPayload;
}

function displayNotificationTime(value: string, timezone: string | null) {
  return formatTime(value, timezone ?? "UTC");
}

function renderMaintenanceNotice(delivery: DispatchableDelivery) {
  if (!delivery.maintenanceReference || !delivery.maintenanceTitle || !delivery.maintenanceState || !delivery.maintenanceNoticeKind) return null;
  const starts = delivery.maintenanceStartsAt ? displayNotificationTime(delivery.maintenanceStartsAt, delivery.timezone) : "Not recorded";
  const ends = delivery.maintenanceEndsAt ? displayNotificationTime(delivery.maintenanceEndsAt, delivery.timezone) : "Not recorded";
  const kind = delivery.maintenanceNoticeKind[0]!.toUpperCase() + delivery.maintenanceNoticeKind.slice(1);
  const plainText = [
    `${delivery.maintenanceReference}: ${delivery.maintenanceTitle}`,
    `Status: ${delivery.maintenanceState}`,
    `Notice: ${kind}`,
    `Start: ${starts}`,
    `End: ${ends}`,
    delivery.maintenanceNoticeBody ?? "",
  ].filter(Boolean).join("\n\n");
  return { email: { subject: `[${delivery.maintenanceReference}] ${kind}: ${delivery.maintenanceTitle}`, plainText } };
}

export function createDeliveriesService(
  repository: DeliveryRepository,
  options: { emailBranding?: () => Promise<{ branding: EmailBranding; hasLogo: boolean }>; pageName?: () => Promise<string>; effectsPaused?: boolean; mail?: MailSender; fromAddress?: string | (() => Promise<string>); subscriberTokenSecret?: string; webhookSigningSecret?: string | string[]; events?: DeliveryEvents } = {},
): DeliveriesService {
  const tokens = options.subscriberTokenSecret ? new SubscriberTokenCodec(options.subscriberTokenSecret) : null;
  const events = options.events ?? defaultDeliveryEvents;

  async function emitAfterCommit(callback: () => Promise<void>) {
    try {
      await callback();
    } catch (cause) {
      console.error("Lamp delivery event listener failed after its fact was committed.", cause);
    }
  }

  async function deactivateSubscriber(delivery: Pick<DispatchableDelivery, "subscriberId" | "channel">, reason: string, timestamp: string) {
    if (!(await repository.deactivateSubscriber(delivery.subscriberId, reason, timestamp))) return false;
    await emitAfterCommit(() => events.subscriberDeactivated({ subscriberId: delivery.subscriberId, channel: delivery.channel, occurredAt: timestamp, reason }));
    return true;
  }

  async function configuredFromAddress() {
    const address = typeof options.fromAddress === "function" ? await options.fromAddress() : options.fromAddress;
    if (!address) throw new Error("mail.sender.v1 is unavailable.");
    return address;
  }

  async function queueMailAlert(input: { eventId: string; title: string; text: string; recipients?: string[] }) {
    const from = await configuredFromAddress();
    const recipients = input.recipients ?? await repository.listActiveOperatorEmails();
    if (!recipients.length) return;
    const now = nowIso();
    await repository.enqueueOperatorAlert({
      id: createUlid(), eventId: input.eventId,
      // Freeze the entire envelope before an outbox attempt. This gives a
      // provider retry its original From, recipients, and content.
      payloadJson: JSON.stringify({ from, recipients, title: input.title, text: input.text }),
      now,
    });
  }

  async function queueOperatorAlert(input: { eventId: string; title: string; text: string; recipients?: string[] }) {
    await queueMailAlert(input);
  }

  async function stableTokens(subscriberId: string) {
    if (!tokens) throw new Error("SUBSCRIBER_TOKEN_SECRET is required for notification links.");
    const candidate = async (scope: "manage" | "unsubscribe") => {
      const id = createUlid();
      const token = await tokens!.encode({ id, scope });
      return { id, tokenHash: await tokens!.hash(token) };
    };
    const [manage, unsubscribe] = await Promise.all([candidate("manage"), candidate("unsubscribe")]);
    const stored = await repository.ensureNotificationTokens(subscriberId, { manage, unsubscribe }, nowIso());
    if (!stored) return null;
    const values = await Promise.all([
      tokens.encode({ id: stored.manage, scope: "manage" }),
      tokens.encode({ id: stored.unsubscribe, scope: "unsubscribe" }),
    ]);
    return { manage: values[0], unsubscribe: values[1] };
  }

  async function recordFailure(delivery: DispatchableDelivery, error: unknown) {
    const timestamp = nowIso();
    const attempt = (await repository.getAttemptCount(delivery.id)) + 1;
    const description = error instanceof Error ? error.message.slice(0, 1000) : "Delivery failed.";
    const providerMessageId = error && typeof error === "object" && "providerMessageId" in error && typeof error.providerMessageId === "string" ? error.providerMessageId : null;
    await repository.recordAttempt({ id: createUlid(), deliveryId: delivery.id, attemptNumber: attempt, attemptedAt: timestamp, providerMessageId, error: description, createdAt: timestamp });
    const retryable = !(error && typeof error === "object" && "retryable" in error) || (error as { retryable?: boolean }).retryable !== false;
    if (!retryable || attempt > RETRY_DELAYS_MS.length) {
      await repository.markOutcome(delivery.id, "failed", timestamp, timestamp);
      if (providerMessageId && await applyPendingProviderEvents(providerMessageId)) return;
      await emitAfterCommit(() => events.notificationFailed({ deliveryId: delivery.id, subscriberId: delivery.subscriberId, notificationEventId: delivery.notificationEventId ?? delivery.id, failedAt: timestamp }));
      await queueOperatorAlert({
        eventId: `delivery-failed/${delivery.id}`,
        title: "Lamp could not deliver a subscriber notification",
        text: `Delivery ${delivery.id} to ${delivery.channel} subscriber ${delivery.subscriberId} could not confirm delivery: ${description}`,
      });
      if (delivery.channel === "webhook" && (await repository.countConsecutiveOutcomes(delivery.subscriberId, "webhook", ["failed"], 10)) >= 10) {
        await deactivateSubscriber(delivery, "ten consecutive webhook delivery failures", timestamp);
        if (delivery.contactEmail) await queueMailAlert({
          eventId: `webhook-deactivated/${delivery.subscriberId}`,
          title: "Lamp disabled a failing webhook subscription",
          text: "Lamp stopped sending to this webhook endpoint after ten consecutive failed deliveries. An operator can add a replacement endpoint.",
          recipients: [delivery.contactEmail],
        });
      }
      return;
    }
    // The queued outcome remains until retry; the durable outbox runner owns
    // the actual re-enqueue timing after this method returns an error.
    await repository.markOutcome(delivery.id, "queued", null, timestamp);
  }

  async function sendEmail(delivery: DispatchableDelivery, origin: string) {
    if (!options.mail?.configured) throw new Error("mail.sender.v1 is unavailable.");
    let envelope: FrozenMailPayload;
    if (delivery.mailPayloadJson) {
      envelope = parseFrozenMailPayload(delivery.mailPayloadJson);
    } else {
      const fromAddress = await configuredFromAddress();
      const links = await stableTokens(delivery.subscriberId);
      if (!links) {
        await repository.markOutcome(delivery.id, "suppressed", nowIso(), nowIso());
        return;
      }
      const { manage, unsubscribe } = links;
      const manageUrl = new URL(`/manage/${encodeURIComponent(manage)}`, origin).toString();
      const unsubscribeUrl = new URL(`/unsubscribe/${encodeURIComponent(unsubscribe)}`, origin).toString();
      const rendered = delivery.incidentReportId && delivery.incidentReference && delivery.incidentTitle
        ? { email: { subject: `[${delivery.incidentReference}] Post-incident report`, plainText: [`${delivery.incidentReference}: ${delivery.incidentTitle}`, ...(delivery.incidentImpact === null ? [] : [`Incident impact: ${impactLabel(delivery.incidentImpact)}`]), ...[["Summary", delivery.reportSummary], ["Timeline", delivery.reportTimeline], ["Cause", delivery.reportCause], ["Remediation", delivery.reportRemediation]].flatMap(([label, value]) => value?.trim() ? [`${label}: ${value}`] : [])].join("\n\n") } }
        : delivery.incidentUpdateId !== null && delivery.incidentReference !== null && delivery.incidentTitle !== null && delivery.lifecycle !== null && delivery.affectedAudience !== null && delivery.customerImpact !== null
          ? renderNotificationUpdate({ incidentImpact: delivery.incidentImpact, incidentReference: delivery.incidentReference, incidentTitle: delivery.incidentTitle, lifecycle: delivery.lifecycle, affectedAudience: delivery.affectedAudience, customerImpact: delivery.customerImpact, whatStillWorks: delivery.whatStillWorks ?? "", details: delivery.details ?? "", nextUpdateAt: delivery.nextUpdateAt, componentChanges: parsePublishedComponentChanges(delivery.componentChangesJson), nextUpdateDisplay: delivery.nextUpdateAt ? displayNotificationTime(delivery.nextUpdateAt, delivery.timezone) : null })
          : renderMaintenanceNotice(delivery);
      if (!rendered) throw permanentDeliveryError("This notification event has no supported rendered content.");
      const host = new URL(origin).host;
      const pageName = options.pageName ? await options.pageName() : lampConfig.pageName;
      const statusUrl = new URL("/", origin).href;
      const brand = options.emailBranding ? await options.emailBranding() : { branding: defaultEmailBranding, hasLogo: false };
      const branded = brandEmail(rendered.email, { ...brand, pageName, fromAddress, origin });
      const candidate: FrozenMailPayload = {
        frozenAt: nowIso(), from: branded.from, ...(branded.replyTo ? { replyTo: branded.replyTo } : {}), to: delivery.destination, subject: branded.subject,
        text: `${branded.plainText}\n\nManage this subscription: ${manageUrl}\nUnsubscribe: ${unsubscribeUrl}\nReturn to status: ${statusUrl}`,
        html: `<main>${branded.html}<p><a href="${htmlText(manageUrl)}">Manage subscription</a> · <a href="${htmlText(unsubscribeUrl)}">Unsubscribe</a></p></main>`,
        headers: {
          "List-Unsubscribe": `<mailto:${fromAddress}?subject=unsubscribe>, <${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          "List-Id": `<${host}>`, "List-Archive": `${origin}/history`, "List-Help": manageUrl, "Auto-Submitted": "auto-generated",
          ...(delivery.incidentId ? { "Message-ID": delivery.isFirstIncidentUpdate ? `<lamp-${delivery.incidentId}@${host}>` : `<lamp-notification-${delivery.id}@${host}>` } : {}),
          ...(delivery.incidentId && !delivery.isFirstIncidentUpdate ? { "In-Reply-To": `<lamp-${delivery.incidentId}@${host}>`, References: `<lamp-${delivery.incidentId}@${host}>` } : {}),
        },
        idempotencyKey: `notification/${delivery.id}`,
      };
      envelope = parseFrozenMailPayload(await repository.freezeMailPayload(delivery.id, JSON.stringify(candidate)));
    }
    if (Date.now() - new Date(envelope.frozenAt).getTime() >= RESEND_IDEMPOTENCY_WINDOW_MS) throw permanentDeliveryError("The mail provider idempotency window expired before delivery could be confirmed.");
    const { frozenAt: _frozenAt, ...messageInput } = envelope;
    const message = await options.mail.send(messageInput);
    if (message.disposition === 'suppressed') {
      const timestamp = nowIso();
      await repository.markOutcome(delivery.id, 'suppressed', timestamp, timestamp);
      return;
    }
    if (!message.providerMessageId) throw permanentDeliveryError("The mail sender returned no provider receipt.");
    const timestamp = nowIso();
    const pending = await repository.recordAcceptedEmailAttempt({ id: createUlid(), deliveryId: delivery.id, attemptedAt: timestamp, providerMessageId: message.providerMessageId, createdAt: timestamp });
    // Provider acceptance is deliberately not claimed as recipient delivery.
    // A callback may already be in the durable event ledger before this
    // provider ID mapping exists, so apply it only after recording the attempt.
    await applyPendingProviderEvents(message.providerMessageId, pending);
  }

  async function sendWebhook(delivery: DispatchableDelivery, origin: string) {
    const secrets = (Array.isArray(options.webhookSigningSecret) ? options.webhookSigningSecret : [options.webhookSigningSecret]).filter((value): value is string => Boolean(value));
    if (!secrets.length) throw new Error("WEBHOOK_SIGNING_SECRET is required for webhook subscriptions.");
    if (!isSafeWebhookDestination(delivery.destination)) throw new Error("Webhook delivery destination is not a public HTTPS URL.");
    const slack = new URL(delivery.destination).hostname === "hooks.slack.com";
    const destination = slack ? await resolveSlackWebhook(async () => delivery.destination, delivery.subscriberId) : delivery.destination;
    const incidentEvent = !slack && delivery.incidentId && delivery.incidentUpdateId ? await repository.getIncidentWebhookPayload(delivery.incidentId, delivery.incidentUpdateId, delivery.notificationEventId) : null;
    const event = incidentEvent
      ? { event: "incident.update.published", deliveryId: delivery.id, ...incidentEvent, incident: { ...incidentEvent.incident, impact: delivery.incidentImpact } }
      : { event: delivery.maintenanceId ? "maintenance.notice.published" : "incident.report.published", deliveryId: delivery.id, incident: delivery.incidentReference ? { reference: delivery.incidentReference, title: delivery.incidentTitle, impact: delivery.incidentImpact } : null, maintenance: delivery.maintenanceId ? { id: delivery.maintenanceId, reference: delivery.maintenanceReference, title: delivery.maintenanceTitle, state: delivery.maintenanceState, notice: delivery.maintenanceNoticeKind } : null };
    const body = JSON.stringify(slack ? renderSubscriberSlackMessage(delivery, origin) : event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = (await Promise.all(secrets.map(async (secret) => `v1=${await hmacSha256(secret, `${delivery.id}.${timestamp}.${body}`)}`))).join(" ");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(destination, { method: "POST", redirect: "manual", signal: controller.signal, headers: { "Content-Type": "application/json", "webhook-id": delivery.id, "webhook-timestamp": timestamp, "webhook-signature": signature }, body });
      if (slack) {
        const outcome = classifySlackIncomingWebhook({ status: response.status, headers: { "retry-after": response.headers.get("retry-after") ?? "" }, body: await response.text() });
        if (outcome.kind !== "accepted") throw new Error(`Slack webhook did not accept the message (${outcome.code}).`);
      } else if (response.status < 200 || response.status >= 300) throw new Error(`Webhook destination returned ${response.status}.`);
      const now = nowIso();
      const attempt = (await repository.getAttemptCount(delivery.id)) + 1;
      await repository.recordAttempt({ id: createUlid(), deliveryId: delivery.id, attemptNumber: attempt, attemptedAt: now, providerMessageId: null, error: null, createdAt: now });
      await repository.markOutcome(delivery.id, "delivered", now, now);
    } finally { clearTimeout(timeout); }
  }

  async function dispatchOperatorAlert(job: { id: string; payloadJson: string }) {
    if (!options.mail?.configured) throw new Error("mail.sender.v1 is unavailable.");
    let payload: { from?: unknown; recipients?: unknown; title?: unknown; text?: unknown };
    try { payload = JSON.parse(job.payloadJson) as { from?: unknown; recipients?: unknown; title?: unknown; text?: unknown }; } catch { throw permanentDeliveryError("Stored operator alert envelope is invalid."); }
    if (typeof payload.from !== "string" || !Array.isArray(payload.recipients) || !payload.recipients.every((recipient) => typeof recipient === "string") || typeof payload.title !== "string" || typeof payload.text !== "string") throw permanentDeliveryError("Stored operator alert envelope is invalid.");
    for (const recipient of payload.recipients) {
      await options.mail.send({
        from: payload.from, to: recipient, subject: payload.title, text: payload.text,
        headers: { "Auto-Submitted": "auto-generated" }, idempotencyKey: `operator-alert/${job.id}/${recipient}`,
      });
    }
  }

  async function applyProviderEvent(delivery: { id: string; subscriberId: string; channel: "email" | "webhook" }, event: { eventType: "delivered" | "bounced" | "complained"; hardBounce: boolean }, now: string) {
    // Provider events are monotone: a late accepted/delivered callback cannot
    // replace a bounce or complaint already recorded for the same delivery.
    await repository.markProviderOutcome(delivery.id, event.eventType, now);
    if (event.eventType === "complained") {
      // This may resume after an isolate died between the outcome write and
      // deactivation. Repository deactivation preserves an earlier terminal
      // reason, so an older event cannot rewrite the subscriber history.
      await deactivateSubscriber(delivery, "spam complaint", now);
      return;
    }
    if (event.eventType === "bounced") {
      if (event.hardBounce) {
        await deactivateSubscriber(delivery, "hard bounce", now);
        return;
      }
      // The callback may resume after the outcome commit but before this
      // deactivation. Rechecking on every replay makes that interruption
      // recoverable while deactivation itself remains idempotent.
      if ((await repository.countConsecutiveOutcomes(delivery.subscriberId, delivery.channel, ["bounced"], 5)) >= 5) {
        await deactivateSubscriber(delivery, "five consecutive soft bounces", now);
      }
    }
  }

  async function applyPendingProviderEvents(providerMessageId: string, committedPending?: PendingProviderEvent[]) {
    const pending = committedPending ?? await repository.listPendingProviderEvents(providerMessageId);
    if (!pending.length) return false;
    const delivery = await repository.findDeliveryByProviderMessageId(providerMessageId);
    if (!delivery) return false;
    let applied = false;
    const now = nowIso();
    const reclaimBefore = new Date(Date.now() - PROVIDER_CALLBACK_CLAIM_MS).toISOString();
    for (const event of pending) {
      if (!(await repository.claimProviderEvent(event.id, now, reclaimBefore))) continue;
      await applyProviderEvent(delivery, event, now);
      await repository.completeProviderEvent(event.id, delivery.id, nowIso());
      applied = true;
    }
    return applied;
  }

  return {
    async list(filter) {
      return repository.listDeliveries({ limit: filter?.limit ?? 100, offset: filter?.offset ?? 0, channel: filter?.channel, outcome: filter?.outcome, incidentUpdateId: filter?.incidentUpdateId });
    },
    async export(filter) {
      return repository.listDeliveries({ channel: filter?.channel, outcome: filter?.outcome, incidentUpdateId: filter?.incidentUpdateId });
    },
    async listSubscriptionMail(limit = 20) {
      return repository.listSubscriptionMail(limit);
    },
    async dispatchDue(origin, limit = 100) {
      if (options.effectsPaused) return;
      for (const job of await repository.listOutbox(limit, nowIso())) {
        if (!await repository.claimOutbox(job.id, nowIso(), new Date(Date.now() - DELIVERY_CLAIM_MS).toISOString())) continue;
        try {
          if (job.kind === "operator-alert") {
            await dispatchOperatorAlert(job);
            await repository.completeOutbox(job.id, nowIso());
            continue;
          }
          const payload = JSON.parse(job.payloadJson) as { eventId?: string };
          if (!payload.eventId) throw new Error("Outbox job has no notification event ID.");
          await this.dispatchEvent(payload.eventId, origin);
        } catch (error) {
          const attempts = job.attempts + 1;
          await repository.retryOutbox(job.id, { attempts, availableAt: retryAt(attempts), error: error instanceof Error ? error.message : "Notification dispatch failed.", now: nowIso(), failed: attempts > RETRY_DELAYS_MS.length });
        }
      }
      for (const providerMessageId of await repository.listPendingProviderMessageIds(limit)) {
        await applyPendingProviderEvents(providerMessageId);
      }
    },
    async dispatchEvent(eventId, origin) {
      if (options.effectsPaused) return;
      let firstFailure: unknown = null;
      for (const deliveryId of await repository.listQueuedDeliveryIdsForEvent(eventId)) {
        try { await this.dispatchDelivery(deliveryId, origin); }
        catch (error) { firstFailure ??= error; }
      }
      if (firstFailure) throw firstFailure;
      await repository.completeOutboxForEvent(eventId, nowIso());
    },
    async dispatchDelivery(deliveryId, origin) {
      if (options.effectsPaused) return;
      const claimAt = nowIso();
      const reclaimBefore = new Date(Date.now() - DELIVERY_CLAIM_MS).toISOString();
      const { claimed, delivery } = await repository.claimAndGetDelivery(deliveryId, claimAt, reclaimBefore);
      if (!claimed) return;
      if (!delivery || delivery.subscriberState !== "active") {
        if (delivery) await repository.markOutcome(delivery.id, "suppressed", nowIso(), nowIso());
        await repository.releaseDeliveryClaim(deliveryId);
        return;
      }
      try {
        if (delivery.channel === "email") await sendEmail(delivery, origin); else await sendWebhook(delivery, origin);
      } catch (error) { await recordFailure(delivery, error); throw error; }
      finally { await repository.releaseDeliveryClaim(deliveryId); }
    },
    async handleProviderEvent(input) {
      const now = nowIso();
      if (!input.providerMessageId) return;
      // The shared provider account may deliver another application's events.
      // Our durable claim predates the send, including early signed receipts.
      if (input.id.startsWith("sendgrid/") && !await repository.hasMailSendClaim(input.providerMessageId)) return;
      await repository.isProviderWebhookNew({ providerEventId: input.id, providerMessageId: input.providerMessageId, eventType: input.type, hardBounce: Boolean(input.hardBounce), now });
      // Even a duplicate callback can resume a record whose previous Worker
      // invocation crashed while it held the durable callback lease.
      await applyPendingProviderEvents(input.providerMessageId);
    },
    queueOperatorAlert,
  };
}
