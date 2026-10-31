import { useId, useState, type FormEvent } from "react";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";

export function ReportWaiver({ incidentId, waiver, onChanged }: { incidentId: string; waiver: { reason: string } | null; onChanged: () => void }) {
  const id=useId();
  const [reason,setReason]=useState("");
  const [pending,setPending]=useState(false);
  const [error,setError]=useState<string|null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(null);
    try { await appApi(`/api/app/incidents/${incidentId}/report/waive`,{method:"POST",body:JSON.stringify({reason})}); onChanged(); }
    catch(cause) { setError(cause instanceof Error?cause.message:"The report could not be waived."); }
    finally { setPending(false); }
  }
  return <section aria-label="Report follow-up" className="report-waiver">
    <h4>Report follow-up</h4>
    {waiver ? <p role="status">Report reminder waived: {waiver.reason}. You can still write and publish a report.</p> : <form onSubmit={submit}>
      <label className="form-label" htmlFor={id}>Reason to waive the report</label>
      <textarea id={id} value={reason} onChange={event=>setReason(event.target.value)} maxLength={1000} required disabled={pending}/>
      <Button type="submit" variant="secondary" disabled={pending || !reason.trim()}>Waive report reminder</Button>
      {error ? <p role="alert">{error}</p> : null}
    </form>}
  </section>;
}
