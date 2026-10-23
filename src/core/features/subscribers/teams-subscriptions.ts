import { validateDestination } from "../../../../modules/integrations/core/destination.ts";
import { createChannelTransport, isChannelHost } from "../channels/transport";
import { sealUrl, sealingSecrets } from "../channels/sealing";
import { renderUpdateTeams } from "../../shared/update-links";
import { createUlid, nowIso } from "../../shared/ids";
import { hashOpaqueToken } from "../../platform/security/opaque-tokens";
import { createSubscriberRepository } from "./repository";
import { SubscriberTokenCodec } from "./tokens";
import { createChatSubscriptionRepository } from "./chat.repository";
import { createSubscriberLimitRepository } from "./limits.repository";
import { SubscriberLimitError } from "./limits";
import type { SubscriberPreferences } from "./preferences";

/** Teams Workflows accepts an Adaptive Card. Its only confirmation capability
 * goes to the selected channel, never back to the person submitting its URL. */
export function teamsVerificationCard(pageName: string, confirmationUrl: string) {
  return JSON.stringify({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4",
    body: [{ type: "TextBlock", text: renderUpdateTeams(`Confirm ${pageName} updates for this channel`), weight: "Bolder", wrap: true }],
    actions: [{ type: "Action.OpenUrl", title: "Confirm subscription", url: confirmationUrl }],
  } }] });
}

export function createTeamsSubscriptionsService(db: D1Database, options: {
  webhookSecret?: string; tokenSecret?: string; pageName: () => Promise<string>; unavailable?: string | null; limitsChanged?: () => Promise<void>;
}) {
  const subscribers = createSubscriberRepository(db);
  const chat = createChatSubscriptionRepository(db);
  const tokens = options.tokenSecret ? new SubscriberTokenCodec(options.tokenSecret) : null;
  const transport = createChannelTransport();
  async function confirmation(token: string) {
    if (!tokens || !await tokens.validatesShapeAndSignature(token, "confirm")) return null;
    const found = await subscribers.findSubscriberByToken(await tokens.hash(token), "confirm", nowIso());
    return found?.subscriber.channel === "teams" && found.subscriber.state === "pending" ? found : null;
  }
  return {
    async subscribe(input: { url: string; componentIds: string[]; preferences?: SubscriberPreferences }, origin: string) {
      if (options.unavailable) throw new Error(options.unavailable);
      if (!tokens) throw new Error("Teams subscriptions are not configured.");
      let url: URL;
      try { url = validateDestination(input.url.trim()); } catch { throw new Error("Paste a Microsoft Teams Workflows webhook URL."); }
      if (!isChannelHost("teams", url.hostname)) throw new Error("Paste a Microsoft Teams Workflows webhook URL.");
      const pageName = await options.pageName();
      await createSubscriberLimitRepository(db).assertAvailable("teams");
      const destination = `teams:${await hashOpaqueToken(url.href)}`;
      const existing = await subscribers.findSubscriberByDestination(destination);
      // Repeated public submissions do not change an established subscription.
      if (existing?.state === "active") return;
      const id = existing?.id ?? createUlid(), now = nowIso();
      const valid = new Set((await subscribers.listVisibleComponents()).map(component => component.id));
      const componentIds = [...new Set(input.componentIds)].filter(componentId => valid.has(componentId));
      const sealedUrl = await sealUrl(url.href, id, sealingSecrets(options.webhookSecret));
      try {
        await chat.create({ id, kind: "teams", destination, name: "Teams subscription", sealedUrl, host: url.hostname, componentIds, state: "pending", now, eventKinds: input.preferences?.eventKinds, minimumImpact: input.preferences?.minimumImpact });
      } catch (cause) {
        if (cause instanceof Error && cause.message.includes("over the subscriber limit")) throw new SubscriberLimitError();
        throw cause;
      }
      await options.limitsChanged?.();
      const tokenId = createUlid();
      const candidate = await tokens.encode({ id: tokenId, scope: "confirm" });
      const storedId = await subscribers.ensureToken(id, "confirm", { id: tokenId, tokenHash: await tokens.hash(candidate), expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() }, now);
      const token = storedId === tokenId ? candidate : await tokens.encode({ id: storedId, scope: "confirm" });
      const confirmationUrl = new URL(`/subscribe/teams/confirm/${encodeURIComponent(token)}`, origin).href;
      const response = await transport.send({ url: url.href, headers: { "content-type": "application/json; charset=utf-8" }, body: teamsVerificationCard(pageName, confirmationUrl) });
      if (response.status < 200 || response.status >= 300) throw new Error("Teams did not accept the verification card. Check the Workflows webhook URL.");
    },
    async canConfirm(token: string) { return Boolean(await confirmation(token)); },
    async confirm(token: string): Promise<{ manageToken: string } | null> {
      const found = await confirmation(token);
      if (!found || !tokens) return null;
      if (!await subscribers.confirmSubscriber({ subscriberId: found.subscriber.id, tokenHash: found.token.tokenHash }, nowIso())) return null;
      const id = createUlid(), candidate = await tokens.encode({ id, scope: "manage" });
      const storedId = await subscribers.ensureToken(found.subscriber.id, "manage", { id, tokenHash: await tokens.hash(candidate), expiresAt: null }, nowIso());
      return { manageToken: storedId === id ? candidate : await tokens.encode({ id: storedId, scope: "manage" }) };
    },
  };
}
export type TeamsSubscriptionsService = ReturnType<typeof createTeamsSubscriptionsService>;
