import { useEffect, useState } from 'react';
import { Button } from '../../../app/client/ui/button';
type Link = { id: string; transport: string; tenant: string; subject: string };
/** Private operator identities linked from Settings → Slack and Teams. */
export function ChatLinksPanel() {
  const [links, setLinks] = useState<Link[]>([]), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function request<T = unknown>(path: string, method = 'GET'): Promise<T> {
    const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(result && typeof result === 'object' && 'error' in result ? String(result.error) : 'Chat links could not be updated.');
    return result as T;
  }
  const refresh = async () => setLinks((await request<{ links: Link[] }>('/api/app/chat-links')).links);
  useEffect(() => { void refresh().catch(cause => setError(cause.message)); }, []);
  async function act(operation: () => Promise<void>) {
    setBusy(true); setError('');
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chat links could not be updated.'); }
    finally { setBusy(false); }
  }
  return <section className="data-card chat-links-card" aria-labelledby="chat-links-title">
    <h2 id="chat-links-title">Chat links</h2>
    <p>Create a code and send it privately to the Lamp app in Slack or Teams. It expires after ten minutes and works once.</p>
    <Button variant="secondary" type="button" disabled={busy} onClick={() => void act(async () => setCode((await request<{ code: string }>('/api/app/chat-links', 'POST')).code))}>Create link code</Button>
    {code && <div role="status"><p>Slack: <code>/lamp link {code}</code></p><p>Teams: <code>link {code}</code></p><Button variant="secondary" type="button" onClick={() => setCode('')}>Hide link code</Button></div>}
    <Button variant="secondary" type="button" disabled={busy} onClick={() => void act(refresh)}>Refresh chat links</Button>
    {!links.length && <p>No chat identities linked.</p>}
    <ul className="channel-list">{links.map(link => <li key={link.id}><span>{link.transport === 'slack' ? 'Slack' : 'Teams'}: {link.subject} ({link.tenant})</span> <Button variant="secondary" type="button" disabled={busy} onClick={() => void act(async () => { await request(`/api/app/chat-links/${link.id}`, 'DELETE'); await refresh(); })}>Remove chat link</Button></li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </section>;
}
