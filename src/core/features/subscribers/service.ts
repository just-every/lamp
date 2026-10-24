import { defaultPreferences, storedPreferences, renderPreferenceFields, type SubscriberPreferences } from "./preferences";
import type { SubscriberCapacity } from "./limits";
import { publicMasthead } from "../public-snapshot/page-chrome";
import { lampConfig } from "../../../ext/config";
import { MailUnavailableError, type MailMessage, type MailSender } from "../../platform/mail";
import { createOpaqueToken, hashOpaqueToken } from "../../platform/security/opaque-tokens";
import { createUlid, nowIso } from "../../shared/ids";
import { defaultSubscriberEvents, type SubscriberEvents } from "./events";
import { defaultSubscriberConfirmationPolicy, type SubscriberConfirmationPolicy } from "./policies";
import type { StoredSubscriber, StoredSubscriberComponent, SubscriberRepository, SubscriptionMailKind } from "./repository";
import { SubscriberTokenCodec, type SubscriberTokenScope } from "./tokens";
import { hasSafeWebhookDestination, normalizeEmail } from "./destination";
import { createSubscriberIntakeService } from "./intake.service";
import { createIntakeConfirmationSender } from "./intake-confirmation";
import type { AddedBy } from "./intake.repository";
import type { WebhookFormat } from "./webhook-format";
import { renderWebhookFormatField } from "./ui/webhook-format-field";

const CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const PENDING_WINDOW_MS = 72 * 60 * 60 * 1000;
/** Each import custody erasure is its own bounded D1 batch; a scheduled run takes a few. */
const CUSTODY_ERASURES_PER_RUN = 3;

export type SubscriberView = StoredSubscriber & { componentSelections: StoredSubscriberComponent[]; addedBy: AddedBy | null;webhookFormat:WebhookFormat|null; preferences: SubscriberPreferences };

export interface SubscribersService {
  intake: ReturnType<typeof createSubscriberIntakeService>;
  getPageName(): Promise<string>;
  getLimits(): Promise<SubscriberCapacity[]>;
  checkLimits(): Promise<void>;
  /** Names of the visible components among these ids, in display order. */
  componentNames(componentIds: string[]): Promise<string[]>;
  list(limit?: number, offset?: number): Promise<SubscriberView[]>;
  requestEmailSubscription(email: string, origin: string, componentIds?: string[], preferences?: SubscriberPreferences): Promise<void>;
  confirm(token: string): Promise<boolean>;
  getManagedSubscription(token: string): Promise<{ unsubscribeToken: string; subscriber: SubscriberView; components: Array<{ id: string; name: string }> } | null>;
  updateManagedSelection(token: string, componentIds: string[],webhookFormat?:WebhookFormat, preferences?: SubscriberPreferences): Promise<boolean>;
  unsubscribe(token: string): Promise<boolean>;
  createWebhookSubscription(input: { destination: string; contactEmail: string; componentIds: string[];webhookFormat?:WebhookFormat; preferences?: SubscriberPreferences }): Promise<SubscriberView>;
  deleteSubscriber(subscriberId: string, operatorId: string): Promise<boolean>;
  expirePending(): Promise<void>;
  inviteImported(subscriberId: string, origin: string, pageName: string, claimSend: () => Promise<boolean>): Promise<boolean>;
}

const SUBSCRIBER_ICONS = {
  mail: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="11" width="36" height="26" rx="4" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="m8 14 16 12 16-12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  done: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="m16 24.5 5.5 5.5L32.5 19" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
} as const;

/** One branded card under the business's masthead: the subscribe result and every emailed-link page. */
export function renderSubscriberTokenPage(title: string, body: string, pageName: string = lampConfig.pageName, icon?: keyof typeof SUBSCRIBER_ICONS) {
  const mark = icon ? `<span class="subscriber-icon">${SUBSCRIBER_ICONS[icon]}</span>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)} · ${escapeHtml(pageName)}</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/status-page.css"></head><body><main class="page subscriber-page">${publicMasthead(pageName, "subscribe")}<section class="subscriber-document" aria-labelledby="subscriber-title">${mark}<h1 id="subscriber-title">${escapeHtml(title)}</h1>${body}</section></main></body></html>`;
}

