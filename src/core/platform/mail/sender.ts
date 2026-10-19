export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
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
  /** Local development deliberately sends and retains nothing. */
  disposition: "suppressed";
};

export interface MailSender {
  readonly configured: boolean;
  /** Throw MailPreparationError only if no transport/capture was attempted.
   * All other failures, including uncertain prior submissions, retain claims. */
  send(message: MailMessage): Promise<SentMail>;
}

// The shared brand also works when an extension bundles its own API import.
const preparationFailure = Symbol.for('lamp.mail.preparation-failure');
export class MailPreparationError extends Error {
  readonly [preparationFailure] = true;
  constructor(cause: unknown) {
    super('Mail preparation failed before submission.', { cause });
    this.name = 'MailPreparationError';
  }
}
export function isMailPreparationError(error: unknown): error is MailPreparationError {
  return error instanceof Error && (error as MailPreparationError)[preparationFailure] === true;
}

export class MailUnavailableError extends MailPreparationError {
  constructor() {
    super(undefined);
    this.message = "Mail is not configured. Managed mail requires MAIL_FROM, MAIL_RELAY_URL and MAIL_API_KEY; direct providers require MAIL_FROM_ADDRESS and MAIL_PROVIDER_API_KEY.";
    this.name = "MailUnavailableError";
  }
}

export class UnavailableMailSender implements MailSender {
  readonly configured = false;

  async send(): Promise<SentMail> {
    throw new MailUnavailableError();
  }
}
