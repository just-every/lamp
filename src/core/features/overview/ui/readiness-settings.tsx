import { useState } from 'react';
import { Button } from '../../../app/client/ui/button';
import { appApi, useAppData } from '../../../app/client/ui/api';

export function ReadinessSettings() {
  const readiness = useAppData<{ overview: { checklist: { publicOrigin: string; steps: { id: string; detail: string }[] } } }>('/api/app/overview');
  const publicOrigin = readiness.data?.overview.checklist.publicOrigin ?? null;
  const senderDetail = readiness.data?.overview.checklist.steps.find(step => step.id === 'sender')?.detail;
  const localAddress = publicOrigin ? ['localhost', '127.0.0.1', '[::1]'].includes(new URL(publicOrigin).hostname) : false;
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(action: string) {
    setBusy(true); setMessage(null);
    try {
      const result = await appApi<{ message: string }>(`/api/app/overview/${action}`, { method: 'POST', body: '{}' });
      setMessage(result.message);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The setup check could not be completed.'); }
    finally { setBusy(false); }
  }
  return <section className="data-card">
    <h2 id="sender-check">Check your sender</h2><p>Save your From email first. {senderDetail}</p>
    <Button type="button" disabled={busy} onClick={() => run('check-sender')}>Check mail sender</Button>
    <h2 id="public-address">Your public address</h2>{readiness.error && <p role="alert">{readiness.error}</p>}<p style={{ overflowWrap: 'anywhere' }}>{publicOrigin}</p>{publicOrigin && <p>{localAddress ? 'This address is available only on this computer. Deploy Lamp to give your customers a public address.' : 'Your deployment address is a valid choice. A custom domain is optional; only Cloudflare-managed DNS is supported.'}</p>}
    <p><a className="text-link" style={{ minHeight: 24 }} href="https://github.com/just-every/run-lamp/blob/main/README.md#your-own-domain" target="_blank" rel="noreferrer">Read the custom domain guide</a></p>
    <Button type="button" variant="secondary" disabled={busy || !publicOrigin} onClick={() => run('accept-address')}>Use this public address</Button>
    <p>This records your address choice; it does not validate custom DNS.</p>{message && <p role="status">{message}</p>}
    <a className="text-link" style={{ minHeight: 24 }} href="/app">Return to setup checklist</a>
  </section>;
}