/** What a visitor sees right after the subscribe form. The same for new, pending, active and suppressed addresses. */
export function renderSubscribeResult(input: { email: string; components: string[] }, pageName: string) {
  const email = `<strong class="subscriber-email">${escapeHtml(input.email)}</strong>`;
  const scope = `<div class="subscriber-scope"><p class="subscriber-kicker">You'll hear about</p><p class="subscriber-scope-value">${input.components.length ? input.components.map(escapeHtml).join(", ") : "All components"}</p></div>`;
  const again = `<p><a class="subscriber-again" href="/#subscribe">Wrong address? Subscribe again <span aria-hidden="true">→</span></a></p>`;
  return renderSubscriberTokenPage("Check your inbox", `<p>We sent ${email} a link to confirm or manage your ${escapeHtml(pageName)} updates.</p>${scope}<p>Confirmation links work for 3 days.</p>${again}`, pageName, "mail");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function createSubscribersService(
  repository: SubscriberRepository,
  options: { onLimitAlert?: (alert:{eventId:string;title:string;text:string})=>Promise<void>; pageName?: () => Promise<string>; mail?: MailSender; fromAddress?: string | (() => Promise<string>); tokenSecret?: string; confirmationPolicy?: SubscriberConfirmationPolicy; events?: SubscriberEvents } = {},
): SubscribersService {
  const policy = options.confirmationPolicy ?? defaultSubscriberConfirmationPolicy;
  const tokens = options.tokenSecret ? new SubscriberTokenCodec(options.tokenSecret) : null;
  const events = options.events ?? defaultSubscriberEvents;

  async function emitAfterCommit(callback: () => Promise<void>) {
    try {
      await callback();
    } catch (cause) {
      console.error("Lamp subscriber event listener failed after its fact was committed.", cause);
    }
  }

  function requiredMailAndTokens() {
    if (!options.mail?.configured || !options.fromAddress || !tokens) throw new MailUnavailableError();
    return { mail: options.mail, tokens };
  }

  async function configuredFromAddress() {
    const address = typeof options.fromAddress === "function" ? await options.fromAddress() : options.fromAddress;
    if (!address) throw new MailUnavailableError();
    return address;
  }

  async function issuedToken(subscriberId: string, scope: SubscriberTokenScope, expiresAt: string | null) {
    if (!tokens) throw new Error("SUBSCRIBER_TOKEN_SECRET is required for subscriber tokens.");
    const id = createUlid();
    const token = await tokens.encode({ id, scope });
    const issuedId = await repository.ensureToken(subscriberId, scope, { id, tokenHash: await tokens.hash(token), expiresAt }, nowIso());
    return { token: issuedId === id ? token : await tokens.encode({ id: issuedId, scope }) };
  }

  async function fromToken(token: string, scope: SubscriberTokenScope) {
    if (!tokens || !(await tokens.validatesShapeAndSignature(token, scope))) return null;
    return repository.findSubscriberByToken(await tokens.hash(token), scope, nowIso());
  }

  async function visibleSelection(componentIds: string[]) {
    const valid = new Set((await repository.listVisibleComponents()).map((component) => component.id));
    return [...new Set(componentIds)].filter((componentId) => valid.has(componentId));
  }

  // Subscription mail goes straight to the provider, outside notification
  // deliveries; its outcome is recorded so Deliveries can show it.
  async function sendSubscriptionMail(mail: MailSender, subscriberId: string, kind: SubscriptionMailKind, message: MailMessage) {
    let outcome: "accepted" | "suppressed" | "failed" = "failed";
    try {
      outcome = (await mail.send(message))?.disposition === "suppressed" ? "suppressed" : "accepted";
    } finally {
      await repository.recordSubscriptionMail(subscriberId, kind, outcome, nowIso());
    }
  }

  async function view(subscriber: StoredSubscriber): Promise<SubscriberView> {
    const [componentSelections,addedBy,webhookFormat]=await Promise.all([repository.listComponents(subscriber.id),repository.intake.addedBy(subscriber.id),subscriber.channel==="webhook"?repository.formats.get(subscriber.id):Promise.resolve(null)]);
    return { ...subscriber, componentSelections, addedBy,webhookFormat, preferences: storedPreferences(subscriber) };
  }

  async function checkLimits() {
    if(options.onLimitAlert) for(const alert of await repository.limits.alerts()) await options.onLimitAlert(alert);
  }

  const pageName=async()=>options.pageName?options.pageName():lampConfig.pageName;
  const sendIntakeConfirmation=createIntakeConfirmationSender(repository,{
    mail:()=>requiredMailAndTokens().mail,from:configuredFromAddress,pageName,issue:issuedToken,
    send:(mail,subscriberId,message)=>sendSubscriptionMail(mail,subscriberId,"confirmation",message),
  });
  const intake=createSubscriberIntakeService(repository,{
    view:async id=>{const row=await repository.findSubscriber(id);if(!row)throw new Error("Subscriber no longer exists.");return view(row);},
    ensureConfigured:async()=>{requiredMailAndTokens();await configuredFromAddress();},
    sendConfirmation:sendIntakeConfirmation,
    checkLimits,
  });

  return {
    intake,
    getLimits:()=>repository.limits.report(),
    checkLimits,
    async getPageName() { return options.pageName ? options.pageName() : lampConfig.pageName; },
    async componentNames(componentIds) {
      const wanted = new Set(componentIds);
      return wanted.size ? (await repository.listVisibleComponents()).filter((component) => wanted.has(component.id)).map((component) => component.name) : [];
    },
    async list(limit = 100, offset = 0) {
      return Promise.all((await repository.listSubscribers(limit, offset)).map(view));
    },
    async requestEmailSubscription(rawEmail, origin, componentIds = [], preferences) {
      await repository.limits.assertAvailable("email");
      const { mail } = requiredMailAndTokens();
      const fromAddress = await configuredFromAddress();
      const pageName = await this.getPageName();
      const email = normalizeEmail(rawEmail);
      const timestamp = nowIso();
      const requiresConfirmation = policy.requiresConfirmation();
      // Import custody erasures are left to the scheduled run.
      await repository.deleteExpiredPending(new Date(Date.now() - PENDING_WINDOW_MS).toISOString(), 0);
      let subscriber = await repository.findSubscriberByDestination(email);
      const wasActive = subscriber?.state === "active";
      // Only a new or re-opened subscription takes the form's selection, so a
      // submit for an existing address changes nothing about it (SUB-012).
      const opened = !subscriber || subscriber.state === "deactivated";
      if (!subscriber) {
        const id = createUlid();
        await repository.createPendingSubscriber({
          id, channel: "email", destination: email, contactEmail: null, state: requiresConfirmation ? "pending" : "active", selectionMode: "all",
          tokenHash: await hashOpaqueToken(createOpaqueToken()), deactivationReason: null, deactivatedAt: null, createdAt: timestamp, updatedAt: timestamp,
        });
        // A concurrent submit can win the unique destination insert. Reload by
        // destination so both requests continue with that one subscription.
        subscriber = await repository.findSubscriberByDestination(email);
      } else if (subscriber.state === "deactivated") {
        await repository.createPendingSubscriber({ ...subscriber, state: requiresConfirmation ? "pending" : "active", deactivationReason: null, deactivatedAt: null, createdAt: timestamp, updatedAt: timestamp });
        subscriber = await repository.findSubscriber(subscriber.id);
      }
      if (!subscriber) throw new Error("Subscriber was not stored.");
      if (opened) {
        await repository.updateSelection(subscriber.id, await visibleSelection(componentIds), timestamp);
        await repository.preferences.set(subscriber.id, preferences ?? defaultPreferences("email"));
      }
      await this.checkLimits();
      if (subscriber.state === "pending" && await repository.intake.has(subscriber.id)) {
        // CSV's first invitation belongs to the owner's explicit action. A
        // repeated public request must not bypass that claim. An unsubscribe
        // followed by a fresh public opt-in starts its own new lifetime.
        if (opened) await sendIntakeConfirmation(subscriber.id,origin,null,false);
        return;
      }

      // An established subscriber gets the same neutral form response plus a
      // management-only email. This is not a confirmation message and does
      // not consume the confirmation anti-bomb allowance. It has its own: one
      // per subscription in the same 24 hours, reserved before sending. A
      // re-opened subscription has a new created_at, so it starts a new one.
      if (subscriber.state === "active" && wasActive) {
        const allowed = await repository.recordConfirmationSendIfAllowed(
          await hashOpaqueToken(`management-subscription:${subscriber.id}:${subscriber.createdAt}`),
          new Date(Date.now() - CONFIRMATION_WINDOW_MS).toISOString(),
          timestamp,
        );
        if (!allowed) return;
        const manage = await issuedToken(subscriber.id, "manage", null);
        const manageUrl = new URL(`/manage/${encodeURIComponent(manage.token)}`, origin).toString();
        await sendSubscriptionMail(mail, subscriber.id, "already-subscribed", {
          from: fromAddress, to: email, subject: `You are already subscribed to ${pageName}`,
          text: `You are already subscribed to ${pageName}. Manage this subscription: ${manageUrl}`,
          headers: { "Auto-Submitted": "auto-generated" }, idempotencyKey: `already-subscribed/${subscriber.id}/${timestamp}`,
        });
        return;
      }

      // The conditional upsert is the anti-bomb gate: concurrent submits let
      // exactly one sender reserve the 24-hour confirmation slot.
      const allowed = await repository.recordConfirmationSendIfAllowed(
        await hashOpaqueToken(`confirmation-address:${email}`),
        new Date(Date.now() - CONFIRMATION_WINDOW_MS).toISOString(),
        timestamp,
      );
      if (!allowed) return;

      const manage = await issuedToken(subscriber.id, "manage", null);
      const unsubscribe = await issuedToken(subscriber.id, "unsubscribe", null);
      if (subscriber.state === "active") {
        const manageUrl = new URL(`/manage/${encodeURIComponent(manage.token)}`, origin).toString();
        await sendSubscriptionMail(mail, subscriber.id, "subscribed", { from: fromAddress, to: email, subject: `${pageName} subscription`, text: `You are subscribed to ${pageName}. Manage this subscription: ${manageUrl}`, headers: { "Auto-Submitted": "auto-generated" }, idempotencyKey: `subscriber-active/${subscriber.id}` });
        return;
      }
      const confirm = await issuedToken(subscriber.id, "confirm", new Date(Date.parse(subscriber.createdAt) + PENDING_WINDOW_MS).toISOString());
      const confirmationUrl = new URL(`/confirm-subscription/${encodeURIComponent(confirm.token)}`, origin).toString();
      const unsubscribeUrl = new URL(`/unsubscribe/${encodeURIComponent(unsubscribe.token)}`, origin).toString();
      await sendSubscriptionMail(mail, subscriber.id, "confirmation", {
        from: fromAddress, to: email, subject: `Confirm your ${pageName} subscription`,
        text: `${pageName}\n\nConfirm this subscription: ${confirmationUrl}\n\nIf this was not you, you can ignore this email. Unsubscribe: ${unsubscribeUrl}\nReturn to status: ${new URL("/", origin).href}`,
        headers: { "Auto-Submitted": "auto-generated" }, idempotencyKey: `subscriber-confirmation/${subscriber.id}/${subscriber.createdAt}`,
      });
    },
    async confirm(token) {
      const matched = await fromToken(token, "confirm");
      if (!matched || matched.subscriber.state !== "pending") return false;
      const timestamp = nowIso();
      if (!await repository.confirmSubscriber({ subscriberId: matched.subscriber.id, tokenHash: matched.token.tokenHash }, timestamp)) return false;
      await emitAfterCommit(() => events.subscriberConfirmed({ subscriberId: matched.subscriber.id, channel: matched.subscriber.channel, occurredAt: timestamp }));
      return true;
    },
    async getManagedSubscription(token) {
      const matched = await fromToken(token, "manage");
      if (!tokens || !matched || matched.subscriber.state !== "active") return null;
      const id = createUlid();
      const candidate = await tokens.encode({ id, scope: "unsubscribe" });
      const authorizedId = await repository.ensureManagedUnsubscribeToken(matched.subscriber.id, matched.token.tokenHash, { id, tokenHash: await tokens.hash(candidate) }, nowIso());
      if (!authorizedId) return null;
      const unsubscribeToken = authorizedId === id ? candidate : await tokens.encode({ id: authorizedId, scope: "unsubscribe" });
      return { unsubscribeToken, subscriber: await view(matched.subscriber), components: await repository.listVisibleComponents() };
    },
    async updateManagedSelection(token, componentIds,webhookFormat, preferences) {
      const matched = await fromToken(token, "manage");
      if (!matched || matched.subscriber.state !== "active" || (webhookFormat && matched.subscriber.channel!=="webhook")) return false;
      return repository.updateManagedSelection({ subscriberId: matched.subscriber.id, tokenHash: matched.token.tokenHash }, await visibleSelection(componentIds), nowIso(),webhookFormat, preferences);
    },
    async unsubscribe(token) {
      const matched = await fromToken(token, "unsubscribe");
      if (!matched || matched.subscriber.state === "deactivated") return false;
      const timestamp = nowIso();
      // Following an emailed unsubscribe link proves the address is the subscriber's
      // own, so it restores the address's confirmation allowance (SUB-001): a later
      // re-subscribe gets a fresh confirmation instead of silence.
      const allowance = matched.subscriber.channel === "email" ? await hashOpaqueToken(`confirmation-address:${matched.subscriber.destination}`) : null;
      if (!await repository.unsubscribeSubscriber({ subscriberId: matched.subscriber.id, tokenHash: matched.token.tokenHash }, timestamp, allowance)) return false;
      await emitAfterCommit(() => events.subscriberDeactivated({ subscriberId: matched.subscriber.id, channel: matched.subscriber.channel, occurredAt: timestamp, reason: "unsubscribed" }));
      return true;
    },
    async createWebhookSubscription(input) {
      await repository.limits.assertAvailable("webhook");
      if (!hasSafeWebhookDestination(input.destination)) throw new Error("Webhook destinations must be public HTTPS URLs without credentials or a port.");
      const contactEmail = normalizeEmail(input.contactEmail);
      const timestamp = nowIso();
      const id = createUlid();
      await repository.createPendingSubscriber({
        id, channel: "webhook", destination: input.destination, contactEmail, state: "active", selectionMode: input.componentIds.length ? "selected" : "all",
        tokenHash: await hashOpaqueToken(createOpaqueToken()), deactivationReason: null, deactivatedAt: null, createdAt: timestamp, updatedAt: timestamp,
      });
      const subscriber = await repository.findSubscriberByDestination(input.destination);
      if (!subscriber) throw new Error("Webhook subscriber was not stored.");
      if (input.componentIds.length) await repository.updateSelection(subscriber.id, input.componentIds, timestamp);
      if (input.webhookFormat) await repository.formats.set(subscriber.id,input.webhookFormat);
      await repository.preferences.set(subscriber.id, input.preferences ?? defaultPreferences("webhook"));
      await this.checkLimits();
      const stored = await repository.findSubscriber(subscriber.id);
      if (!stored) throw new Error("Webhook subscriber no longer exists.");
      return view(stored);
    },
    async deleteSubscriber(subscriberId, operatorId) {
      const subscriber = await repository.findSubscriber(subscriberId);
      if (!subscriber) return false;
      const timestamp = nowIso();
      await repository.anonymizeAndDeactivate(subscriberId, operatorId, timestamp);
      await emitAfterCommit(() => events.subscriberDeactivated({ subscriberId, channel: subscriber.channel, occurredAt: timestamp, reason: "deleted by operator" }));
      return true;
    },
    /** A subscriber moved from another status page: one confirmation, nothing
     * about past incidents; without it the subscription expires as SUB-003 says. */
    async inviteImported(subscriberId, origin, pageName, claimSend) {
      const { mail } = requiredMailAndTokens();
      const subscriber = await repository.findSubscriber(subscriberId);
      if (!subscriber || subscriber.state !== "pending" || subscriber.channel !== "email") return false;
      const deadline = new Date(Date.parse(subscriber.createdAt) + PENDING_WINDOW_MS).toISOString();
      if (Date.parse(deadline) <= Date.now()) return false;
      const fromAddress = await configuredFromAddress();
      // Token reuse atomically caps expiry at this deadline, including when a
      // visitor requests a separate confirmation while the invitation is issued.
      const confirm = await issuedToken(subscriber.id, "confirm", deadline);
      const unsubscribe = await issuedToken(subscriber.id, "unsubscribe", null);
      const confirmationUrl = new URL(`/confirm-subscription/${encodeURIComponent(confirm.token)}`, origin).toString();
      const unsubscribeUrl = new URL(`/unsubscribe/${encodeURIComponent(unsubscribe.token)}`, origin).toString();
      if (Date.parse(deadline) <= Date.now()) return false;
      const message = {
        from: fromAddress, to: subscriber.destination, subject: `Confirm your ${pageName} subscription`,
        text: `${pageName} has moved its status page. You subscribed to its updates there; confirm before ${deadline} (the remaining part of the 72-hour window from import) to keep receiving them: ${confirmationUrl}\n\nIf you do nothing, you will receive no further email from this page. Unsubscribe: ${unsubscribeUrl}\nReturn to status: ${new URL("/", origin).href}`,
        headers: { "Auto-Submitted": "auto-generated" }, idempotencyKey: `subscriber-import-invite/${subscriber.id}`,
      };
      // Prepare subscriber authority before the claim. Adapter preparation may
      // explicitly prove non-submission; arbitrary send errors stay claimed.
      if (!await claimSend()) return false;
      await mail.send(message);
      return true;
    },
    async expirePending() {
      await repository.deleteExpiredPending(new Date(Date.now() - PENDING_WINDOW_MS).toISOString(), CUSTODY_ERASURES_PER_RUN);
      await checkLimits();
    },
  };
}

export function renderSubscriberManagementPage(input: { unsubscribeToken: string; subscriber: SubscriberView; components: Array<{ id: string; name: string }> }, pageName: string = lampConfig.pageName) {
  const selected = new Set(input.subscriber.componentSelections.map((selection) => selection.componentId));
  const checks = input.components.map((component) => `<label><input type="checkbox" name="componentId" value="${escapeHtml(component.id)}"${input.subscriber.selectionMode === "all" || selected.has(component.id) ? " checked" : ""}> ${escapeHtml(component.name)}</label>`).join("");
  const format = input.subscriber.channel === "webhook" ? renderWebhookFormatField(input.subscriber.webhookFormat) : "";
  const selection = checks || format || input.subscriber.preferences ? `<form method="post">${checks?`<fieldset><legend>Components</legend><p>Clear every selection to follow all current and future visible components.</p>${checks}</fieldset>`:""}${format}${renderPreferenceFields(input.subscriber.preferences)}<button type="submit">Save selection</button></form>` : "";
  return renderSubscriberTokenPage("Manage subscription", `<p>Channel: ${escapeHtml(input.subscriber.channel)}</p>${selection}<form method="post" action="/unsubscribe/${encodeURIComponent(input.unsubscribeToken)}"><input type="hidden" name="action" value="unsubscribe"><button type="submit">Unsubscribe</button></form>`, pageName);
}
