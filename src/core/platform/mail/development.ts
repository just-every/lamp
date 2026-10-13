import { canPrepareDevelopmentMail, canUseDevelopmentMail, isLoopbackHostname, type DevelopmentMailBindings } from '../../features/dev-outbox/access';
import { createDevOutboxRepository } from '../../features/dev-outbox/repository';
import { MailUnavailableError, type MailMessage, type MailSender, type SentMail } from './sender';

/** Native mail transport: a capture is durable local storage, never a receipt. */
export function createDevelopmentMailSender(bindings: DevelopmentMailBindings, request?: Request): MailSender | null {
  if (!canUseDevelopmentMail(bindings, request)) return null;
  const repository = createDevOutboxRepository(bindings.LAMP_DEV_OUTBOX!, bindings.LAMP_BASE_MAIL);
  return {
    get configured() { return canUseDevelopmentMail(bindings, request); },
    async send(message: MailMessage): Promise<SentMail> {
      if (!canUseDevelopmentMail(bindings, request)) throw new MailUnavailableError();
      const envelope = await repository.capture(message);
      return { disposition: 'captured', captureId: envelope.id };
    },
  };
}

/** Called before composing services in development. This creates no operator,
 * session or subscription; native authentication and confirmation are unchanged.
 * Subscriber links followed from the other surface get the local token secret;
 * public snapshot CORS reads cannot prepare mail, and sending stays same-site. */
export async function prepareDevelopmentMailBindings<T extends DevelopmentMailBindings & { SUBSCRIBER_TOKEN_SECRET?: string }>(bindings: T, request?: Request): Promise<T> {
  if (!(request ? canPrepareDevelopmentMail(bindings, request) : canUseDevelopmentMail(bindings))) return bindings;
  const repository = createDevOutboxRepository(bindings.LAMP_DEV_OUTBOX!, bindings.LAMP_BASE_MAIL);
  if (request) {
    const url = new URL(request.url);
    // A separately configured app host cannot establish the public origin. Only
    // an observed request to the actual page host may supply its scheme/port.
    if (url.hostname.toLowerCase() === bindings.LAMP_PAGE_HOST.toLowerCase()) await repository.claimPublicOrigin(url.origin);
  }
  if (bindings.SUBSCRIBER_TOKEN_SECRET) return bindings;
  const secret = await repository.subscriberTokenSecret();
  return { ...bindings, SUBSCRIBER_TOKEN_SECRET: secret };
}

/** No guessed HTTPS scheme, default port or most-recent-client origin. */
export async function resolveDevelopmentMailOrigin(bindings: DevelopmentMailBindings): Promise<string | null> {
  if (!canUseDevelopmentMail(bindings)) return null;
  const origin = await createDevOutboxRepository(bindings.LAMP_DEV_OUTBOX!, bindings.LAMP_BASE_MAIL).publicOrigin();
  if (origin === null) return null;
  try {
    const url = new URL(origin);
    if (url.origin === origin && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && isLoopbackHostname(url.hostname) && url.hostname.toLowerCase() === bindings.LAMP_PAGE_HOST.toLowerCase()) return origin;
  } catch { /* Invalid persisted configuration fails closed below. */ }
  throw new Error('The persisted development mail origin does not match the configured local page host. Intentionally reset the local outbox configuration before using a different origin. Stop pnpm dev and run: pnpm exec wrangler r2 object delete lamp-local-development-outbox/configuration/public-origin --local --persist-to .wrangler/state (or your LAMP_WORKERS_STATE_PATH).');
}
