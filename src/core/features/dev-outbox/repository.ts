import type { MailMessage } from '../../platform/mail/sender';

export interface CapturedEnvelope {
  id: string;
  disposition: 'captured';
  capturedAt: string;
  envelopeHash: string;
  message: MailMessage;
}
const prefix = 'envelopes/';
const identifier = /^[a-f0-9]{64}$/;

export async function mailDigest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalMessage(message: MailMessage): MailMessage {
  return {
    from: message.from, to: message.to, subject: message.subject, text: message.text,
    ...(message.html === undefined ? {} : { html: message.html }),
    headers: Object.fromEntries(Object.entries(message.headers).sort(([a], [b]) => a.localeCompare(b))),
    idempotencyKey: message.idempotencyKey,
  };
}

/** A separate local R2 binding keeps secrets out of public snapshots and export.
 * There is no in-memory replacement when storage fails. */
export function createDevOutboxRepository(bucket: R2Bucket) {
  async function get(id: string): Promise<CapturedEnvelope | null> {
    if (!identifier.test(id)) return null;
    const object = await bucket.get(`${prefix}${id}.json`);
    if (!object) return null;
    const envelope = await object.json<CapturedEnvelope>();
    if (envelope.id !== id || envelope.disposition !== 'captured') throw new Error('Invalid development outbox envelope.');
    return envelope;
  }
  return {
    get,
    async capture(input: MailMessage): Promise<CapturedEnvelope> {
      const message = canonicalMessage(input);
      const id = await mailDigest(message.idempotencyKey);
      const envelopeHash = await mailDigest(JSON.stringify(message));
      const envelope: CapturedEnvelope = { id, disposition: 'captured', capturedAt: new Date().toISOString(), envelopeHash, message };
      const inserted = await bucket.put(`${prefix}${id}.json`, JSON.stringify(envelope), {
        onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' },
      });
      if (inserted) return envelope;
      const previous = await get(id);
      if (!previous || previous.envelopeHash !== envelopeHash) throw Object.assign(new Error('Mail idempotency key was reused with a different envelope.'), { retryable: false });
      return previous;
    },
    async list(cursor?: string): Promise<{ envelopes: CapturedEnvelope[]; cursor: string | null }> {
      const page = await bucket.list({ prefix, limit: 100, ...(cursor ? { cursor } : {}) });
      const envelopes = await Promise.all(page.objects.map(object => get(object.key.slice(prefix.length, -5))));
      return { envelopes: envelopes.filter((envelope): envelope is CapturedEnvelope => envelope !== null).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)), cursor: page.truncated ? page.cursor : null };
    },
    async publicOrigin(): Promise<string | null> {
      const object = await bucket.get('configuration/public-origin');
      return object ? object.text() : null;
    },
    async claimPublicOrigin(origin: string): Promise<void> {
      const key = 'configuration/public-origin';
      if (await bucket.put(key, origin, { onlyIf: { etagDoesNotMatch: '*' } })) return;
      const existing = await bucket.get(key);
      if (!existing || await existing.text() !== origin) {
        throw new Error('The local mail origin differs from the persisted development origin. Restore the original origin or intentionally reset the local outbox configuration.');
      }
    },
    async subscriberTokenSecret(): Promise<string> {
      const key = 'configuration/subscriber-token-secret';
      const existing = await bucket.get(key);
      if (existing) return existing.text();
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const secret = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (await bucket.put(key, secret, { onlyIf: { etagDoesNotMatch: '*' } })) return secret;
      const winner = await bucket.get(key);
      if (!winner) throw new Error('Development subscriber signing secret could not be persisted.');
      return winner.text();
    },
  };
}
export type DevOutboxRepository = ReturnType<typeof createDevOutboxRepository>;
