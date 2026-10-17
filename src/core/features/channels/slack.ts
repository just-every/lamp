import type { DeliveryProtocol } from "../../../../modules/integrations/core/types.ts";
import { resolveSlackWebhook, SLACK_WEBHOOK_PROTOCOL, type SlackWebhookResolver } from "../../../../modules/integrations/slack/protocol.ts";
import { classifySlackIncomingWebhook } from "../../../../modules/integrations/slack/classify.ts";
import { validateSlackEnvelope } from "./slack-message";

/** Lamp's rich-text extension keeps Base's endpoint and provider outcome rules. */
export function createLampSlackProtocol(resolveDestination: SlackWebhookResolver): DeliveryProtocol {
  return {
    id: SLACK_WEBHOOK_PROTOCOL,
    async prepare(envelope) {
      if (envelope.protocol !== SLACK_WEBHOOK_PROTOCOL) throw new Error("Wrong Slack protocol.");
      validateSlackEnvelope(envelope.body);
      return {
        url: await resolveSlackWebhook(resolveDestination, envelope.destinationId),
        headers: { "content-type": "application/json; charset=utf-8" },
        body: envelope.body,
      };
    },
    classify: classifySlackIncomingWebhook,
  };
}
