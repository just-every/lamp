import { validateDestination } from '../core/index.ts';
import type { DeliveryProtocol } from '../core/index.ts';
import { classifySlackBot, classifySlackIncomingWebhook } from './classify.ts';
import { assertSlackChannel, validateSlackMessage } from './message.ts';

export const SLACK_WEBHOOK_PROTOCOL = 'slack.incoming-webhook.v1';
export const SLACK_BOT_PROTOCOL = 'slack.bot.v1';
export interface SlackBotDestination { token: string; channel: string }
/** Server-owned, tenant-scoped, versioned configuration. Never bind these to request input. */
export type SlackWebhookResolver = (destinationId: string) => Promise<string>;
export type SlackBotResolver = (destinationId: string) => Promise<SlackBotDestination>;

export async function resolveSlackWebhook(resolve: SlackWebhookResolver, id: string): Promise<string> {
  try {
    const value = await resolve(id);
    const url = validateDestination(value);
    if (url.hostname !== 'hooks.slack.com' || url.search || !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error();
    return url.href;
  } catch { throw new Error('Slack webhook configuration unavailable or invalid'); }
}
export async function resolveSlackBot(resolve: SlackBotResolver, id: string): Promise<SlackBotDestination> {
  try {
    const config = await resolve(id);
    // Snapshot trusted configuration before using it; no endpoint override exists.
    const token = config.token, channel = config.channel;
    assertSlackChannel(channel);
    if (typeof token !== 'string' || !/^(?:xoxe\.)?xoxb-[A-Za-z0-9-]+$/.test(token) || token.length > 4096) throw new Error();
    return { token, channel };
  } catch { throw new Error('Slack bot configuration unavailable or invalid'); }
}
function validateBody(body: string, channel?: string) {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new Error('Invalid Slack message JSON'); }
  validateSlackMessage(value, channel);
}
export function createSlackIncomingWebhookProtocol(options: { resolveDestination: SlackWebhookResolver }): DeliveryProtocol {
  const resolve = options.resolveDestination;
  if (typeof resolve !== 'function') throw new Error('Slack webhook resolver required');
  return {
    id: SLACK_WEBHOOK_PROTOCOL,
    async prepare(envelope) {
      if (envelope.protocol !== SLACK_WEBHOOK_PROTOCOL) throw new Error('Wrong Slack protocol');
      validateBody(envelope.body);
      const url = await resolveSlackWebhook(resolve, envelope.destinationId);
      return { url, headers: { 'content-type': 'application/json; charset=utf-8' }, body: envelope.body };
    },
    classify: classifySlackIncomingWebhook,
  };
}
export function createSlackBotProtocol(options: { resolveDestination: SlackBotResolver }): DeliveryProtocol {
  const resolve = options.resolveDestination;
  if (typeof resolve !== 'function') throw new Error('Slack bot resolver required');
  return {
    id: SLACK_BOT_PROTOCOL,
    async prepare(envelope) {
      if (envelope.protocol !== SLACK_BOT_PROTOCOL) throw new Error('Wrong Slack protocol');
      const config = await resolveSlackBot(resolve, envelope.destinationId);
      validateBody(envelope.body, config.channel);
      return {
        url: 'https://slack.com/api/chat.postMessage',
        headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${config.token}` },
        body: envelope.body,
      };
    },
    classify: classifySlackBot,
  };
}
