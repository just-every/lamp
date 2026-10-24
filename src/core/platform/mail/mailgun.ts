import { MailPreparationError, MailUnavailableError, type MailMessage, type MailSender, type SentMail } from './sender';
import type { MailSendRepository } from './repository';

const encode = (value: ArrayBuffer) => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const hash = async (value: string) => encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const failure = (message: string, retryable = false, providerMessageId?: string) => Object.assign(new Error(message), { retryable,  ...(providerMessageId ? { providerMessageId } : {}) });

/** Mailgun has no send idempotency key. A durable claim therefore survives every
 * ambiguous submission; only an explicit HTTP rejection permits another send. */
export class MailgunMailSender implements MailSender {
  readonly configured: boolean;
  constructor(private readonly configuration: { apiKey?: string; fromAddress?: string; region?: 'us' | 'eu' }, private readonly repository: MailSendRepository) {
    this.configured = Boolean(configuration.apiKey && configuration.fromAddress);
  }
  async send(message: MailMessage): Promise<SentMail> {
    if (!this.configured) throw new MailUnavailableError();
    let id: string, fingerprint: string, body: URLSearchParams, claimed: boolean;
    try {
      id = `mailgun-${await hash(message.idempotencyKey)}`;
      body = new URLSearchParams({ from: message.from, to: message.to, subject: message.subject, text: message.text,
        'o:tracking': 'no', 'o:tracking-clicks': 'no', 'o:tracking-opens': 'no', 'v:lamp_message_id': id,
        ...(message.html ? { html: message.html } : {}), ...(message.replyTo ? { 'h:Reply-To': message.replyTo } : {}) });
      for (const [name, value] of Object.entries(message.headers)) body.set(`h:${name}`, value);
      fingerprint = await hash(body.toString());
      claimed = await this.repository.claim(id, fingerprint, new Date().toISOString());
    } catch (error) { throw new MailPreparationError(error); }
    if (!claimed) {
      const previous = await this.repository.get(id);
      if (!previous || previous.envelope_hash !== fingerprint) throw failure('Mail idempotency key was reused with a different envelope.');
      if (previous.state === 'accepted') return { providerMessageId: id };
      if (previous.state === 'sending' && Date.now() - Date.parse(previous.updated_at) < 30_000) throw failure('Mailgun request is already in progress.', true);
      throw failure('Mailgun acceptance is unconfirmed; automatic resend is disabled to prevent duplicate mail.', false, id);
    }
    let response: Response;
    try {
      const domain = this.configuration.fromAddress!.split('@')[1]!;
      response = await fetch(`https://${this.configuration.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net'}/v3/${encodeURIComponent(domain)}/messages`, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Basic ${btoa(`api:${this.configuration.apiKey}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      });
    } catch {
      await this.repository.finish(id, 'uncertain');
      throw failure('Mailgun acceptance is unconfirmed; automatic resend is disabled to prevent duplicate mail.', false, id);
    }
    if (!response.ok) {
      // Mailgun documents 429 and 5xx as retryable rejections. A response with
      // no successful receipt is recorded before its durable claim is released.
      if (response.status === 429 || response.status >= 500) {
        await this.repository.releaseRejected(id);
        throw Object.assign(failure(`Mailgun rejected mail with ${response.status}.`, true), { failoverSafe: true });
      }
      await this.repository.finish(id, 'rejected');
      throw failure(`Mailgun rejected mail with ${response.status}.`);
    }
    let receipt: unknown;
    try { receipt = await response.json(); } catch { receipt = null; }
    if (!receipt || typeof receipt !== 'object' || !('id' in receipt) || typeof receipt.id !== 'string' || !receipt.id) {
      await this.repository.finish(id, 'uncertain');
      throw failure('Mailgun returned no receipt; automatic resend is disabled to prevent duplicate mail.', false, id);
    }
    await this.repository.finish(id, 'accepted', receipt.id);
    return { providerMessageId: id };
  }
}
