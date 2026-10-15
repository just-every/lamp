import { useState, type FormEvent } from 'react';
import type { SetupChecklist as Checklist, SetupStep } from '../setup-checklist';
import { appApi } from '../../../app/client/ui/api';
import { Button } from '../../../app/client/ui/button';

export function SetupChecklist({ checklist, refresh }: { checklist: Checklist; refresh: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  async function openPublic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    // Open synchronously while the click still grants popup permission. Only
    // the authenticated server check may supply the destination and evidence.
    const page = window.open('about:blank', '_blank');
    if (!page) { setMessage('Allow a new tab to open, then check the public page again.'); return; }
    page.opener = null;
    setChecking(true);
    try {
      const { url } = await appApi<{ url: string }>('/api/app/overview/open-public', { method: 'POST', body: '{}' });
      if (!page.closed) page.location.replace(url);
      refresh();
    } catch (cause) {
      page.close();
      setMessage(cause instanceof Error ? cause.message : 'The public page could not be opened.');
    } finally { setChecking(false); }
  }
  async function checkSubscribe() {
    setChecking(true); setMessage(null);
    try {
      const result = await appApi<{ message: string }>('/api/app/overview/check-subscribe', { method: 'POST', body: '{}' });
      setMessage(result.message); refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The form could not be checked.'); }
    finally { setChecking(false); }
  }
  function action(step: SetupStep) {
    if (step.id === 'public') return <form action={step.href} method="post" target="_blank" onSubmit={openPublic}><Button type="submit" variant="secondary" disabled={checking}>Open public page</Button></form>;
    if (step.id === 'subscribe') return <Button type="button" variant="secondary" onClick={checkSubscribe} disabled={checking}>{checking ? 'Checking…' : 'Check subscribe form'}</Button>;
    const label = ({ branding: 'Edit page branding', timezone: 'Choose time zone', sender: 'Check mail sender', component: 'Manage components', incident: 'Manage incidents', domain: 'Choose public address' } as Record<string, string>)[step.id];
    return <a className="text-link" href={step.href}>{label}</a>;
  }
  const content = <><p>{checklist.completed} of {checklist.steps.length} complete. Each step reflects your saved settings or a server check.</p><ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
    {checklist.steps.map(step => <li key={step.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--border, #ddd)' }} data-setup-step={step.id} data-complete={step.done}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}><strong>{step.label}</strong><span>{step.done ? 'Done' : 'To do'}</span></div>
      <p>{step.detail}</p>{action(step)}
    </li>)}
  </ol>{message && <p role="status">{message}</p>}</>;
  return checklist.complete
    ? <details className="data-card" aria-label="Setup checklist"><summary>Setup complete · {checklist.completed} of {checklist.steps.length}</summary>{content}</details>
    : <section className="data-card" aria-label="Setup checklist"><h2>Set up your status page</h2>{content}</section>;
}
