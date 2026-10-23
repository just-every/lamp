import { useState, type FormEvent } from "react";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";

type Counts = { created: number; skipped: number; refused: number };
type Preview = { fingerprint: string; counts: Counts; rows: { row: number; outcome: string; reason: string | null }[] };
type Batch = { batchId: string; counts: Counts };

export function SubscriberImportExport({ onChanged }: { onChanged: () => void }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  function reset(text: string) { setCsv(text); setPreview(null); setBatch(null); setError(null); setResult(null); }
  async function action(operation: () => Promise<void>) {
    setPending(true); setError(null);
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : "The subscriber operation failed."); }
    finally { setPending(false); }
  }
  async function selectFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError("Choose a CSV file no larger than 8 MiB."); return; }
    await action(async () => reset(await file.text()));
  }
  function dryRun(event: FormEvent) {
    event.preventDefault();
    void action(async () => { setPreview(await appApi<Preview>("/api/app/subscribers/import/preview", { method: "POST", body: JSON.stringify({ csv }) })); setBatch(null); setResult("Dry run complete. Nothing was written and no invitations were sent."); });
  }
  function apply() {
    if (!preview) return;
    void action(async () => { const next = await appApi<Batch>("/api/app/subscribers/import/apply", { method: "POST", body: JSON.stringify({ csv, reviewedFingerprint: preview.fingerprint }) }); setBatch(next); setPreview(null); setResult(`${next.counts.created} pending subscriptions created. No invitations have been sent.`); onChanged(); });
  }
  function invite() {
    if (!batch) return;
    void action(async () => { const response = await appApi<{ sent: number; remaining: number }>(`/api/app/subscribers/import/${batch.batchId}/send-invitations`, { method: "POST", body: "{}" }); setResult(`${response.sent} invitation${response.sent === 1 ? "" : "s"} sent. ${response.remaining} remaining. Previously sent invitations are not repeated.`); onChanged(); });
  }
  return <section className="data-card" aria-label="Import and export subscribers">
    <h2>Import and export</h2><p><a className="text-link" href="/api/app/subscribers.csv" download>Export subscribers as CSV</a></p>
    <p>Review a CSV before creating pending subscriptions. Only an owner can send the imported subscribers their confirmation invitations.</p>
    <p>Columns: email, phone, webhook_url, contact_email, components, language. Separate component IDs with semicolons; leave components blank for all visible components. Language must be English (en). Phone rows are refused.</p>
    <p>For webhook rows, optional webhook_format chooses lamp or statuspage. An omitted format uses Lamp.</p>
    <form className="incident-note-form" onSubmit={dryRun}>
      <label className="form-label">CSV file<input type="file" accept=".csv,text/csv" disabled={pending} onChange={event => void selectFile(event.target.files?.[0])} /></label>
      <label className="form-label">CSV contents<textarea rows={6} required disabled={pending} value={csv} onChange={event => reset(event.target.value)} /></label>
      <Button variant="secondary" type="submit" disabled={pending || !csv.trim()}>{pending ? "Working…" : "Dry run CSV"}</Button>
    </form>
    {preview ? <div><h3>Dry run</h3><p>{preview.counts.created} would be created; {preview.counts.skipped} skipped; {preview.counts.refused} refused.</p>
      {preview.rows.some(row => row.reason) ? <details><summary>Row decisions</summary><ul>{preview.rows.filter(row => row.reason).map(row => <li key={row.row}>Row {row.row}: {row.outcome} — {row.reason}</li>)}</ul></details> : null}
      <Button type="button" disabled={pending || preview.counts.created === 0} onClick={apply}>Create pending subscriptions</Button></div> : null}
    {batch ? <div><h3>Confirmation invitations</h3><p>Send up to 50 invitations per action. This explicitly authorizes sending; creating the pending subscriptions sent none.</p><Button type="button" variant="secondary" disabled={pending} onClick={invite}>Send invitations</Button></div> : null}
    {error ? <FormError>{error}</FormError> : null}{result ? <p role="status">{result}</p> : null}
  </section>;
}
