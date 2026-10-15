import type { AppBindings } from './types';
import { developmentMail, ResendMailSender, SendGridMailSender, createMailSendRepository, type MailSender } from '../platform/mail';

export type MailExecution = Request | 'background';

export function isLocalMailExecution(bindings: AppBindings): boolean {
  return bindings.RER_DEMO === '1' || Boolean(import.meta.env.DEV && bindings.RER_DEV_KEY && bindings.RER_DEV_ORIGIN);
}

// Session material is installation-local, including in each disposable demo.
export async function prepareAppMailBindings(bindings: AppBindings, _execution?: MailExecution): Promise<AppBindings> {
  if (!isLocalMailExecution(bindings)) return bindings;
  if (!bindings.SESSION_SECRET) return bindings;
  return { ...bindings, SUBSCRIBER_TOKEN_SECRET: bindings.SUBSCRIBER_TOKEN_SECRET || bindings.SESSION_SECRET,
    WEBHOOK_SIGNING_SECRET: bindings.WEBHOOK_SIGNING_SECRET || bindings.SESSION_SECRET };
}

export function createAppMailTransport(bindings: AppBindings, extension: MailSender | undefined, _execution?: MailExecution): { sender: MailSender; local: boolean } {
  if (bindings.MAIL_PROVIDER && !['resend', 'sendgrid'].includes(bindings.MAIL_PROVIDER)) throw new Error('MAIL_PROVIDER must be resend or sendgrid.');
  const real = extension ?? (bindings.MAIL_PROVIDER === 'sendgrid'
    ? new SendGridMailSender({ apiKey: bindings.MAIL_PROVIDER_API_KEY, fromAddress: bindings.MAIL_FROM_ADDRESS }, createMailSendRepository(bindings.DB))
    : new ResendMailSender({ apiKey: bindings.MAIL_PROVIDER_API_KEY, fromAddress: bindings.MAIL_FROM_ADDRESS }));
  if (bindings.RER_DEMO === '1') return { local: true, sender: { configured: true,
    async send(message) {
      const { demoEffect } = await import('../../../modules/demo/index.mjs');
      return demoEffect(() => real.send(message), () => ({ providerMessageId: `demo-${message.idempotencyKey}`, disposition: 'accepted' as const }));
    },
  } };
  if (isLocalMailExecution(bindings)) return { sender: developmentMail(), local: true };
  return { sender: real, local: false };
}

export async function notificationOrigin(bindings: AppBindings): Promise<string> {
  const url = new URL(bindings.LAMP_LOCAL_ORIGIN || `https://${bindings.LAMP_APP_HOST}`);
  url.hostname = bindings.LAMP_PAGE_HOST;
  return url.origin;
}
