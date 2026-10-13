import { hmacBytes } from './crypto.ts';
import type { Envelope } from './types.ts';

export interface TimestampedBodySignature {
  timestampHeader: string;
  signatureHeader: string;
  /** Omit to reuse the Base webhook signing key resolved for this preparation. */
  signingKey?: (envelope: Envelope) => Promise<Uint8Array>;
}

const reservedHeaders = new Set([
  'content-type', 'webhook-id', 'webhook-tenant', 'webhook-destination',
  'webhook-event', 'webhook-timestamp', 'webhook-signature',
  'host', 'connection', 'content-length', 'transfer-encoding', 'proxy-authorization',
  'authorization', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'upgrade',
]);
const headerToken = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function timestampedBodySigner(options: TimestampedBodySignature) {
  // Snapshot trusted configuration so later mutation cannot bypass validation.
  const { timestampHeader, signatureHeader, signingKey } = options;
  const names = [timestampHeader, signatureHeader];
  if (names.some(name => typeof name !== 'string' || !headerToken.test(name)))
    throw new Error('Invalid timestamped-body signature header name');
  const normalized = names.map(name => name.toLowerCase());
  if (new Set(normalized).size !== 2 || normalized.some(name => reservedHeaders.has(name)))
    throw new Error('Timestamped-body signature headers must be distinct and cannot replace Base headers or transport headers');
  if (signingKey !== undefined && typeof signingKey !== 'function')
    throw new Error('Invalid timestamped-body signing key resolver');

  return async (envelope: Envelope, timestampSeconds: string, baseKey: Uint8Array): Promise<Record<string, string>> => {
    const timestamp = new Date(Number(timestampSeconds) * 1000).toISOString();
    const key = signingKey === undefined ? baseKey : await signingKey(envelope);
    const digest = await hmacBytes(key, `${timestamp}.${envelope.body}`);
    const signature = btoa(String.fromCharCode(...digest)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    return { [timestampHeader]: timestamp, [signatureHeader]: signature };
  };
}
