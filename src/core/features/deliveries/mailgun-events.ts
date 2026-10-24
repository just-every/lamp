import { z } from 'zod';
import type { DeliveriesService } from './service';

const eventSchema = z.object({
  signature: z.object({ timestamp: z.string().regex(/^\d+$/), token: z.string().min(1).max(1000), signature: z.string().regex(/^[a-f0-9]{64}$/i) }),
  'event-data': z.object({ id: z.string().min(1).max(1000), event: z.string(), severity: z.string().optional(), 'delivery-status': z.object({code:z.number().int()}).optional(),
    'user-variables': z.object({ lamp_message_id: z.string().optional() }).optional() }),
});

/** Mailgun signs timestamp + token using its dedicated webhook signing key. */
export async function handleMailgunEvents(request: Request, signingKey: string | undefined, service: DeliveriesService) {
  if (!signingKey) return new Response('Mail delivery webhooks are not configured.', { status: 503 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 256 * 1024) return new Response('Mail provider event is too large.', { status: 413 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response('Malformed mail provider event.', { status: 400 }); }
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) return new Response('Malformed mail provider event.', { status: 400 });
  const { signature, 'event-data': event } = parsed.data;
  if (Math.abs(Date.now() / 1000 - Number(signature.timestamp)) > 300) return new Response('Invalid mail provider signature.', { status: 401 });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.signature.match(/../g)!, byte => parseInt(byte, 16));
  const valid = await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(signature.timestamp + signature.token));
  if (!valid) return new Response('Invalid mail provider signature.', { status: 401 });
  const type = event.event === 'delivered' ? 'delivered' : event.event === 'complained' ? 'complained' : event.event === 'failed' && event.severity === 'permanent' ? 'bounced' : null;
  const providerMessageId = event['user-variables']?.lamp_message_id;
  if (type && providerMessageId?.startsWith('mailgun-')) await service.handleProviderEvent({ id: `mailgun/${event.id}`, providerMessageId, type, hardBounce: event.severity === 'permanent' && (event['delivery-status']?.code ?? 0) >= 500 });
  return new Response(null, { status: 200 });
}
