import { verifySesDomain } from '../../platform/mail/ses';
import type { MailSender } from '../../platform/mail';
import { hashOpaqueToken } from '../../platform/security/opaque-tokens';

export interface SenderCheckOptions {
  local: boolean;
  provider: string;
  apiKey?: string;
  sesRegion?: string;
  postmarkAccountApiKey?: string;
  mailgunRegion?: "us" | "eu";
  mail: MailSender;
  fetcher?: typeof fetch;
  /** A disposable demo: the provider read is a Base demoEffect answering as verified. */
  demo?: boolean;
}
export const LOCAL_SENDER_NOTICE = 'Local mail is suppressed; check the sender on a hosted installation.';
export async function senderEvidenceKey(from: string, options: Pick<SenderCheckOptions, 'local' | 'provider' | 'apiKey' | 'mailgunRegion' | 'sesRegion' | 'postmarkAccountApiKey'>) {
  const identity=[from,options.local?'local':options.provider,options.local?'':options.apiKey??''];
  if(!options.local&&options.provider==='mailgun')identity.push(options.mailgunRegion??'us');
  if(!options.local&&options.provider==='ses')identity.push(options.sesRegion??'');
  if(!options.local&&options.provider==='postmark')identity.push(options.postmarkAccountApiKey??'');
  return hashOpaqueToken(JSON.stringify(identity));
}

interface SendGridDnsRecord {
  valid?: boolean;
  type: string;
  host: string;
  data: string;
}

interface SendGridDomain {
  domain?: string;
  valid?: boolean;
  dns?: Record<string, Partial<SendGridDnsRecord> | null>;
}

function sendGridAuthenticationError(domain: string, matches: SendGridDomain[]): string {
  const next = `In SendGrid, open Settings → Sender Authentication → ${domain}, run Verify, then check again in Lamp.`;
  if (!matches.length) {
    return `SendGrid has no domain authentication for ${domain} in the account accessible to the configured key. Open Settings → Sender Authentication in that account, authenticate ${domain}, and add the exact DNS records SendGrid generates. Then run Verify and check again in Lamp.`;
  }
  // Each authentication can have different DNS targets. Keep its outstanding
  // records together rather than combining duplicate authentications.
  const recordsFor = (entry: SendGridDomain) => Object.values(entry.dns ?? {}).filter((record): record is SendGridDnsRecord => Boolean(record && record.valid !== true
    && typeof record.type === 'string' && record.type && typeof record.host === 'string' && record.host
    && typeof record.data === 'string' && record.data));
  const records = matches.map(recordsFor).find(records => records.length) ?? [];
  if (records.length) {
    const instructions = records.map(record => `${record.type.toUpperCase()} ${record.host} → ${record.data}`).join('; ');
    const action = records.every(record => record.valid === false) ? 'Add or correct these DNS records' : 'Check these DNS records at your DNS host';
    const cname = records.some(record => record.type.toLowerCase() === 'cname') ? ' Set CNAME records to DNS only (not proxied).' : '';
    return `SendGrid has not verified ${domain}. ${action}: ${instructions}.${cname} ${next}`;
  }
  return `SendGrid has not verified ${domain} and returned no unverified DNS record with a complete type, host and value. Check the records shown in SendGrid; Lamp cannot name a missing record from this response. ${next}`;
}

/** Read provider authentication status, never infer verification from a saved
 * address. Local mode cannot verify a sender. */
export async function checkSender(from: string, _operatorEmail: string, options: SenderCheckOptions): Promise<string> {
  if (options.local) return LOCAL_SENDER_NOTICE;
  if (!options.demo) return verifyWithProvider(from, options);
  const { demoEffect } = await import('@runeditrun/rer/modules/demo');
  return demoEffect(() => verifyWithProvider(from, options), () => SENDER_VERIFIED);
}

const SENDER_VERIFIED = 'Sender domain verified by your mail provider. This checks authentication, not inbox delivery.';

