import { sendSendGrid, serializeSendGridMessage, SendGridSendError } from '../../../../modules/mail/src/sendgrid-email/index.mjs';
import { legacySendGridEnvelope } from './sendgrid-legacy-fingerprint';
import { MailPreparationError, MailUnavailableError, type MailMessage, type MailSender, type SentMail } from './sender';
import type { MailSendRepository } from './repository';

async function hash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function failure(message: string, retryable: boolean, providerMessageId?: string) {
  return Object.assign(new Error(message), { retryable, ...(providerMessageId ? { providerMessageId } : {}) });
}

export class SendGridMailSender implements MailSender {
  readonly configured: boolean;
  readonly supportsCalendarAttachments = true;
  constructor(private readonly configuration: { apiKey?: string; fromAddress?: string }, private readonly repository: MailSendRepository) {
    this.configured = Boolean(configuration.apiKey && configuration.fromAddress);
  }
  async send(message: MailMessage): Promise<SentMail> {
    if (!this.configured) throw new MailUnavailableError();
    let providerMessageId, wireMessage, envelopeHash, claimed;
    try {
      providerMessageId = `sendgrid-${await hash(message.idempotencyKey)}`;
      wireMessage = { ...message, ...(message.attachments ? {attachments:message.attachments.map(attachment=>({filename:attachment.filename,content:attachment.content,type:attachment.contentType.split(";", 1)[0]!.trim()}))} : {}), to: [message.to], deliveryId: providerMessageId,
        customArgs: { lamp_message_id: providerMessageId, rer_product: 'lamp' }, subscriptionTracking: false };
      envelopeHash = `v2:${await hash(serializeSendGridMessage(wireMessage))}`;
      claimed = await this.repository.claim(providerMessageId, envelopeHash, new Date().toISOString());
    } catch (error) { throw new MailPreparationError(error); }
    if (!claimed) {
      const previous = await this.repository.get(providerMessageId);
      if (!previous || (previous.envelope_hash !== envelopeHash && (Boolean(message.attachments?.length) || previous.envelope_hash !== await hash(legacySendGridEnvelope(message, providerMessageId))))) throw failure('Mail idempotency key was reused with a different envelope.', false);
      if (previous.state === 'accepted') return { providerMessageId };
      if (previous.state === 'sending' && Date.now() - Date.parse(previous.updated_at) < 30_000) throw failure('SendGrid request is already in progress.', true);
      throw failure('SendGrid acceptance is unconfirmed or rejected; automatic resend is disabled to prevent duplicate mail. Inspect signed provider receipts.', false, providerMessageId);
    }
    let submitted = false;
    try {
      const receipt = await sendSendGrid({ apiKey: this.configuration.apiKey!, message: wireMessage, timeoutMilliseconds: 20_000,
        fetch: (url, init) => { submitted = true; return fetch(url, init); },
      });
      await this.repository.finish(providerMessageId, 'accepted', receipt.providerMessageId);
      return { providerMessageId };
    } catch (error) {
      if (!submitted) {
        // This invocation owns the ledger claim and never called fetch. Only
        // this proven pre-transport failure may release it and the invitation.
        try { await this.repository.releaseRejected(providerMessageId); }
        finally { throw new MailPreparationError(error); }
      }
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
