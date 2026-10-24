import { rememberCutover, clearCutover } from "./cutover-draft";
import { AccountHelp, PageFinder, SavedResponsesHelp } from "./source-help";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { EmptyState } from "../../../app/client/ui/lit-states";
import { FormError } from "../../../app/client/ui/states";
import type { MoveInReport } from "../planning";
import { HELD_SORRY_DAYS } from "../held-sorry";
import { moveInDoor } from "./door-client";
import type { WebsiteRecord } from "../../website/repository";

type SavedFile = { name: string; text: string };
type Preview = { report: MoveInReport; jobId?: string; files?: SavedFile[]; planId: string; fingerprint: string };
/** A door import carries its plan; an import from before the door has none. */
type DoorPlan = { planId?: string | null; fingerprint?: string | null; namespace?: string };
type Job = DoorPlan & { approvalCaption?: string; id: string; state: string; checkpoint: number; total: number };
type Result = { job: Job; door: DoorPlan | null; report: MoveInReport; invites: { sent: number; remaining: number }; undo?: { dispositions: Array<{ disposition: string; targetKind?: string; reason?: string }>; expiredSubscribers: number } };

const kindLabels: Record<string, string> = { group: "Component groups", component: "Components", incident: "Incidents", maintenance: "Maintenance", subscriber: "Subscribers", postmortem: "Postmortems", template: "Incident templates" };

