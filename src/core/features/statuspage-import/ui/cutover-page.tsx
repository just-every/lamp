import { useEffect, useRef, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { appApi, useAppData } from '../../../app/client/ui/api';
import { Button } from '../../../app/client/ui/button';
import { FormError } from '../../../app/client/ui/states';
import type { CutoverPreview } from '../cutover';
import { HELD_SORRY_DAYS } from '../held-sorry';
import { statuspageOperatingNotes } from '../operating-notes';
import { readCutoverDraft } from './cutover-draft';

type Job = { id: string; state: string };
type Result = { job: Job; report: { cutover: CutoverPreview }; invites: { sent: number; remaining: number } };
const operatorRoute = getRouteApi('/app');
const domainGuide = '/docs/domains';

function AddressCheck({ row, origin }: { row: CutoverPreview['rows'][number]; origin: string | null }) {
  const [state, setState] = useState('Not checked');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setState('Not checked'); setBusy(false);
    return () => { generation.current += 1; controller.current?.abort(); };
  }, [origin, row.path, row.target]);
  async function check() {
    if (!origin) return;
    const request = ++generation.current;
    controller.current?.abort();
    const cancellation = new AbortController();
    controller.current = cancellation;
    setBusy(true); setState('Checking…');
    try {
      const response = await fetch(new URL(row.path, origin), { method: 'GET', credentials: 'omit', redirect: 'follow', mode: 'cors', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(12000)]) });
      const expected = new URL(row.target, origin).href;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.redirected || response.url !== expected || !response.headers.get('content-type')?.includes('text/html')) throw new Error(`Returned ${response.url}; expected a redirect to ${expected}`);
      if (request === generation.current) setState('Opens');
    } catch (cause) { if (request === generation.current) setState(`Could not verify: ${cause instanceof Error ? cause.message : 'request failed'}. Check the host, connection and browser access.`); }
    finally { if (request === generation.current) setBusy(false); }
  }
  return <tr><th scope="row"><span>{row.address}</span>{row.address !== row.path && <small>Path on selected host: {row.path}. On a moved hostname, old bookmarks keep this path; provider-owned shortlink hosts need their existing redirect kept or links updated.</small>}</th><td>{origin ? <a href={new URL(row.target, origin).href} target="_blank" rel="noreferrer">{row.target}</a> : row.target}</td><td><Button type="button" variant="secondary" disabled={!origin || busy} onClick={check}>Check opens</Button><p role="status">{state}</p></td></tr>;
}

