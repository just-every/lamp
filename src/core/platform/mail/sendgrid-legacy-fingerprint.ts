import type { MailMessage } from './sender';

// Compatibility with immutable 1.1.0 ledger hashes only. Never used for submission.
// Existing accepted and uncertain claims must survive the wire serializer change.
export function legacySendGridEnvelope(message: MailMessage, providerMessageId: string): string {
  return JSON.stringify({
      personalizations: [{ to: [{ email: message.to }], headers: message.headers, custom_args: { lamp_message_id: providerMessageId, rer_product: 'lamp' } }],
      from: { email: message.from }, subject: message.subject,
      content: [{ type: 'text/plain', value: message.text }, ...(message.html ? [{ type: 'text/html', value: message.html }] : [])],
      tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false }, subscription_tracking: { enable: false }, ganalytics: { enable: false } },
    });
}
