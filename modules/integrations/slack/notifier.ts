import { DeliveryService } from '../core/index.ts';
import type { IntegrationsRepository, TrustedTransport } from '../core/index.ts';
import { renderSlackEvent, serializeSlackMessage } from './message.ts';
import type { SlackTemplates } from './message.ts';
import { createSlackBotProtocol, createSlackIncomingWebhookProtocol, resolveSlackBot, SLACK_BOT_PROTOCOL, SLACK_WEBHOOK_PROTOCOL } from './protocol.ts';
import type { SlackBotResolver, SlackWebhookResolver } from './protocol.ts';

export interface SlackNotification<Data> {
  id: string; tenant: string; destinationId: string; event: string;
  mode: 'incoming-webhook' | 'bot'; data: Data;
}
/** Durable enqueue and delivery lifecycle use core without a parallel in-memory queue. */
export function createSlackNotifier<Data>(options: {
  repository: IntegrationsRepository; transport: TrustedTransport; templates: SlackTemplates<Data>;
  incomingWebhook?: SlackWebhookResolver; bot?: SlackBotResolver; now?: () => number;
}) {
  const incomingWebhook = options.incomingWebhook, bot = options.bot;
  const templates = Object.freeze({ ...options.templates });
  const protocols = [
    ...(incomingWebhook ? [createSlackIncomingWebhookProtocol({ resolveDestination: incomingWebhook })] : []),
    ...(bot ? [createSlackBotProtocol({ resolveDestination: bot })] : []),
  ];
  if (!protocols.length) throw new Error('At least one Slack destination resolver is required');
  const delivery = new DeliveryService({ repository: options.repository, transport: options.transport, now: options.now, protocols });
  return {
    delivery,
    async enqueue(input: SlackNotification<Data>, retry?: { maxAttempts?: number; retryDelaysMs?: number[] }) {
      const { id, tenant, destinationId, event, mode } = input;
      if (mode !== 'bot' && mode !== 'incoming-webhook') throw new Error('Invalid Slack mode');
      if (mode === 'bot' ? !bot : !incomingWebhook) throw new Error('Slack mode is not configured');
      const message = renderSlackEvent(event, input.data, templates);
      const channel = mode === 'bot' ? (await resolveSlackBot(bot!, destinationId)).channel : undefined;
      return delivery.enqueue({ id, tenant, destinationId, event, protocol: mode === 'bot' ? SLACK_BOT_PROTOCOL : SLACK_WEBHOOK_PROTOCOL, body: serializeSlackMessage(message, channel) }, retry);
    },
  };
}
