import { ReportWaiver } from "./report-waiver";
import { useEffect, useState } from "react";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { useOperatorTime } from "../../../app/client/ui/states";
import { REPORT_PROMPTS, reportReview, type ReportReview } from "../draft";

type Report = { summary: string; timeline: string; cause: string; remediation: string; publishedAt: string | null };
const emptyReport: Report = { summary: "", timeline: "", cause: "", remediation: "", publishedAt: null };

export function ReportEditor({ incidentId }: { incidentId: string }) {
  const formatOperatorTime = useOperatorTime();
  const endpoint = `/api/app/incidents/${incidentId}/report`;
  const { data, refresh, loading, error } = useAppData<{ report: Report | null; review: ReportReview | null; waiver: {reason:string}|null }>(endpoint);
  const [report, setReport] = useState<Report>(emptyReport);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (data && !dirty) setReport(data.report ?? emptyReport); }, [data]);
  if (report.publishedAt) return <section className="context-section"><h2>Post-incident report</h2><p>Published {formatOperatorTime(report.publishedAt)}.</p></section>;
  const review = reportReview(report);
  const busy = pending || loading || !data;
  const update = (field: keyof Omit<Report, "publishedAt">, value: string) => { setDirty(true); setReport((current) => ({ ...current, [field]: value })); };
  const draft = async () => {
    setPending(true);
    try {
      const response = await appApi<{ report: Report }>(`${endpoint}/draft`, { method: "POST" });
      setReport(response.report); setDirty(false); refresh();
      setMessage("Report drafted from the record and saved privately. Review the cited timeline, then write the cause and remediation.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Report could not be drafted."); }
    finally { setPending(false); }
  };
  const save = async () => {
    const { summary, timeline, cause, remediation } = report;
    setPending(true);
    try { await appApi(endpoint, { method: "PUT", body: JSON.stringify({ summary, timeline, cause, remediation }) }); setDirty(false); setMessage("Report saved."); refresh(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Report could not be saved."); }
    finally { setPending(false); }
  };
  const publish = async () => {
    setPending(true);
    try { await appApi(`${endpoint}/publish`, { method: "POST", body: JSON.stringify({ channels: ["email"] }) }); setMessage("Report published."); refresh(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Report could not be published."); }
    finally { setPending(false); }
  };
  return <section className="context-section report-editor">
    <ReportWaiver incidentId={incidentId} waiver={data?.waiver ?? null} onChanged={refresh} />
    <h2>Post-incident report</h2><p>Publish one factual report when this incident is complete.</p>
    <Button type="button" variant="secondary" disabled={busy || Boolean(data?.report) || dirty} onClick={draft}>Draft report</Button>
    <p>{data?.report || dirty ? "Keep editing your report. Drafting never replaces existing work." : "Draft a private report from the incident's alerts and published updates."}</p>
    {data?.review?.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}
    {(["summary", "timeline", "cause", "remediation"] as const).map((field) => {
      const humanField = field === "cause" || field === "remediation";
      const flagged = humanField ? review[field].required : false;
      const prompt = humanField ? REPORT_PROMPTS[field] : undefined;
      const hintId = `report-${incidentId}-${field}-review`;
      return <div key={field}><label className="form-label">{field[0].toUpperCase() + field.slice(1)}
        <textarea aria-label={field[0].toUpperCase() + field.slice(1)} value={report[field]} maxLength={10_000} disabled={busy} placeholder={prompt} aria-describedby={flagged ? hintId : undefined} onChange={(event) => update(field, event.target.value)} />
      </label>{flagged ? <p id={hintId}><strong>Human input required.</strong> {prompt} Check the timeline sources.</p> : null}</div>;
    })}
    {message || error ? <p role="status">{message ?? error}</p> : null}
    <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={save}>Save report</Button><Button type="button" disabled={busy || dirty || !data?.report} onClick={publish}>Publish report</Button></div>
  </section>;
}
