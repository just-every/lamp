import type { AppBindings } from './types';
import { developmentMail, SesMailSender, PostmarkMailSender, MailgunMailSender, FailoverMailSender, MailRouteGuardSender, createMailRouteRepository, type DirectMailProvider, ResendMailSender, SendGridMailSender, RerMailSender, createMailSendRepository, type MailSender } from '../platform/mail';

export type MailExecution = Request | 'background';

export function isLocalMailExecution(bindings: AppBindings): boolean {
  return bindings.RER_DEMO === '1' || Boolean(import.meta.env.DEV && bindings.RER_DEV_KEY && bindings.RER_DEV_ORIGIN);
}

// Session material is installation-local, including in each disposable demo.
export async function prepareAppMailBindings(bindings: AppBindings, _execution?: MailExecution): Promise<AppBindings> {
  if (bindings.MAIL_PROVIDER === 'rer') bindings = { ...bindings, MAIL_FROM_ADDRESS: bindings.MAIL_FROM ?? '' };
  if (!isLocalMailExecution(bindings)) return bindings;
  if (!bindings.SESSION_SECRET) return bindings;
  return { ...bindings, SUBSCRIBER_TOKEN_SECRET: bindings.SUBSCRIBER_TOKEN_SECRET || bindings.SESSION_SECRET,
    WEBHOOK_SIGNING_SECRET: bindings.WEBHOOK_SIGNING_SECRET || bindings.SESSION_SECRET };
}

export function createAppMailTransport(bindings: AppBindings, extension: MailSender | undefined, _execution?: MailExecution): { sender: MailSender; local: boolean } {
  if (bindings.MAIL_PROVIDER && !['rer', 'resend', 'sendgrid', 'mailgun', 'ses', 'postmark'].includes(bindings.MAIL_PROVIDER)) throw new Error('MAIL_PROVIDER must be rer, resend, sendgrid, mailgun, ses or postmark.');
  if (bindings.MAILGUN_REGION && !['us', 'eu'].includes(bindings.MAILGUN_REGION)) throw new Error('MAILGUN_REGION must be us or eu.');
  const repository = createMailSendRepository(bindings.DB);
  const providerSender = (provider: DirectMailProvider, apiKey: string | undefined): MailSender => provider === 'sendgrid'
    ? new SendGridMailSender({ apiKey, fromAddress: bindings.MAIL_FROM_ADDRESS }, repository)
    : provider === 'ses' ? new SesMailSender({ apiKey, fromAddress: bindings.MAIL_FROM_ADDRESS, region: bindings.SES_REGION, configurationSet: bindings.SES_CONFIGURATION_SET, topicArn: bindings.SES_EVENT_TOPIC_ARN }, repository)
    : provider === 'postmark' ? new PostmarkMailSender({ apiKey, fromAddress: bindings.MAIL_FROM_ADDRESS }, repository)
    : provider === 'mailgun' ? new MailgunMailSender({ apiKey, fromAddress: bindings.MAIL_FROM_ADDRESS, region: bindings.MAILGUN_REGION }, repository)
    : new ResendMailSender({ apiKey, fromAddress: bindings.MAIL_FROM_ADDRESS });
  const primaryProvider = bindings.MAIL_PROVIDER || 'resend';
  const primary = primaryProvider === 'rer'
    ? new RerMailSender({ apiKey: bindings.MAIL_API_KEY, fromAddress: bindings.MAIL_FROM, relayUrl: bindings.MAIL_RELAY_URL }, repository)
    : providerSender(primaryProvider, bindings.MAIL_PROVIDER_API_KEY);
  if (bindings.MAIL_SECONDARY_PROVIDER && (!['resend','sendgrid','mailgun','ses','postmark'].includes(bindings.MAIL_SECONDARY_PROVIDER) || primaryProvider === 'rer')) throw new Error('A secondary mail provider requires two different direct providers.');
  if (Boolean(bindings.MAIL_SECONDARY_PROVIDER) !== Boolean(bindings.MAIL_SECONDARY_API_KEY)) throw new Error('MAIL_SECONDARY_PROVIDER and MAIL_SECONDARY_API_KEY must be configured together.');
  const real = !extension && bindings.MAIL_SECONDARY_PROVIDER && primaryProvider !== 'rer'
    ? new FailoverMailSender({ provider: primaryProvider, sender: primary }, { provider: bindings.MAIL_SECONDARY_PROVIDER, sender: providerSender(bindings.MAIL_SECONDARY_PROVIDER,bindings.MAIL_SECONDARY_API_KEY) }, createMailRouteRepository(bindings.DB),JSON.stringify([primaryProvider,bindings.MAIL_PROVIDER_API_KEY,bindings.MAIL_SECONDARY_PROVIDER,bindings.MAIL_SECONDARY_API_KEY,bindings.MAILGUN_REGION,bindings.SES_REGION,bindings.SES_CONFIGURATION_SET]))
    : new MailRouteGuardSender(extension ?? primary,createMailRouteRepository(bindings.DB));
  if (bindings.RER_DEMO === '1') return { local: true, sender: { configured: true,
    async send(message) {
      const { demoEffect } = await import('@runeditrun/rer/modules/demo');
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