async function verifyWithProvider(from: string, options: SenderCheckOptions): Promise<string> {
  if (!options.mail.configured) throw new Error('Configure your mail sender before checking it.');
  if (!options.apiKey || !['sendgrid', 'resend', 'mailgun', 'ses', 'postmark'].includes(options.provider)) throw new Error('This sender needs a supported provider credential for the verification check.');
  if(options.provider==='postmark'&&!options.postmarkAccountApiKey)throw new Error('Connect a Postmark account key in hosting settings to check sender authentication; a sending server token cannot read domains.');
  const domain = from.split('@')[1]?.toLowerCase();
  const fetcher = options.fetcher ?? fetch;
  let pages = 0;
  const deadline = Date.now() + 8000;
  const signal = AbortSignal.timeout(8000);
  async function read(url: string) {
    if (Date.now() >= deadline || signal.aborted || (options.provider !== 'sendgrid' && ++pages > 100)) throw new Error('Provider domain listing did not complete.');
    const response = await fetcher(url, { headers: options.provider === "postmark" ? { "X-Postmark-Account-Token": options.postmarkAccountApiKey!, Accept: "application/json" } : { Authorization: options.provider === "mailgun" ? `Basic ${btoa(`api:${options.apiKey}`)}` : `Bearer ${options.apiKey}` }, redirect: 'manual', signal });
    if (!response.ok) throw new Error('The mail check could not read provider domain authentication. Give the configured key read access to domains and check again.');
    return response.json() as Promise<unknown>;
  }
  let verified = false;
  const sendGridMatches: SendGridDomain[] = [];
  try {
    if (options.provider === 'ses') {
      verified = await verifySesDomain({apiKey:options.apiKey,region:options.sesRegion ?? ''},domain ?? '');
    } else if (options.provider === 'postmark') {
      for(let offset=0;!verified;offset+=100){
        const result=await read(`https://api.postmarkapp.com/domains?count=100&offset=${offset}`) as {Domains?:{Name?:string;DKIMVerified?:boolean}[]};
        if(!Array.isArray(result.Domains))throw new Error('Invalid Postmark domain page.');
        verified=result.Domains.some(row=>row.Name?.toLowerCase()===domain&&row.DKIMVerified===true);
        if(result.Domains.length<100)break;
      }
    } else if (options.provider === 'mailgun') {
      const result = await read(`https://${options.mailgunRegion === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net'}/v4/domains/${encodeURIComponent(domain ?? '')}`) as { domain?: { name?: string; state?: string }; sending_dns_records?: { valid?: string }[] };
      verified = result.domain?.name?.toLowerCase() === domain && result.domain?.state === 'active'
        && Boolean(result.sending_dns_records?.length) && result.sending_dns_records!.every(record => record.valid === 'valid');
    } else if (options.provider === 'sendgrid') {
      const limit = 100;
      const seen = new Set<string>();
      for (let offset = 0; !verified;) {
        // Search narrows the list; match exactly and read until its last page:
        // https://www.twilio.com/docs/sendgrid/api-reference/domain-authentication/list-all-authenticated-domains
        const rows = await read(`https://api.sendgrid.com/v3/whitelabel/domains?domain=${encodeURIComponent(domain ?? '')}&limit=${limit}&offset=${offset}`);
        if (!Array.isArray(rows)) throw new Error('Provider returned an invalid domain page.');
        const fingerprint = JSON.stringify(rows);
        if (seen.has(fingerprint)) throw new Error('Provider returned a repeated domain page.');
        seen.add(fingerprint);
        const matches = (rows as SendGridDomain[]).filter(row => typeof row?.domain === 'string' && row.domain.toLowerCase() === domain);
        sendGridMatches.push(...matches);
        verified = matches.some(row => row.valid === true);
        if (rows.length === 0) break;
        offset += rows.length;
      }
    } else {
      let after: string | undefined;
      const seen = new Set<string>();
      do {
        const result = await read(`https://api.resend.com/domains?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`) as { data?: { id: string; name: string; status: string }[]; has_more?: boolean };
        if (!Array.isArray(result.data)) break;
        verified = result.data.some(row => row.name?.toLowerCase() === domain && row.status === 'verified');
        const next = result.has_more ? result.data.at(-1)?.id : undefined;
        if (next && seen.has(next)) throw new Error('Provider returned a repeated domain cursor.');
        if (next) seen.add(next);
        after = next;
      } while (!verified && after);
    }
  } catch {
    throw new Error('The mail check could not read provider domain authentication. Check the provider and the key’s domain-read permission, then try again.');
  }
  if (!verified) throw new Error(options.provider === 'sendgrid'
    ? sendGridAuthenticationError(domain ?? '', sendGridMatches)
    : 'The provider has not verified this sender domain. Complete domain authentication with your mail provider, then check again.');
  return SENDER_VERIFIED;
}