function ReportTable({ report }: { report: MoveInReport }) {
  return <>{report.limits.length ? <div role="status"><ul>{report.limits.map(summary=><li key={summary}>{summary}</li>)}</ul><p>Leave out subscriber channels or excess subscriber rows and run a fresh dry run.</p></div> : null}{report.unavailableAddresses?.length > 0 && <div role="status"><p>Some old public addresses are unavailable:</p><ul>{report.unavailableAddresses.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}<div className="table-scroll" tabIndex={0} role="region" aria-label="Move-in counts"><table><thead><tr><th scope="col">Records</th><th scope="col">Read</th><th scope="col">Imported</th><th scope="col">Kept private</th><th scope="col">Changed</th><th scope="col">Skipped</th><th scope="col">Refused</th></tr></thead><tbody>{Object.entries(report.counts).map(([kind, count]) => <tr key={kind}><th scope="row">{kindLabels[kind] ?? kind}</th><td>{count.read}</td><td>{count.imported}</td><td>{count["kept-private"] ?? 0}</td><td>{count.changed}</td><td>{count.skipped}</td><td>{count.rejected}</td></tr>)}</tbody></table></div></>;
}

function ReportItems({ report }: { report: MoveInReport }) {
  const notable = report.items.filter((item) => item.outcome !== "imported");
  if (!notable.length) return <p>Every record carries over unchanged.</p>;
  return <details><summary>{notable.length} record{notable.length === 1 ? "" : "s"} changed, kept private, skipped or refused</summary><ul className="move-in-items">{notable.map((item) => <li key={`${item.kind}:${item.sourceId}`}><strong>{item.name}</strong> ({item.outcome}): {item.reason}</li>)}</ul></details>;
}

/** Settings → Move in: a dry run first, then the import, then undo. */
export function MoveInPage() {
  const jobs = useAppData<{ jobs: Job[] }>("/api/app/statuspage-import/jobs");
  const website = useAppData<{ website: WebsiteRecord | null }>("/api/app/website");
  const [source, setSource] = useState<"statuspage" | "betterstack" | "instatus" | "sorry">(website.data?.website?.statusPage?.source ?? "statuspage");
  const sourceLabel = source === "sorry" ? "Sorry" : source === "instatus" ? "Instatus" : source === "betterstack" ? "Better Stack" : "Statuspage";
  const [publicAccessAcknowledged, setPublicAccessAcknowledged] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [pageId, setPageId] = useState(website.data?.website?.statusPage?.pageId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [files, setFiles] = useState<SavedFile[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const detected = website.data?.website?.statusPage;
  const detectionApplied = useRef(false);

  useEffect(() => {
    if (!website.data || detectionApplied.current) return;
    detectionApplied.current = true;
    if (!detected) return;
    if (detected.source) setSource(detected.source);
    if (detected.pageId) setPageId(detected.pageId);
    if (detected.source === "sorry") setPublicUrl(detected.url);
  }, [website.data, detected]);

  useEffect(() => {
    // History can restore the native selection without our in-memory source.
    // A fresh mount must let the owner select those same files again.
    if (fileInput.current) fileInput.current.value = "";
    // A native select can change before React attaches its change handler.
    // Keep the displayed provider and the submitted source in the same state.
    setHydrated(true);
  }, []);

  async function run<T>(work: () => Promise<T>, done: (value: T) => void) {
    setBusy(true); setError(null);
    try { done(await work()); jobs.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The move-in could not continue."); }
    finally { setBusy(false); }
  }

  async function chooseFiles(list: FileList | null) {
    setPreview(null); setResult(null);
    setFiles(await Promise.all([...(list ?? [])].map(async (file) => ({ name: file.name, text: await file.text() }))));
  }

  function dryRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setResult(null); setAcknowledged(false);
    void run(async (): Promise<Preview> => {
      // A key or public page is read once, into saved responses; the import door plans those.
      const fetched = files.length ? null : (await appApi<{ files: SavedFile[] }>("/api/app/statuspage-import/fetch", { method: "POST", body: JSON.stringify({ source, publicAccessAcknowledged, pageId, ...(source === "sorry" && publicUrl ? { publicUrl } : {}), apiKey }) })).files;
      const planned = await moveInDoor(source).plan<Omit<Preview, "files">>({ source, files: fetched ?? files, pageId, publicAccessAcknowledged, ...(source === "sorry" && publicUrl ? { publicUrl } : {}) });
      return { ...planned, ...(fetched ? { files: fetched } : {}) };
    }, (next) => {
      setPreview(next); rememberCutover(next.report.cutover); setApiKey("");
      if (next.files) setFiles(next.files);
    });
  }

  const read = (id: string) => appApi<Result>(`/api/app/statuspage-import/jobs/${encodeURIComponent(id)}`);
  function apply() {
    if (!preview) return;
    void run(async () => read((await moveInDoor(source).apply(preview.planId, preview.fingerprint)).id), setResult);
  }

  /** A door import continues and undoes through the door; one from before it, through its own job. */
  const act = (job: DoorPlan & { id: string }, action: "resume" | "undo") => run(async () => {
    if (!job.planId) return appApi<Result>(`/api/app/statuspage-import/jobs/${encodeURIComponent(job.id)}/${action}`, { method: "POST" });
    const door = moveInDoor(job.namespace ?? source);
    await (action === "resume" ? door.apply(job.planId, job.fingerprint!) : door.undo(job.planId));
    return read(job.id);
  }, setResult);
  const saved = preview?.files ? URL.createObjectURL(new Blob([JSON.stringify(preview.files)], { type: "application/json" })) : null;

  return <div className="page-stack move-in-page">
    <section className="page-title-row"><div><a className="text-link" href="/app/settings#data">← Your data</a><h1>Move in from {sourceLabel}</h1><p>Bring your components, history and subscribers. Review a dry run before importing. Past incidents send no notifications; subscribers wait for your invitation. {source === "sorry" && `Public pages supply history only. Subscribers need an API key and wait up to ${HELD_SORRY_DAYS} days for an invitation after cutover.`}</p>{detected && <p>Moving from <a className="text-link" href={detected.url} target="_blank" rel="noreferrer">{new URL(detected.url).host}</a></p>}</div></section>
    <section className="data-card"><form className="move-in-form" onSubmit={dryRun}>
      <label className="form-label">Source<select value={source} disabled={busy || !hydrated} onChange={event => { detectionApplied.current = true; setSource(event.target.value as typeof source); setPreview(null); setResult(null); setFiles([]); setPageId(""); setPublicUrl(""); setApiKey(""); setAcknowledged(false); setPublicAccessAcknowledged(false); setError(null); clearCutover(); }}><option value="statuspage">Statuspage</option><option value="betterstack">Better Stack</option><option value="instatus">Instatus</option><option value="sorry">Sorry</option></select></label>
      <fieldset><legend>From your {sourceLabel} account</legend><AccountHelp source={source} />
        {source === "betterstack" || source === "instatus" || source === "sorry" ? <>
          <label className="form-label">{source === "instatus" ? "API key" : "API token"}<input type="password" value={apiKey} autoComplete="off" onChange={(event) => setApiKey(event.target.value.trim())} /></label>
          <PageFinder key={source} source={source} apiKey={apiKey} onChoose={setPageId} />
          <label className="form-label">{sourceLabel} page ID<input value={pageId} autoComplete="off" onChange={(event) => { detectionApplied.current = true; setPageId(event.target.value.trim()); }} /></label>
        </> : <>
          <label className="form-label">{sourceLabel} page ID<input value={pageId} autoComplete="off" onChange={(event) => { detectionApplied.current = true; setPageId(event.target.value.trim()); }} /></label>
          <label className="form-label">API key<input type="password" value={apiKey} autoComplete="off" onChange={(event) => setApiKey(event.target.value.trim())} /></label>
        </>}
        <small className="field-note">Lamp only reads from your {sourceLabel} account. The key is used for this dry run and never saved.</small></fieldset>
      {source === "sorry" && <fieldset><legend>Or from the public status page</legend><p>No key is needed. Read published components and full notice history, including maintenance. Public pages never supply subscribers.</p><label className="form-label">Sorry public page URL<input type="url" value={publicUrl} autoComplete="off" placeholder="https://status.example.com" onChange={event => { setPublicUrl(event.target.value.trim()); setPreview(null); setFiles([]); }} /></label></fieldset>}
      <fieldset><legend>Or from saved API responses</legend><SavedResponsesHelp source={source} />
        <label className="form-label">Saved responses<input ref={fileInput} key={source} type="file" multiple accept="application/json,.json" onChange={(event) => void chooseFiles(event.target.files)} /></label>{files.length > 0 && <p>{files.length} file{files.length === 1 ? "" : "s"} selected.</p>}</fieldset>
      {source === "betterstack" && <label className="checkbox-label"><input type="checkbox" checked={publicAccessAcknowledged} onChange={event => { setPublicAccessAcknowledged(event.target.checked); setPreview(null); }} /> This Better Stack page is public, with no password, IP allow-list or visitor sign-in. Lamp cannot carry those restrictions over.</label>}
      {source === "instatus" && <label className="checkbox-label"><input type="checkbox" checked={publicAccessAcknowledged} onChange={event => { setPublicAccessAcknowledged(event.target.checked); setPreview(null); }} /> This Instatus page and its history are public, with no private, allow-list or audience restrictions. Lamp cannot carry those restrictions over.</label>}
      {source === "sorry" && <label className="checkbox-label"><input type="checkbox" checked={publicAccessAcknowledged} onChange={event => { setPublicAccessAcknowledged(event.target.checked); setPreview(null); }} /> This Sorry page and supplied history are published and unrestricted. Lamp cannot preserve private-page access rules.</label>}
      <Button disabled={busy || (source === "instatus" && !pageId) || (source !== "statuspage" && !publicAccessAcknowledged) || (!files.length && !(source === "sorry" && publicUrl) && (!pageId || !apiKey))}>{busy && !preview ? "Reading…" : "Run dry run"}</Button>
    </form></section>
    {error && <FormError>{error}</FormError>}
    {preview && !result && <section className="data-card" aria-labelledby="move-in-dry-run"><h2 id="move-in-dry-run">{preview.report.state === "already imported" ? "Already imported" : "Dry run"}</h2>
      {preview.report.state === "already imported" ? <p>This source was imported already; importing it again changes nothing.</p> : <p>Nothing has been written. This is what the import will do.</p>}
      <p><a className="text-link" href={preview.jobId ? `/app/cutover?job=${encodeURIComponent(preview.jobId)}` : "/app/cutover"}>Read the Cutover preview</a></p><ReportTable report={preview.report} /><ReportItems report={preview.report} />
      {saved && <p><a href={saved} download={`${source}-saved-responses.json`}>Download these saved responses</a></p>}
      {preview.report.state !== "already imported" && <><label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I reviewed what changes, is skipped or is refused.</label>
        <Button type="button" disabled={busy || !acknowledged || preview.report.limits.length > 0} onClick={apply}>{busy ? "Importing…" : "Import"}</Button></>}
    </section>}
    {result && <section className="data-card" aria-labelledby="move-in-result"><h2 id="move-in-result">{result.job.state === "completed" ? "Imported" : result.job.state === "undone" ? "Undone" : result.job.state === "undoing" ? "Undo in progress" : "Import in progress"}</h2>
      <p><a className="text-link" href={`/app/cutover?job=${encodeURIComponent(result.job.id)}`}>Read Cutover and send invitations</a></p><ReportTable report={result.report} />
      {result.job.state === "completed" && <p>{result.invites.remaining ? `${result.invites.remaining} subscriber invitations still to send.` : "No eligible invitations remain. Read Cutover for subscription and expiry details."}</p>}
      {result.undo && <p>{result.undo.dispositions.filter((item) => item.disposition === "retained").length} record(s) changed since the import stayed.</p>}
      {result.undo?.expiredSubscribers ? <p>{result.undo.expiredSubscribers} held subscriber(s) had already expired and were deleted before this undo.</p> : null}
      {(result.job.state === "applying") && <Button type="button" disabled={busy} onClick={() => act({ id: result.job.id, ...result.door }, "resume")}>Continue</Button>}
      {result.job.state === "undoing" && <Button type="button" disabled={busy} onClick={() => act({ id: result.job.id, ...result.door }, "undo")}>Continue undo</Button>}
    </section>}
    <section className="data-card" aria-labelledby="move-in-history"><h2 id="move-in-history">Your imports</h2>
      {jobs.data?.jobs.length ? <ul className="move-in-jobs">{jobs.data.jobs.filter(job => (job.namespace ?? "statuspage") === source).map((job) => <li key={job.id}><a href={`/app/cutover?job=${encodeURIComponent(job.id)}`}>Cutover</a><span>{job.id.slice(0, 12)} · {job.state} · {job.checkpoint}/{job.total}{job.approvalCaption && <small style={{display:"block",overflowWrap:"anywhere"}}>{job.approvalCaption}</small>}</span>{job.state === "completed" && <Button type="button" variant="secondary" disabled={busy} onClick={() => act(job, "undo")}>Undo</Button>}{job.state === "applying" && <Button type="button" variant="secondary" disabled={busy} onClick={() => act(job, "resume")}>Continue</Button>}{job.state === "undoing" && <Button type="button" variant="secondary" disabled={busy} onClick={() => act(job, "undo")}>Continue undo</Button>}</li>)}</ul> : <EmptyState>No imports yet.</EmptyState>}
    </section>
  </div>;
}
