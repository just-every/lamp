import { MailPreparationError, MailUnavailableError, type MailMessage, type MailSender, type SentMail } from "./sender";

interface ResendResponse {
  id?: string;
  message?: string;
  name?: string;
}

/**
 * Resend is the concrete mail.sender.v1 adapter. It uses the public HTTPS API
 * directly so the Worker stays on web-standard fetch instead of a Node SDK.
 */
export class ResendMailSender implements MailSender {
  readonly configured: boolean;
  readonly supportsCalendarAttachments = true;

  constructor(private readonly configuration: { apiKey?: string; fromAddress?: string }) {
    this.configured = Boolean(configuration.apiKey && configuration.fromAddress);
  }

  async send(message: MailMessage): Promise<SentMail> {
    if (!this.configuration.apiKey || !this.configuration.fromAddress) throw new MailUnavailableError();

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let submitted = false;
    let response: Response;
    let result: ResendResponse;
    try {
      const controller = new AbortController();
      const request = new Request("https://api.resend.com/emails", {
        method: "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${this.configuration.apiKey}`, "Content-Type": "application/json", "User-Agent": "lamp-mail-sender/1.0", "Idempotency-Key": message.idempotencyKey },
        body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}), headers: message.headers, ...(message.attachments?.length ? {attachments:message.attachments.map(attachment=>({filename:attachment.filename,content:attachment.content,content_type:attachment.contentType}))} : {}) }),
      });
      timeout = setTimeout(() => controller.abort(), 20_000);
      submitted = true;
      response = await fetch(request);
      // Keep the same deadline while consuming the body. A response whose
      // headers arrive but whose JSON never does is still a provider timeout.
      result = await response.json().catch(() => ({})) as ResendResponse;
    } catch (error) {
      if (!submitted) throw new MailPreparationError(error);
      throw error;
    } finally { clearTimeout(timeout); }
    if (!response.ok || !result.id) {
      const error = new Error(result.message ?? result.name ?? `Resend rejected mail with ${response.status}.`);
      // Resend treats an idempotency key with a changed payload as a permanent
      // 409. Only an in-flight request bearing the same key is retryable.
      (error as Error & { retryable?: boolean }).retryable = response.status === 408 || response.status === 429 || response.status >= 500 || result.name === "concurrent_idempotent_requests";
      throw error;
    }
    return { providerMessageId: result.id };
  }
}
