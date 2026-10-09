import { sendSendGrid, serializeSendGridMessage, SendGridSendError } from '../../../modules/sendgrid-email/sender';
import { legacySendGridEnvelope } from './sendgrid-legacy-fingerprint';
import { MailUnavailableError, type MailMessage, type MailSender, type SentMail } from './sender';
import type { MailSendRepository } from './repository';

async function hash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function failure(message: string, retryable: boolean, providerMessageId?: string) {
  return Object.assign(new Error(message), { retryable, ...(providerMessageId ? { providerMessageId } : {}) });
}

export class SendGridMailSender implements MailSender {
  readonly configured: boolean;
  constructor(private readonly configuration: { apiKey?: string; fromAddress?: string }, private readonly repository: MailSendRepository) {
    this.configured = Boolean(configuration.apiKey && configuration.fromAddress);
  }
  async send(message: MailMessage): Promise<SentMail> {
    if (!this.configured) throw new MailUnavailableError();
    const providerMessageId = `sendgrid-${await hash(message.idempotencyKey)}`;
    const wireMessage = { ...message, to: [message.to], deliveryId: providerMessageId,
      customArgs: { lamp_message_id: providerMessageId, rer_product: 'lamp' }, subscriptionTracking: false };
    const envelopeHash = `v2:${await hash(serializeSendGridMessage(wireMessage))}`;
    if (!await this.repository.claim(providerMessageId, envelopeHash, new Date().toISOString())) {
      const previous = await this.repository.get(providerMessageId);
      if (!previous || (previous.envelope_hash !== envelopeHash && previous.envelope_hash !== await hash(legacySendGridEnvelope(message, providerMessageId)))) throw failure('Mail idempotency key was reused with a different envelope.', false);
      if (previous.state === 'accepted') return { providerMessageId };
      if (previous.state === 'sending' && Date.now() - Date.parse(previous.updated_at) < 30_000) throw failure('SendGrid request is already in progress.', true);
      throw failure('SendGrid acceptance is unconfirmed or rejected; automatic resend is disabled to prevent duplicate mail. Inspect signed provider receipts.', false, providerMessageId);
    }
    try {
      const receipt = await sendSendGrid({ apiKey: this.configuration.apiKey!, message: wireMessage, timeoutMilliseconds: 20_000 });
      await this.repository.finish(providerMessageId, 'accepted', receipt.providerMessageId);
      return { providerMessageId };
    } catch (error) {
      // A failed local settlement also leaves the durable claim closed to resends.
      if (!(error instanceof SendGridSendError)) throw failure('SendGrid local settlement failed; acceptance is unconfirmed. Inspect signed provider receipts.', false, providerMessageId);
      if (error.outcome === 'rate_limited') {
        await this.repository.releaseRejected(providerMessageId);
        throw failure('SendGrid rate limit rejected the request.', true);
      }
      const ambiguous = error.outcome === 'ambiguous';
      await this.repository.finish(providerMessageId, ambiguous ? 'uncertain' : 'rejected');
      throw failure(`${error.message}${ambiguous ? ' Automatic resend is disabled to prevent duplicate mail.' : ''}`, false, ambiguous ? providerMessageId : undefined);
    }
  }
}
