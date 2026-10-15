import type { MailSender } from '../../platform/mail';
import { createUlid } from '../../shared/ids';
import { hashOpaqueToken } from '../../platform/security/opaque-tokens';

export interface SenderCheckOptions {
  local: boolean;
  provider: string;
  apiKey?: string;
  mail: MailSender;
  fetcher?: typeof fetch;
}
export async function senderEvidenceKey(from: string, options: SenderCheckOptions) {
  return hashOpaqueToken(JSON.stringify([from, options.local ? 'local' : options.provider, options.local ? '' : options.apiKey ?? '']));
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
 * address. Local mode completes the send without retaining mail. */
export async function checkSender(from: string, operatorEmail: string, options: SenderCheckOptions): Promise<string> {
  if (!options.mail.configured) throw new Error('Configure your mail sender before checking it.');
  if (options.local) {
    await options.mail.send({ from, to: operatorEmail, subject: 'Lamp sender check', text: 'Lamp sender check.', headers: { 'Auto-Submitted': 'auto-generated' }, idempotencyKey: `setup-sender/${createUlid()}` });
    return 'Sender check complete.';
  }
  if (!options.apiKey || !['sendgrid', 'resend'].includes(options.provider)) throw new Error('This sender needs a supported provider credential for the verification check.');
  const domain = from.split('@')[1]?.toLowerCase();
  const fetcher = options.fetcher ?? fetch;
  let pages = 0;
  const deadline = Date.now() + 8000;
  const signal = AbortSignal.timeout(8000);
  async function read(url: string) {
    if (Date.now() >= deadline || signal.aborted || (options.provider !== 'sendgrid' && ++pages > 100)) throw new Error('Provider domain listing did not complete.');
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${options.apiKey}` }, redirect: 'error', signal });
    if (!response.ok) throw new Error('The mail check could not read provider domain authentication. Give the configured key read access to domains and check again.');
    return response.json() as Promise<unknown>;
  }
  let verified = false;
  const sendGridMatches: SendGridDomain[] = [];
  try {
    if (options.provider === 'sendgrid') {
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
  return 'Sender domain verified by your mail provider. This checks authentication, not inbox delivery.';
}
