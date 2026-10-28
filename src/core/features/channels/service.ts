import type { AgentAction } from "../incidents/agent-action";
import { agentActionLines, parseAgentAction } from "../incidents/agent-action";
import type { DeliveryProtocol } from "../../../../modules/integrations/core/types.ts";
import { hashOpaqueToken } from "../../platform/security/opaque-tokens";
import { formatTime } from "../public-snapshot/format";
import { createChatSubscriptionRepository } from "../subscribers/chat.repository";
import { createChatEventRepository } from "./subscriber-events.repository";
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
  const chatSubscribers=createChatSubscriptionRepository(db);
  const chatEvents=createChatEventRepository(db);
  const resolvedIds=new Map<string,string>();
  const integrations = new IntegrationsRepository(new D1SqlDatabase(db as never), NAMESPACE);
  const resolve = async (destinationId: string) => {
    const destination = await repository.find(destinationId);
    if (!destination || !await chatEvents.active(destinationId)) throw new Error("Channel unavailable");
    const url=await openUrl(destination.sealedUrl, destination.id, sealingSecrets(options.webhookSecret));
    resolvedIds.set(url,destinationId);
    return url;
  };
  const providerTransport = createChannelTransport({ developmentReceiver: options.developmentReceiver });
  const transport: typeof providerTransport = { async send(request) {
    const response=await providerTransport.send(request);
    if(response.body==="channel_is_archived" && response.status>=400 && response.status<500){
      const id=resolvedIds.get(request.url);
      if(id)await chatSubscribers.deactivateArchived(id,nowIso());
    }
    return response;
  } };
  const alertConsent = (protocol: DeliveryProtocol): DeliveryProtocol => ({
    ...protocol,
    async prepare(envelope, now) {
      if (envelope.event === "operator.alert" && !await repository.operatorAlertsEnabled(envelope.destinationId)) throw new Error("Operator alerts are disabled for this channel.");
      return protocol.prepare(envelope,now);
    },
  });
  const delivery = new DeliveryService({
    repository: integrations, transport,
    protocols: [alertConsent(createLampSlackProtocol(resolve)), alertConsent(createTeamsProtocol(resolve))],
  });
  const view = ({ sealedUrl: _sealed, ...channel }: ChannelDestination): ChannelView => channel;

  let agentAdmission:((id:string,action:AgentAction,generation:string)=>Promise<boolean>)|undefined;
  async function dispatchPosts(limit:number,targetId?:string,admitted=false) {
      if (options.effectsPaused || options.unavailable) return;
      const origin = await options.publicOrigin();
      for (const post of await repository.pending(limit,targetId)) {
        const saved=parseAgentAction(post.agentActionJson);
        if(saved&&!admitted){if(agentAdmission)await agentAdmission(post.id,saved,String((await delivery.get(post.id))?.attempts??0));continue;}
        const data: ChannelPostData = { agentAction: parseAgentAction(post.agentActionJson), incidentImpact: post.incidentImpact, reference: post.reference, title: post.title, lifecycle: post.lifecycle, customerImpact: post.customerImpact, affectedAudience: post.affectedAudience, whatStillWorks: post.whatStillWorks, details: post.details, nextUpdateAt: post.nextUpdateAt, timezone: post.timezone, componentChanges: parsePublishedComponentChanges(post.componentChangesJson), url: new URL(`/incidents/${encodeURIComponent(post.reference)}`, origin).href };
        try {
          await delivery.enqueue(post.kind === "slack"
            ? { id: post.id, tenant: NAMESPACE, destinationId: post.destinationId, event: "incident.update", protocol: SLACK_WEBHOOK_PROTOCOL, body: JSON.stringify(renderChannelSlack(data)) }
            : { id: post.id, tenant: NAMESPACE, destinationId: post.destinationId, event: "incident.update", protocol: TEAMS_WEBHOOK_PROTOCOL, body: teamsCard(data) });
        } catch {
          // The address or message failed its checks; nothing was sent. No URL or text is logged.
          console.error(`Lamp could not queue channel post ${post.id}.`);
        }
      }
      for(const event of await chatEvents.pending(limit,targetId)){
        const saved=parseAgentAction(event.agentActionJson);
        if(saved&&!admitted){if(agentAdmission)await agentAdmission(event.id,saved,String((await delivery.get(event.id))?.attempts??0));continue;}
        const fields=event.kind==='component'
          ? [`${event.componentName}: ${event.previousState} → ${event.newState}`,`Changed: ${formatTime(event.changedAt!,event.timezone)} (${event.changedAt})`,`Claimant: ${event.claimantKind}`]
          : [`${event.reference}: ${event.title}`,`Maintenance: ${event.noticeKind}`,event.noticeBody ?? '',...agentActionLines(parseAgentAction(event.agentActionJson)),`Published: ${formatTime(event.publishedAt!,event.timezone)} (${event.publishedAt})`];
        await delivery.enqueue({id:event.id,tenant:NAMESPACE,destinationId:event.subscriberId,event:event.kind==='component'?'component.changed':'maintenance.notice',
          protocol:event.channelKind==='slack'?SLACK_WEBHOOK_PROTOCOL:TEAMS_WEBHOOK_PROTOCOL,
          body:event.channelKind==='slack'?JSON.stringify(renderLampSlackMessage(fields[0]!,fields)):teamsTestCard(fields.join('\n\n'))});
      }
      const result=[];
      // Re-evaluate subscriber authority after every terminal receipt, before a
      // later queued message can send to the same now-failing destination.
      for(const id of targetId?[targetId]:await integrations.due(Date.now(),limit)){
        const retained=await repository.dispatchRecord(id),saved=parseAgentAction(retained?.agentActionJson);
        if(saved&&!admitted){if(agentAdmission)await agentAdmission(id,saved,String((await delivery.get(id))?.attempts??0));continue;}
        result.push(await delivery.dispatch(id));
        await chatSubscribers.deactivateFailing(nowIso());
      }
      return result;
  }
  return {
    unavailable: options.unavailable ?? null,
    async list() { return (await repository.list()).map(view); },
    /** The URL is checked, sealed and never returned or logged again. */
    async add(input: { kind: ChannelKind; name: string; url: string; componentIds: string[]; operatorAlerts?: boolean }, operatorId: string): Promise<ChannelView> {
      if (options.unavailable) throw new Error(options.unavailable);
      const name = input.name.trim().slice(0, 120);
      if (!name) throw new Error("Name the channel.");
      let url: URL;
      try { url = new URL(input.url.trim()); } catch { throw new Error(input.kind === "slack" ? "Paste the Slack incoming webhook URL (https://hooks.slack.com/services/…)." : "Paste the Teams channel's incoming webhook URL."); }
      if (input.kind === "slack") await resolveSlackWebhook(async () => url.href, "check").catch(() => { throw new Error("Paste the Slack incoming webhook URL (https://hooks.slack.com/services/…)."); });
      else if (url.protocol !== "https:" || !isChannelHost("teams", url.hostname) || url.username || url.password) throw new Error("Paste the Teams channel's incoming webhook URL (a Workflows webhook or *.webhook.office.com address).");
      const id = createUlid(), createdAt = nowIso();
      const componentIds = [...new Set(input.componentIds)];
      const destination = { id, kind: input.kind, name, sealedUrl: await sealUrl(url.href, id, sealingSecrets(options.webhookSecret)), host: url.hostname, operatorAlerts: input.operatorAlerts ?? false, operatorManaged: true, selectionMode: componentIds.length ? "selected" as const : "all" as const, createdAt };
      await repository.insert(destination, componentIds, operatorId);
      return view({ ...destination, componentIds });
    },
    setOperatorAlerts: (id: string, enabled: boolean, operatorId: string) => repository.setOperatorAlerts(id,enabled,operatorId,nowIso()),
    remove: (id: string, operatorId: string) => repository.remove(id, operatorId, nowIso()),
    /** Post one plainly labelled test message now, outside the durable update log, and report the provider's answer. */
    async sendTest(id: string, attribution?: string): Promise<{ sent: boolean; message: string } | null> {
      if (options.unavailable) return { sent: false, message: options.unavailable };
      const destination = await repository.find(id);
      if (!destination) return null;
      const text = `Test post from Lamp.${attribution ? ` Prepared by ${attribution}.` : ""} Published incident updates for ${destination.selectionMode === "all" ? "every visible component" : "this channel's components"} will appear in ${destination.name}.`;
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
    /** Only explicitly opted-in operator channels receive private operational alerts, never subscriber destinations.
     * The event and destination form the durable idempotency key, independent of retries. */
    async queueOperatorAlert(input: { eventId: string; title: string; text: string; appOrigin: string }) {
      if (options.effectsPaused || options.unavailable) return;
      const failure = input.eventId.startsWith("delivery-failed/");
      // Provider failures can contain a destination, subscriber id or arbitrary provider text.
      // Keep that detail only in the private delivery log, never in a channel message.
      const text = failure ? "A subscriber notification could not be delivered. Review the private delivery log." : input.text;
      const path = input.eventId.startsWith("subscriber-limit/") ? "/app/subscribers" : failure ? "/app/deliveries" : "/app";
      const link = new URL(path,input.appOrigin).href;
      const fields = [input.title,text,link];
      for (const destination of await repository.operatorDestinations()) {
        const id = `operator-alert.${await hashOpaqueToken(input.eventId)}.${destination.id}`;
        if (await delivery.get(id)) continue;
        await delivery.enqueue({ id, tenant: NAMESPACE, destinationId: destination.id, event: "operator.alert",
          protocol: destination.kind === "slack" ? SLACK_WEBHOOK_PROTOCOL : TEAMS_WEBHOOK_PROTOCOL,
          body: destination.kind === "slack" ? JSON.stringify(renderLampSlackMessage(input.title,fields)) : teamsTestCard(fields.join("\n\n")),
        });
      }
    },
    postStatements: repository.postStatements.bind(repository),
    maintenanceStatements: chatEvents.maintenanceStatements,
    log: (limit = 100) => repository.log(limit),
    /** Queue each committed post once, then send whatever is due. */
    setAgentAdmission(admit:(id:string,action:AgentAction,generation:string)=>Promise<boolean>){agentAdmission=admit;},
    dispatchPending:(limit=25)=>dispatchPosts(limit),
    dispatchAdmittedPost:(id:string)=>dispatchPosts(1,id,true),
  };
}
export type ChannelsService = ReturnType<typeof createChannelsService>;
