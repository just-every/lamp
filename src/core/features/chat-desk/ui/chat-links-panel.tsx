import { useEffect, useState } from 'react';
type Link = { id: string; transport: string; tenant: string; subject: string };
/** Ready for the Settings owner to mount; no existing screen imports this panel. */
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
  return <section aria-labelledby="chat-links-title">
    <h2 id="chat-links-title">Chat links</h2>
    <p>Create a code and send it privately to the Lamp app in Slack or Teams. It expires after ten minutes and works once.</p>
    <button type="button" disabled={busy} onClick={() => void act(async () => setCode((await request<{ code: string }>('/api/app/chat-links', 'POST')).code))}>Create link code</button>
    {code && <div role="status"><p>Slack: <code>/lamp link {code}</code></p><p>Teams: <code>link {code}</code></p><button type="button" onClick={() => setCode('')}>Hide link code</button></div>}
    <button type="button" disabled={busy} onClick={() => void act(refresh)}>Refresh chat links</button>
    <ul>{links.map(link => <li key={link.id}>{link.transport}: {link.subject} ({link.tenant}) <button type="button" disabled={busy} onClick={() => void act(async () => { await request(`/api/app/chat-links/${link.id}`, 'DELETE'); await refresh(); })}>Remove chat link</button></li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </section>;
}
