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

/** Read provider authentication status, never infer verification from a saved
 * address. Local mode exercises the actual capture transport instead. */
export async function checkSender(from: string, operatorEmail: string, options: SenderCheckOptions): Promise<string> {
  if (!options.mail.configured) throw new Error('Configure your mail sender before checking it.');
  if (options.local) {
    const result = await options.mail.send({ from, to: operatorEmail, subject: 'Lamp local sender check', text: 'The local development outbox is ready. No email provider was contacted.', headers: { 'Auto-Submitted': 'auto-generated' }, idempotencyKey: `setup-sender/${createUlid()}` });
    if (result.disposition !== 'captured') throw new Error('The local outbox did not confirm a capture.');
    return 'Local outbox ready. A check message was captured; no email was delivered.';
  }
  if (!options.apiKey || !['sendgrid', 'resend'].includes(options.provider)) throw new Error('This sender needs a supported provider credential for the verification check.');
  const domain = from.split('@')[1]?.toLowerCase();
  const fetcher = options.fetcher ?? fetch;
  const signal = AbortSignal.timeout(8000);
  let pages = 0;
  async function read(url: string) {
    if (++pages > 100 || signal.aborted) throw new Error('Provider domain listing did not complete.');
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${options.apiKey}` }, redirect: 'error', signal });
    if (!response.ok) throw new Error('The mail check could not read provider domain authentication. Give the configured key read access to domains and check again.');
    return response.json() as Promise<unknown>;
  }
  let verified = false;
  try {
    if (options.provider === 'sendgrid') {
      const limit = 100;
      const seen = new Set<string>();
      for (let offset = 0; !verified; offset += limit) {
        const rows = await read(`https://api.sendgrid.com/v3/whitelabel/domains?domain=${encodeURIComponent(domain ?? '')}&limit=${limit}&offset=${offset}`);
        if (!Array.isArray(rows)) throw new Error('Provider returned an invalid domain page.');
        const fingerprint = JSON.stringify(rows);
        if (seen.has(fingerprint)) throw new Error('Provider returned a repeated domain page.');
        seen.add(fingerprint);
        verified = rows.some(row => row.domain?.toLowerCase() === domain && row.valid === true);
        if (rows.length < limit) break;
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
  if (!verified) throw new Error('The provider has not verified this sender domain. Complete domain authentication with your mail provider, then check again.');
  return 'Sender domain verified by your mail provider. This checks authentication, not inbox delivery.';
}
