import type { AppBindings } from '../../app/types';
import { createDevOutboxRepository } from '../../features/dev-outbox/repository';
import type { MailSender } from './sender';

/** Hosted and local demos share Base's durable outbox in disposable DB/R2. */
export function demoMail(bindings: AppBindings): MailSender | null {
  if (bindings.RER_DEMO !== '1') return null;
  const repository = createDevOutboxRepository(bindings.SNAPSHOTS, bindings.DB);
  return { configured: true, async send(message) {
    const envelope = await repository.capture(message);
    return { disposition: 'captured', captureId: envelope.id };
  } };
}

export async function prepareDemoBindings(bindings: AppBindings): Promise<AppBindings> {
  const secret = await createDevOutboxRepository(bindings.SNAPSHOTS, bindings.DB).subscriberTokenSecret();
  return { ...bindings, MAIL_PROVIDER_API_KEY: undefined, MAIL_PROVIDER: undefined, SUBSCRIBER_TOKEN_SECRET: secret, WEBHOOK_SIGNING_SECRET: secret };
}
