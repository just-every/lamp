import { assertLabel, equalSignature, hmac, sha256 } from './crypto.ts';
import type { DeliveryProtocol, Envelope, WireResponse } from './types.ts';
import { timestampedBodySigner } from './timestamped-body-signature.ts';
import type { TimestampedBodySignature } from './timestamped-body-signature.ts';
export type { TimestampedBodySignature } from './timestamped-body-signature.ts';
const wireData = (e: Envelope, timestamp: string) => JSON.stringify(['integrations.webhook.v1', e.tenant, e.destinationId, e.event, e.id, timestamp, e.body]);
function exactBody(input: string | Uint8Array): string {
  if (typeof input !== 'string' && !(input instanceof Uint8Array)) throw new Error('Webhook body must be a string or raw Uint8Array');
  // Fatal decoding rejects replacement; ignoreBOM preserves a leading U+FEFF as
  // signed content instead of silently removing its original UTF-8 bytes.
  const body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
    typeof input === 'string' ? new TextEncoder().encode(input) : input,
  );
  if (typeof input === 'string' && body !== input) throw new Error('Webhook body must be valid UTF-8');
  return body;
}
export function retryAfter(response: WireResponse, now: number): number | undefined {
  const value = response.headers['retry-after'];
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const parsed = Date.parse(value); return Number.isFinite(parsed) ? Math.max(0, parsed - now) : undefined;
}
export function createWebhookProtocol(options: {
  resolveDestination: (destinationId: string) => Promise<string>;
  signingKey: (envelope: Envelope) => Promise<Uint8Array>;
  timestampedBodySignature?: TimestampedBodySignature;
}): DeliveryProtocol {
  const signBody = options.timestampedBodySignature === undefined ? undefined : timestampedBodySigner(options.timestampedBodySignature);
  return {
    id: 'webhook',
    async prepare(envelope, now) {
      const timestamp = String(Math.floor(now / 1000));
      const url = await options.resolveDestination(envelope.destinationId);
      const resolvedKey = await options.signingKey(envelope);
      if (!(resolvedKey instanceof Uint8Array) || resolvedKey.length < 32) throw new Error('HMAC key must contain at least 32 bytes');
      // Own one snapshot before asynchronous signing so both formats use the
      // same bytes even if the resolver's shared key rotates during preparation.
      const key = new Uint8Array(resolvedKey);
      const headers = {
        'content-type': 'application/json', 'webhook-id': envelope.id,
        'webhook-tenant': envelope.tenant, 'webhook-destination': envelope.destinationId, 'webhook-event': envelope.event,
        'webhook-timestamp': timestamp, 'webhook-signature': `v1=${await hmac(key, wireData(envelope, timestamp))}`,
      };
      if (!signBody) return { url, body: envelope.body, headers };
      exactBody(envelope.body);
      return { url, body: envelope.body, headers: { ...headers, ...await signBody(envelope, timestamp, key) } };
    },
    classify(response, now) {
      const status = response.status;
      if (status >= 200 && status < 300) return { kind: 'accepted', code: 'webhook_accepted', status };
      if (status === 429) return { kind: 'retryable', code: 'webhook_rate_limited', status, retryAfterMs: retryAfter(response, now) };
      if (status >= 400 && status < 500 && status !== 408) return { kind: 'rejected', code: 'webhook_rejected', status };
      return { kind: 'uncertain', code: 'webhook_response_uncertain', status };
    },
  };
}
export async function verifyWebhook(options: {
  /** Receivers must pass original bytes (e.g. new Uint8Array(await request.arrayBuffer())).
   * Strings are for already-owned canonical text, never request.text() or another lossy decode. */
  body: string | Uint8Array; headers: Headers | Record<string, string>; key: Uint8Array;
  tenant: string; destinationId: string; now?: number; toleranceMs?: number;
}) {
  const headers = options.headers instanceof Headers ? options.headers : new Headers(options.headers);
  const read = (name: string) => { const value = headers.get(name); if (!value) throw new Error('Missing webhook header'); return value; };
  const envelope: Envelope = { id: read('webhook-id'), tenant: read('webhook-tenant'), destinationId: read('webhook-destination'), event: read('webhook-event'), protocol: 'webhook', body: exactBody(options.body) };
  for (const value of [envelope.id, envelope.tenant, envelope.destinationId, envelope.event]) assertLabel(value);
  if (envelope.tenant !== options.tenant || envelope.destinationId !== options.destinationId) throw new Error('Webhook audience mismatch');
  const timestamp = read('webhook-timestamp'), now = options.now ?? Date.now(), tolerance = options.toleranceMs ?? 300000;
  if (!Number.isFinite(now) || !Number.isSafeInteger(tolerance) || tolerance < 1 || tolerance > 300000 || !/^\d{1,12}$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > tolerance) throw new Error('Webhook timestamp rejected');
  const signature = read('webhook-signature');
  if (!signature.startsWith('v1=') || !equalSignature(signature.slice(3), await hmac(options.key, wireData(envelope, timestamp)))) throw new Error('Webhook signature rejected');
  return { envelope, fingerprint: await sha256(JSON.stringify(envelope)), receivedAt: now };
}
