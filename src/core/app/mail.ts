import { demoMail, prepareDemoBindings } from '../platform/mail/demo';
import type { AppBindings } from './types';
import {
  createDevelopmentMailSender, prepareDevelopmentMailBindings, resolveDevelopmentMailOrigin,
  ResendMailSender, SendGridMailSender, createMailSendRepository,
  type MailSender,
} from '../platform/mail';

// HTTP composition must carry its real Request. Only the Worker lifecycle
// deliberately opts into configured-host-only background development capture.
export type MailExecution = Request | 'background';

export async function prepareAppMailBindings(bindings: AppBindings, execution?: MailExecution): Promise<AppBindings> {
  if (bindings.RER_DEMO === '1') return prepareDemoBindings(bindings);
  if (import.meta.env.DEV && execution) {
    return prepareDevelopmentMailBindings(bindings, execution === 'background' ? undefined : execution);
  }
  return bindings;
}

export function createAppMailTransport(bindings: AppBindings, extension: MailSender | undefined, execution?: MailExecution): { sender: MailSender; capturesLocally: boolean } {
  if (bindings.MAIL_PROVIDER && !['resend', 'sendgrid'].includes(bindings.MAIL_PROVIDER)) {
    throw new Error('MAIL_PROVIDER must be resend or sendgrid.');
  }
  const development = demoMail(bindings) ?? (import.meta.env.DEV && execution
    ? createDevelopmentMailSender(bindings, execution === 'background' ? undefined : execution)
    : null);
  if (development && extension) throw new Error('Local development capture cannot be combined with a mail.sender.v1 extension.');
  const sender = development ?? extension ?? (bindings.MAIL_PROVIDER === 'sendgrid'
    ? new SendGridMailSender({apiKey: bindings.MAIL_PROVIDER_API_KEY, fromAddress: bindings.MAIL_FROM_ADDRESS}, createMailSendRepository(bindings.DB))
    : new ResendMailSender({apiKey: bindings.MAIL_PROVIDER_API_KEY, fromAddress: bindings.MAIL_FROM_ADDRESS}));
  return { sender, capturesLocally: development !== null };
}

// Background links must use the canonical origin persisted from a validated
// local Request, including its actual scheme and port. Missing local setup
// throws in the development resolver rather than inventing a usable URL.
export async function notificationOrigin(bindings: AppBindings): Promise<string> {
  if (bindings.RER_DEMO === '1') {
    const origin = new URL(bindings.LAMP_LOCAL_ORIGIN || `https://${bindings.LAMP_APP_HOST}`);
    origin.hostname = bindings.LAMP_PAGE_HOST;
    return origin.origin;
  }
  if (import.meta.env.DEV) {
    const localOrigin = await resolveDevelopmentMailOrigin(bindings);
    if (localOrigin) return localOrigin;
    if (createDevelopmentMailSender(bindings)) {
      throw new Error("Open the configured local public page before dispatching development notifications.");
    }
  }
  return `https://${bindings.LAMP_PAGE_HOST}`;
}
