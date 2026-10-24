import { type MailMessage, type MailSender, type SentMail } from './sender';
import type { MailRouteRepository } from './failover.repository';

export type DirectMailProvider = 'resend' | 'sendgrid' | 'mailgun' | 'ses' | 'postmark';
const hash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const fail = (message: string, retryable = false) => Object.assign(new Error(message), { retryable });

/** Routing is persisted before transport. Five minutes of explicit retryable
 * rejections permits a secondary; an uncertain primary send never does. */
export class FailoverMailSender implements MailSender {
  readonly configured: boolean;
  constructor(private readonly primary: { provider: DirectMailProvider; sender: MailSender },
    private readonly secondary: { provider: DirectMailProvider; sender: MailSender }, private readonly repository: MailRouteRepository,private readonly configurationIdentity:string) {
    if (primary.provider === secondary.provider) throw new Error('The secondary mail provider must differ from the primary.');
    this.configured = primary.sender.configured && secondary.sender.configured;
  }
  async send(message: MailMessage): Promise<SentMail> {
    const key=await hash(message.idempotencyKey),configurationHash=await hash(this.configurationIdentity);
    let route,enabled=false;
    {
      const envelopeHash=await hash(JSON.stringify(message));
      route = await this.repository.ensure({ key, deliveryId: /^notification\/[0-9A-HJKMNP-TV-Z]{26}$/.test(message.idempotencyKey)?message.idempotencyKey.slice(13):null, hash: envelopeHash, configurationHash, primary: this.primary.provider, secondary: this.secondary.provider, now: new Date().toISOString() });
      if (!route || route.envelope_hash !== envelopeHash) throw fail('Mail envelope changed for an existing idempotency key.');
      if (route.state === 'accepted' && route.provider_message_id) return { providerMessageId: route.provider_message_id };
      if(route.configuration_hash!==configurationHash||route.primary_provider!==this.primary.provider||route.secondary_provider!==this.secondary.provider)throw fail('Mail routing changed for an unconfirmed submission.');
      enabled=await this.repository.secondaryEnabled(this.secondary.provider);
      if(!enabled&&route.selected_provider!==this.primary.provider)throw fail('The selected secondary provider is disabled; an unconfirmed send cannot return to the primary.');
      route = await this.repository.claim(key,new Date().toISOString(),new Date(Date.now()-5*60_000).toISOString(),new Date(Date.now()-30_000).toISOString(),enabled);
      if (!route) throw fail('Mail submission is already in progress.',true);
    }
    const sender = route.selected_provider === this.primary.provider ? this.primary.sender : this.secondary.sender;
    try {
      const result = await sender.send(message);
      if (result.disposition === 'suppressed') throw fail('A hosted failover provider suppressed the message.');
      await this.repository.accepted(key,route.selected_provider,result.providerMessageId,new Date().toISOString());
      return result;
    } catch (error) {
      const safe = Boolean(error && typeof error === 'object' && 'retryable' in error && error.retryable === true && 'failoverSafe' in error && error.failoverSafe === true);
      await this.repository.failed(key,safe,new Date().toISOString());
      if(safe&&enabled&&route.selected_provider===this.primary.provider)Object.assign(error as Error,{mailFailoverAt:new Date(Date.parse(route.first_retryable_failure_at??new Date().toISOString())+5*60_000).toISOString()});
      throw error;
    }
  }
}

/** Removing secondary configuration never erases an earlier routing decision.
 * Accepted mail keeps its receipt; an unconfirmed prior route requires repair
 * with its original configuration, rather than another provider submission. */
export class MailRouteGuardSender implements MailSender {
  readonly configured:boolean;
  constructor(private readonly sender:MailSender,private readonly repository:MailRouteRepository){this.configured=sender.configured;}
  async send(message:MailMessage):Promise<SentMail>{
    const previous=await this.repository.get(await hash(message.idempotencyKey));
    if(!previous)return this.sender.send(message);
    if(previous.envelope_hash!==await hash(JSON.stringify(message)))throw fail('Mail envelope changed for an existing idempotency key.');
    if(previous.state==='accepted'&&previous.provider_message_id)return {providerMessageId:previous.provider_message_id};
    throw fail('The original secondary configuration is required to reconcile an unconfirmed mail submission.');
  }
}
