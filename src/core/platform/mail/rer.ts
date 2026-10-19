import { createMailSender } from '../../../../modules/mail/index.mjs';
import { MailPreparationError, MailUnavailableError, type MailMessage, type MailSender, type SentMail } from './sender';
import type { MailSendRepository } from './repository';

async function hash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const failure = (message: string, retryable = false, providerMessageId?: string) =>
  Object.assign(new Error(message), { retryable, ...(providerMessageId ? { providerMessageId } : {}) });

/** Base owns the relay wire contract; Lamp keeps its durable delivery policy. */
export class RerMailSender implements MailSender {
  readonly configured: boolean;
  constructor(private readonly configuration: { apiKey?: string; fromAddress?: string; relayUrl?: string }, private readonly repository: MailSendRepository) {
    this.configured = Boolean(configuration.apiKey && configuration.fromAddress && configuration.relayUrl);
  }

  async send(message: MailMessage): Promise<SentMail> {
    if (!this.configured) throw new MailUnavailableError();
    if (message.replyTo || message.from.includes("<")) throw new MailPreparationError(new Error("Managed mail controls From and Reply-To."));
    // Lamp's frozen headers identify the logical incident message. The relay
    // owns the RFC ID; all recipients of that first update share its stable key.
    const headers = Object.fromEntries(Object.entries(message.headers).filter(([name]) => name.toLowerCase() !== 'message-id'));
    const logicalId = Object.entries(message.headers).find(([name]) => name.toLowerCase() === 'message-id')?.[1];
    const messageKey = `lamp:${await hash(logicalId ?? message.idempotencyKey)}`;
    for (const name of Object.keys(headers)) {
      if (!['in-reply-to', 'references'].includes(name.toLowerCase())) continue;
      const root = await this.repository.receiptForMessageKey(`lamp:${await hash(headers[name]!)}`);
      if (!root) throw failure('The first incident message has not been accepted by Managed mail. Lamp has queued another attempt.', true);
      headers[name] = root;
    }
    let id: string, envelopeHash: string, claimed: boolean, sender;
    const wire = { deliveryId: message.idempotencyKey, messageKey, from: this.configuration.fromAddress!, to: [message.to], subject: message.subject,
      text: message.text, ...(message.html ? { html: message.html } : {}), headers: Object.fromEntries(Object.entries(headers).map(([name, value]) =>
        [name, /^list-(archive|help)$/i.test(name) ? `<${value}>` : /^list-unsubscribe$/i.test(name) ? value.replace(/(<mailto:[^>?]+)\?subject=unsubscribe>/g, '$1>') : value])) };
    try {
      sender = createMailSender({ provider: 'rer', mode: 'production', apiKey: this.configuration.apiKey!, relayUrl: this.configuration.relayUrl! });
      id = `rer-${await hash(message.idempotencyKey)}`;
      envelopeHash = await hash(JSON.stringify(wire));
      claimed = await this.repository.claim(id, envelopeHash, new Date().toISOString(), messageKey);
    } catch (error) { throw new MailPreparationError(error); }
    if (!claimed) {
      const previous = await this.repository.get(id);
      if (!previous || previous.envelope_hash !== envelopeHash) throw failure('Mail idempotency key was reused with a different envelope.');
      if (previous.state === 'accepted' && previous.provider_receipt) return { providerMessageId: previous.provider_receipt };
      if (previous.state === 'sending' && Date.now() - Date.parse(previous.updated_at) < 30_000) throw failure('Managed mail submission is in progress.', true);
      throw failure('Managed mail acceptance is unconfirmed or rejected. Automatic resend is disabled to prevent duplicate mail.', false, id);
    }
    let result;
    try { result = await sender.send(wire); }
    catch (error) {
      // Base validates before attempting transport and sanitizes fetch failures.
      await this.repository.releaseRejected(id);
      throw new MailPreparationError(error);
    }
    if (result.status === 'rate_limited') {
      await this.repository.releaseRejected(id);
      throw failure('Managed mail is rate limited. Lamp has queued another attempt.', true);
    }
    if (result.status !== 'accepted') {
      await this.repository.finish(id, result.status === 'uncertain' ? 'uncertain' : 'rejected');
      throw failure(result.status === 'uncertain'
        ? 'Managed mail acceptance is unconfirmed. Automatic resend is disabled to prevent duplicate mail.'
        : 'Managed mail was rejected. Check the installation mail credential and Managed hosting status.', false, result.status === 'uncertain' ? id : undefined);
    }
    if (!result.providerMessageId) {
      await this.repository.finish(id, 'uncertain');
      throw failure('Managed mail accepted the message without a valid Message-ID. Automatic resend is disabled to prevent duplicate mail.', false, id);
    }
    try { await this.repository.finish(id, 'accepted', result.providerMessageId); }
    catch { throw failure('Managed mail settlement failed; acceptance is unconfirmed. Automatic resend is disabled to prevent duplicate mail.', false, id); }
    return { providerMessageId: result.providerMessageId };
  }
}