export function CutoverPage() {
  const jobs = useAppData<{ jobs: Job[] }>('/api/app/statuspage-import/jobs');
  const publicOrigin = operatorRoute.useLoaderData().publicPageOrigin;
  const [jobId, setJobId] = useState('');
  const [draft, setDraft] = useState<CutoverPreview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [address, setAddress] = useState(publicOrigin);
  const [cutoverConfirmed, setCutoverConfirmed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setDraft(readCutoverDraft());
    setJobId(new URLSearchParams(window.location.search).get('job') ?? '');
  }, []);
  useEffect(() => {
    if (!jobId) { setResult(null); return; }
    let cancelled = false;
    setResult(null); setError(null);
    void appApi<Result>(`/api/app/statuspage-import/jobs/${encodeURIComponent(jobId)}`).then(value => { if (!cancelled) setResult(value); }).catch(cause => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [jobId]);
  const preview = jobId ? result?.report.cutover : draft;
  function selectAddress() {
    setError(null);
    try {
      const url = new URL(address);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Enter a public origin such as https://status.example.com, without a path or credentials.');
      setSelected(url.origin); setCutoverConfirmed(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Choose a valid public address.'); }
  }
  async function invite() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const next = await appApi<Result>(`/api/app/statuspage-import/jobs/${encodeURIComponent(jobId)}/send-invitations`, { method: 'POST', body: JSON.stringify(preview?.afterCutover ? { liveOrigin: selected, hostnameLive: cutoverConfirmed, watchWindowClosed: cutoverConfirmed } : {}) });
      setResult(next);
      setMessage(`${next.invites.sent} invitation(s) handed to the mail transport in this batch. ${next.invites.remaining} eligible invitation(s) remain. This does not establish inbox delivery.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invitations could not be sent.');
      // A claimed send may have reached the transport even if the action failed.
      // Re-read the ledger; never resend automatically.
      try { setResult(await appApi<Result>(`/api/app/statuspage-import/jobs/${encodeURIComponent(jobId)}`)); } catch { /* The original error remains visible if authority was revoked. */ }
    }
    finally { setBusy(false); }
  }
  return <div className="page-stack move-in-page cutover-page">
    <section className="page-title-row"><div><p className="eyebrow">Settings</p><h1>Cutover</h1><p>Review old links and subscriptions before moving your public hostname.</p><a className="text-link" href="/app/move-in">Move in</a></div></section>
    <section className="data-card"><label className="form-label">Preview<select value={jobId} disabled={busy} onChange={event => { setJobId(event.target.value); setMessage(null); }}><option value="">Latest dry run in this tab</option>{jobs.data?.jobs.map(job => <option key={job.id} value={job.id}>{job.id.slice(0, 12)} · {job.state}</option>)}</select></label>{jobs.error && <FormError>{jobs.error}</FormError>}
      {!preview && <p>{jobId ? 'Loading import preview…' : 'Run a dry run in Move in, or select an import.'}</p>}
    </section>
    {error && <FormError>{error}</FormError>}
    {preview && <>
      <section className="data-card"><h2>Old public addresses</h2><p>{jobId ? 'Surviving imported records' : 'Proposed destinations: import the reviewed dry run before checking'}. Showing {preview.rows.length} of {preview.total} old incident and maintenance addresses.</p>
        <label className="form-label">Public address<input type="url" value={address} onChange={event => { setAddress(event.target.value); setSelected(null); }} /></label><Button type="button" variant="secondary" onClick={selectAddress}>Use this address for checks</Button>
        <p>Choosing an address does not validate DNS. Checks run in your browser without credentials, follow the redirect and verify its final address. A network or browser access failure is not proof that a link works.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Old public addresses"><table><thead><tr><th scope="col">Old address</th><th scope="col">Lamp address</th><th scope="col">Live check</th></tr></thead><tbody>{preview.rows.map(row => <AddressCheck key={`${row.path}:${row.target}`} row={row} origin={selected} />)}</tbody></table></div>
        {!!preview.unavailable.length && <details><summary>{preview.unavailable.length} unavailable address notice(s)</summary><ul>{preview.unavailable.map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
        <p>Only retained source addresses are listed. Missing shortlinks are unavailable; unsafe or conflicting paths are refused or reported unavailable. Lamp controls paths on the hostname you move, not a source-owned shortlink hostname.</p>
      </section>
      <section className="data-card"><h2>Feeds and other readers</h2><p>RSS is available at <code>/feed.rss</code> and <code>/history.rss</code> on every Lamp installation.</p><p>{preview.source === "sorry" ? "Sorry" : preview.source === "instatus" ? "Instatus" : preview.source === "betterstack" ? "Better Stack" : "Statuspage"}</p><ul>{preview.feeds.map(path => <li key={path}><code>{path}</code> answers with Lamp’s Atom feed after import, also available at <code>/feed.atom</code>.</li>)}</ul>{(preview.readerGaps ?? []).map(gap => <p key={gap}>{gap}</p>)}{preview.source === "statuspage" ? <p>Existing Statuspage <code>/embed/script.js</code> tags serve Lamp’s floating notice on the moved hostname. Configure the embedding site’s allowed origin in Settings.</p> : <p>Existing source widgets are not served by Lamp and will keep calling the old provider or fail after its removal. Replace them with Lamp’s <code>/widget.js</code> and configure allowed widget origins in Settings.</p>}</section>
      {(preview.source ?? "statuspage") === "statuspage" && <section className="data-card" aria-labelledby="operating-after-statuspage"><h2 id="operating-after-statuspage">Operating Lamp after Statuspage</h2><ul>{statuspageOperatingNotes.map(note => <li key={note}>{note}</li>)}</ul></section>}
      <section className="data-card"><h2>Confirmation invitations</h2><p>{preview.invitations.eligible} pending email subscriber(s) eligible for one invitation{!jobId ? ' after import' : ''}. {preview.invitations.claimed} pending invitation(s) already claimed for sending. {preview.invitations.expired} pending subscription(s) expired.</p><p>{preview.afterCutover ? `Imported subscribers stay held, with no mail, until you approve the live hostname after the watch window. Release starts their 72-hour confirmation window. Held subscribers you have not released ${HELD_SORRY_DAYS} days after the import’s review time are deleted with their addresses, as undoing the import would. Undo cannot recall sent mail.` : "Pending subscriptions expire 72 hours from the import’s review time, whether or not you send. Sending later gives only the remaining time; expired subscriptions cannot be invited. The expiry job deletes unconfirmed addresses."}</p>{preview.invitations.heldUntil && <p>Release by{jobId ? ' (earliest held subscriber)' : ''}: <time dateTime={preview.invitations.heldUntil}>{preview.invitations.heldUntil}</time>.</p>}{preview.invitations.deadline && <p>Confirmation deadline{jobId ? ' (earliest pending subscription)' : ''}: <time dateTime={preview.invitations.deadline}>{preview.invitations.deadline}</time>.</p>}{preview.afterCutover && <label className="checkbox-label"><input type="checkbox" checked={cutoverConfirmed} disabled={!selected} onChange={event => setCutoverConfirmed(event.target.checked)} /> The selected hostname {selected ?? "(choose the live public address above)"} is live on Lamp and the watch window has closed. Release these held subscribers and send their confirmation invitations.</label>}<Button type="button" disabled={(preview.afterCutover && (!selected || !cutoverConfirmed)) || busy || result?.job.state !== 'completed' || !preview.invitations.eligible} onClick={invite}>{busy ? 'Sending…' : 'Send invitations'}</Button><p>Only this action sends mail, in batches. Repeat for remaining eligible subscribers. A claimed send is never retried automatically, including after an interrupted or uncertain transport result. No inbox delivery is claimed.</p>{message && <p role="status">{message}</p>}</section>
    </>}
    <section className="data-card"><h2>Switch in this order</h2><ol><li>Import the reviewed dry run in <a href="/app/move-in">Move in</a>.</li><li>Read this preview, including unavailable addresses and reader gaps.</li>{!preview?.afterCutover && <li>Send invitations while the confirmation window is open.</li>}<li>Point your hostname to Lamp using the <a href={domainGuide} target="_blank" rel="noreferrer">custom domain guide</a>, or keep your default deployment address. Save your hostname in <a href="/app/settings#public-address">Settings</a>.</li><li>Select the public address here and check the table again after the switch.</li>{preview?.afterCutover && <li>After the hostname is live and the watch window closes, select that hostname above and explicitly release the held subscribers with Send invitations.</li>}<li>Keep the old page available through the confirmation deadline. Update source-owned links, feeds and widgets before retiring it.</li></ol></section>
  </div>;
}
