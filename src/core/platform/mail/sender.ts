export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers: Record<string, string>;
  /** Stable per recipient/event value. Adapters must enforce idempotence, using provider support or a durable send ledger. */
  idempotencyKey: string;
}

// Existing interface name: SendGrid uses a stable local callback/ledger identity;
// its actual HTTP receipt is stored separately in mail_send_ledger.provider_receipt.
export type SentMail = {
  providerMessageId: string;
  disposition?: "accepted";
} | {
  /** No provider was contacted. This identifies a durable local envelope only. */
  disposition: "captured";
  captureId: string;
};

export interface MailSender {
  readonly configured: boolean;
  send(message: MailMessage): Promise<SentMail>;
}

export class MailUnavailableError extends Error {
  constructor() {
    super("mail.sender.v1 requires MAIL_PROVIDER_API_KEY and MAIL_FROM_ADDRESS.");
    this.name = "MailUnavailableError";
  }
}

export class UnavailableMailSender implements MailSender {
  readonly configured = false;

  async send(): Promise<SentMail> {
    throw new MailUnavailableError();
  }
}
