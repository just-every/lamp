import type { MailSender } from './sender';

/** Local mail is deliberately silent and retains no message. */
export function developmentMail(): MailSender {
  return { configured: true, async send() { return { disposition: 'suppressed' }; } };
}
