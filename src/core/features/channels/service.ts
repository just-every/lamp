import { parsePublishedComponentChanges } from "../../shared/incident-component-changes";
import { DeliveryService } from "../../../../modules/integrations/core/delivery.ts";
import { D1SqlDatabase } from "../../../../modules/integrations/core/database.ts";
import { IntegrationsRepository } from "../../../../modules/integrations/core/repository.ts";
import { resolveSlackWebhook, SLACK_WEBHOOK_PROTOCOL } from "../../../../modules/integrations/slack/protocol.ts";
import { createLampSlackProtocol } from "./slack";
import { renderLampSlackMessage } from "./slack-message";
import { createUlid, nowIso } from "../../shared/ids";
import { renderChannelSlack, teamsCard, teamsTestCard, type ChannelPostData } from "./messages";
import { createChannelRepository, type ChannelDestination, type ChannelKind } from "./repository";
import { openUrl, sealingSecrets, sealUrl } from "./sealing";
import { createTeamsProtocol, TEAMS_WEBHOOK_PROTOCOL } from "./teams";
import { createChannelTransport, isChannelHost } from "./transport";

const NAMESPACE = "lamp-channels";
export type ChannelView = Omit<ChannelDestination, "sealedUrl">;

/** Slack and Teams
 * channels share Base's durable delivery service: one immutable delivery per
 * update and channel, retried on its policy, never sent twice once accepted. */
export function createChannelsService(db: D1Database, options: { effectsPaused?: boolean; webhookSecret?: string; developmentReceiver?: string; publicOrigin: () => Promise<string>; unavailable?: string | null }) {
  const repository = createChannelRepository(db);
  const integrations = new IntegrationsRepository(new D1SqlDatabase(db as never), NAMESPACE);
  const resolve = async (destinationId: string) => {
    const destination = await repository.find(destinationId);
    if (!destination) throw new Error("Channel unavailable");
    return openUrl(destination.sealedUrl, destination.id, sealingSecrets(options.webhookSecret));
  };
  const transport = createChannelTransport({ developmentReceiver: options.developmentReceiver });
  const delivery = new DeliveryService({
    repository: integrations, transport,
    protocols: [createLampSlackProtocol(resolve), createTeamsProtocol(resolve)],
  });
  const view = ({ sealedUrl: _sealed, ...channel }: ChannelDestination): ChannelView => channel;

  return {
    unavailable: options.unavailable ?? null,
    async list() { return (await repository.list()).map(view); },
    /** The URL is checked, sealed and never returned or logged again. */
    async add(input: { kind: ChannelKind; name: string; url: string; componentIds: string[] }, operatorId: string): Promise<ChannelView> {
      if (options.unavailable) throw new Error(options.unavailable);
      const name = input.name.trim().slice(0, 120);
      if (!name) throw new Error("Name the channel.");
      let url: URL;
      try { url = new URL(input.url.trim()); } catch { throw new Error(input.kind === "slack" ? "Paste the Slack incoming webhook URL (https://hooks.slack.com/services/…)." : "Paste the Teams channel's incoming webhook URL."); }
      if (input.kind === "slack") await resolveSlackWebhook(async () => url.href, "check").catch(() => { throw new Error("Paste the Slack incoming webhook URL (https://hooks.slack.com/services/…)."); });
      else if (url.protocol !== "https:" || !isChannelHost("teams", url.hostname) || url.username || url.password) throw new Error("Paste the Teams channel's incoming webhook URL (a Workflows webhook or *.webhook.office.com address).");
      const id = createUlid(), createdAt = nowIso();
      const componentIds = [...new Set(input.componentIds)];
      const destination = { id, kind: input.kind, name, sealedUrl: await sealUrl(url.href, id, sealingSecrets(options.webhookSecret)), host: url.hostname, selectionMode: componentIds.length ? "selected" as const : "all" as const, createdAt };
      await repository.insert(destination, componentIds, operatorId);
      return view({ ...destination, componentIds });
    },
    remove: (id: string) => repository.remove(id, nowIso()),
    /** Post one plainly labelled test message now, outside the durable update log, and report the provider's answer. */
    async sendTest(id: string): Promise<{ sent: boolean; message: string } | null> {
      if (options.unavailable) return { sent: false, message: options.unavailable };
      const destination = await repository.find(id);
      if (!destination) return null;
      const text = `Test post from Lamp. Published incident updates for ${destination.selectionMode === "all" ? "every visible component" : "this channel's components"} will appear in ${destination.name}.`;
      const body = destination.kind === "slack" ? JSON.stringify(renderLampSlackMessage(text, [text])) : teamsTestCard(text);
      const provider = destination.kind === "slack" ? "Slack" : "Teams";
      try {
        const url = await resolve(id);
        const response = await transport.send({ url, headers: { "content-type": "application/json; charset=utf-8" }, body });
        const accepted = response.status >= 200 && response.status < 300 && (destination.kind !== "slack" || response.body === "ok");
        const providerError = destination.kind === "slack" && response.body ? `: ${response.body.replaceAll(url, "[webhook URL]")}` : "";
        return accepted
          ? { sent: true, message: `${provider} accepted the test post. Check ${destination.name} for it.` }
          : { sent: false, message: `${provider} refused the test post (HTTP ${response.status}${providerError}). Create a new webhook URL, remove this channel and add it again.` };
      } catch {
        return { sent: false, message: `Lamp could not reach ${provider}. Check the webhook URL and try again.` };
      }
    },
    postStatements: repository.postStatements.bind(repository),
    log: (limit = 100) => repository.log(limit),
    /** Queue each committed post once, then send whatever is due. */
    async dispatchPending(limit = 25) {
      if (options.effectsPaused || options.unavailable) return;
      const origin = await options.publicOrigin();
      for (const post of await repository.pending(limit)) {
        const data: ChannelPostData = { incidentImpact: post.incidentImpact, reference: post.reference, title: post.title, lifecycle: post.lifecycle, customerImpact: post.customerImpact, affectedAudience: post.affectedAudience, whatStillWorks: post.whatStillWorks, details: post.details, nextUpdateAt: post.nextUpdateAt, timezone: post.timezone, componentChanges: parsePublishedComponentChanges(post.componentChangesJson), url: new URL(`/incidents/${encodeURIComponent(post.reference)}`, origin).href };
        try {
          await delivery.enqueue(post.kind === "slack"
            ? { id: post.id, tenant: NAMESPACE, destinationId: post.destinationId, event: "incident.update", protocol: SLACK_WEBHOOK_PROTOCOL, body: JSON.stringify(renderChannelSlack(data)) }
            : { id: post.id, tenant: NAMESPACE, destinationId: post.destinationId, event: "incident.update", protocol: TEAMS_WEBHOOK_PROTOCOL, body: teamsCard(data) });
        } catch {
          // The address or message failed its checks; nothing was sent. No URL or text is logged.
          console.error(`Lamp could not queue channel post ${post.id}.`);
        }
      }
      return delivery.dispatchDue(limit);
    },
  };
}
export type ChannelsService = ReturnType<typeof createChannelsService>;
