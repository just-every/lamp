import { useEffect, useRef, useState } from 'react';
import { appApi, useAppData } from '../../../app/client/ui/api';
import { leaveWhenSaved, useLeaveGuard } from '../../../app/client/ui/leave-guard';
import { SettingsSaveState } from './settings-save-state';

type Settings = { settings: { multiple: number } };
export function TrafficAlertSettings() {
  const data = useAppData<Settings>('/api/app/traffic-alerts');
  const [value, setValue] = useState<string | null>(null);
  const [phase, setPhase] = useState<'saved' | 'waiting' | 'saving' | 'error'>('saved');
  const [error, setError] = useState<string | null>(null);
  const queue = useRef({ value: '', revision: 0, completed: 0, stopped: -1, leaving: 0, released: false, answered: new Set<() => void>(), sending: false, timer: undefined as ReturnType<typeof setTimeout> | undefined });
  async function flush() {
    const q = queue.current;
    clearTimeout(q.timer);
    if (q.sending || q.completed === q.revision) return;
    q.sending = true;
    try {
      while (q.completed !== q.revision && q.stopped !== q.revision) {
        const revision = q.revision, multiple = Number(q.value);
        try {
          if (!q.value || !Number.isFinite(multiple) || multiple < 1.1 || multiple > 100) throw new Error('Choose a multiple from 1.1 to 100.');
          setPhase('saving'); setError(null);
          await appApi<Settings>('/api/app/traffic-alerts', { method: 'PUT', body: JSON.stringify({ multiple }), keepalive: true });
          q.completed = revision;
          if (q.revision === revision) { setPhase('saved'); data.refresh(); }
        } catch (cause) {
          q.stopped = revision;
          if (q.revision === revision) { setPhase('error'); setError(cause instanceof Error ? cause.message : 'Traffic alerts could not be saved.'); }
        }
        for (const answer of [...q.answered]) answer();
      }
    } finally { q.sending = false; }
  }
  useEffect(() => () => { clearTimeout(queue.current.timer); void flush(); }, []);
  useLeaveGuard(() => leaveWhenSaved(queue.current, () => void flush(), 'Traffic alert changes have not saved. Leave them behind?'), () => queue.current.completed !== queue.current.revision && !queue.current.released);
  function edit(next: string) {
    const q = queue.current;
    q.value = next; q.revision++; q.released = false;
    setValue(next); setPhase('waiting'); setError(null);
    clearTimeout(q.timer); q.timer = setTimeout(() => void flush(), 500);
  }
  return <section className="data-card" aria-labelledby="traffic-alert-title">
    <p className="card-kicker" id="traffic-alert-title">Traffic alerts</p>
    {data.data ? <>
      <label className="form-label">Traffic spike multiple<input aria-label="Traffic spike multiple" type="number" min="1.1" max="100" step="0.1" value={value ?? String(data.data.settings.multiple)} onChange={event => edit(event.target.value)} onBlur={() => void flush()} /></label>
      {phase !== 'saved' && <SettingsSaveState phase={phase} error={error} retry={() => { queue.current.stopped = -1; void flush(); }} />}
    </> : <p role="status">{data.error ?? 'Loading traffic alerts…'}</p>}
  </section>;
}
