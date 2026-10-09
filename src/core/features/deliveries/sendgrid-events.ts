import { z } from 'zod';
import { verifyRelayRequest } from '../../platform/mail/relay-webhooks';
import { verifySendGridWebhook } from '../../platform/mail';
import type { DeliveriesService } from './service';

const eventsSchema = z.array(z.object({
  sg_event_id: z.string().min(1), event: z.string(), lamp_message_id: z.string().optional(), type: z.string().optional(),
}).passthrough()).max(1000);
export async function handleSendGridEvents(request: Request, publicKey: string | undefined, service: DeliveriesService, relaySecret?: string) {
  if (!publicKey && !relaySecret) return new Response('Mail delivery webhooks are not configured.', { status: 503 });
  const rawBody = await request.text();
  const relay = request.headers.has('x-rer-mail-signature') || request.headers.has('x-rer-mail-timestamp');
  const verified = relay
    ? await verifyRelayRequest({ secret: relaySecret ?? '', timestamp: request.headers.get('x-rer-mail-timestamp') ?? undefined, signature: request.headers.get('x-rer-mail-signature') ?? undefined, rawBody })
    : publicKey && await verifySendGridWebhook({ publicKey, timestamp: request.headers.get('x-twilio-email-event-webhook-timestamp') ?? undefined, signature: request.headers.get('x-twilio-email-event-webhook-signature') ?? undefined, rawBody });
  if (!verified) return new Response('Invalid mail provider signature.', { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return new Response('Malformed mail provider event.', { status: 400 }); }
  const events = eventsSchema.safeParse(payload);
  if (!events.success) return new Response('Malformed mail provider event.', { status: 400 });
  for (const event of events.data) {
    if (relay && event.rer_product !== 'lamp') continue;
    const type = event.event === 'delivered' ? 'delivered' : event.event === 'spamreport' ? 'complained' : event.event === 'bounce' || event.event === 'dropped' ? 'bounced' : null;
    if (type && event.lamp_message_id?.startsWith('sendgrid-')) await service.handleProviderEvent({ id: `sendgrid/${event.sg_event_id}`, providerMessageId: event.lamp_message_id, type, hardBounce: event.event === 'dropped' || event.type !== 'blocked' });
  }
  return new Response(null, { status: 200 });
}
