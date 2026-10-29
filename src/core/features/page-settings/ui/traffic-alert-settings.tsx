import { useEffect, useRef, useState } from 'react';
import { appApi, useAppData } from '../../../app/client/ui/api';
import { Button } from '../../../app/client/ui/button';
import { leaveWhenSaved, useLeaveGuard } from '../../../app/client/ui/leave-guard';
import { saveFailureReason, useReportSave, type CardSave, type SavePhase } from './settings-save-state';

type Settings = { settings: { multiple: number } };
const outOfRange = 'Choose a multiple from 1.1 to 100.';
const valid = (value: string) => value !== '' && Number(value) >= 1.1 && Number(value) <= 100;

/** The multiple saves on its own, so its state, failure and Retry join the tabs' one save note through `onSave`. */
export function TrafficAlertSettings({ onSave }: { onSave: (save: CardSave) => void }) {
  const data = useAppData<Settings>('/api/app/traffic-alerts');
  const [value, setValue] = useState<string | null>(null);
  const [phase, setPhase] = useState<SavePhase>('saved');
  const [error, setError] = useState<string | null>(null);
  const queue = useRef({ value: '', revision: 0, completed: 0, stopped: -1, leaving: 0, released: false, answered: new Set<() => void>(), sending: false, sentOnUnload: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined });
  useReportSave(onSave, phase, error, retry);
  async function flush(unloading = false) {
    const q = queue.current;
    clearTimeout(q.timer);
    if (q.sending || q.completed === q.revision) return;
    q.sending = true;
    try {
      while (q.completed !== q.revision && q.stopped !== q.revision) {
        const revision = q.revision;
        try {
          if (!valid(q.value)) throw new Error(outOfRange);
          setPhase('saving'); setError(null);
          // Only a write sent as the page unloads needs keepalive; ordinary writes and Retry are plain requests.
          await appApi<Settings>('/api/app/traffic-alerts', { method: 'PUT', body: JSON.stringify({ multiple: Number(q.value) }), keepalive: unloading });
          q.completed = revision;
          if (q.revision === revision) { setPhase('saved'); data.refresh(); }
        } catch (cause) {
          q.stopped = revision;
          if (q.revision === revision) { setPhase('error'); setError(`Traffic alerts could not be saved: ${cause instanceof Error && cause.message === outOfRange ? outOfRange : saveFailureReason(cause)} Your change is kept here.`); }
        }
        for (const answer of [...q.answered]) answer();
      }
    } finally { q.sending = false; }
  }
  /** Reloading or closing the tab sends the newest valid edit now, past any write still waiting for its answer. */
  function flushOnUnload() {
    const q = queue.current;
    if (q.completed === q.revision || q.stopped === q.revision || q.sentOnUnload === q.revision || !valid(q.value)) return;
    q.sentOnUnload = q.revision;
    if (!q.sending) { void flush(true); return; }
    void appApi('/api/app/traffic-alerts', { method: 'PUT', body: JSON.stringify({ multiple: Number(q.value) }), keepalive: true }).catch(() => undefined);
  }
  useEffect(() => {
    window.addEventListener('beforeunload', flushOnUnload);
    window.addEventListener('pagehide', flushOnUnload);
    return () => {
      window.removeEventListener('beforeunload', flushOnUnload);
      window.removeEventListener('pagehide', flushOnUnload);
      clearTimeout(queue.current.timer); void flush();
    };
  }, []);
  useLeaveGuard(() => leaveWhenSaved(queue.current, () => void flush(), 'Traffic alert changes have not saved. Leave them behind?'), () => queue.current.completed !== queue.current.revision && !queue.current.released);
  function retry() { queue.current.stopped = -1; void flush(); }
  function edit(next: string) {
    const q = queue.current;
    q.value = next; q.revision++; q.released = false;
    setValue(next); setPhase('waiting'); setError(null);
    clearTimeout(q.timer); q.timer = setTimeout(() => void flush(), 500);
  }
  return <section className="data-card" aria-labelledby="traffic-alert-title">
    <p className="card-kicker" id="traffic-alert-title">Traffic alerts</p>
    {data.data ? <>
      <label className="form-label">Traffic spike multiple<input aria-label="Traffic spike multiple" aria-invalid={(phase === 'error' && value !== null && !valid(value)) || undefined} aria-describedby={error ? 'traffic-alert-error' : undefined} type="number" min="1.1" max="100" step="0.1" value={value ?? String(data.data.settings.multiple)} onChange={event => edit(event.target.value)} onBlur={() => void flush()} /><small>Alert operators when public-page traffic reaches this many times its usual level.</small></label>
      {error && <p className="save-message" id="traffic-alert-error" role="alert">{error} <Button type="button" variant="secondary" className="table-action" onClick={retry}>Retry</Button></p>}
    </> : <p role="status">{data.error ?? 'Loading traffic alerts…'}</p>}
  </section>;
}
