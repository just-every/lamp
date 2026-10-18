import { useEffect, useState, type ReactNode } from "react";
import { tokenizeUpdateLinks } from "../../../shared/update-links";
import type { CheckedSuggestion } from "../../ai/service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { useOperatorTime } from "../../../app/client/ui/states";

export function FieldNumber({ value, label, required, count, max, children }: { value: string; label: string; required?: boolean; count: number; max: number; children: ReactNode }) {
  return <label className="impact-field"><span className="field-label"><b>{value}</b>{label}{required && <em aria-hidden="true">*</em>}</span>{children}<span className="character-count">{count}/{max}</span></label>;
}

export function PreviewCard({ title, heading, lifecycle, fields, logoUrl, logoAlt }: { title: string; heading: string; lifecycle: string | null; fields: Array<{ label: string; value: string }>; logoUrl?: string; logoAlt?: string }) {
  return <section className="preview-card"><p className="preview-type">{title}</p>{lifecycle && <span className={`state-pill state-${lifecycle.toLowerCase()}`}>{lifecycle}</span>}{logoUrl && <img className="email-preview-logo" src={logoUrl} alt={logoAlt ?? ""} />}<h3>{heading}</h3><dl>{fields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{tokenizeUpdateLinks(field.value).map(token => token.kind === "https" ? <a key={token.start} href={token.href} rel="nofollow noopener ugc">{token.text}</a> : token.text)}</dd></div>)}</dl></section>;
}

export function AiSuggestionButton({ incidentId, onSuggestion, captureUpdate }: { incidentId: string; onSuggestion: (checked: CheckedSuggestion) => void; captureUpdate: () => () => boolean }) {
  const { data } = useAppData<{ configured: boolean }>("/api/app/ai/status");
  const [message, setMessage] = useState<string | null>(null);
  if (!data?.configured) return null;
  const suggest = async () => { const isCurrent = captureUpdate(); setMessage("Drafting suggestion…"); try { const response = await appApi<CheckedSuggestion>(`/api/app/incidents/${incidentId}/ai-suggestion`, { method: "POST" }); if (!isCurrent()) return; onSuggestion(response); setMessage("Suggestion filled the editable text. Check each field against its source before you publish."); } catch (cause) { if (!isCurrent()) return; setMessage(cause instanceof Error ? cause.message : "Suggestion failed."); } };
  return <div className="ai-suggestion"><Button type="button" variant="secondary" onClick={suggest}>Suggest update</Button>{message ? <span role="status">{message}</span> : null}</div>;
}

type Report = { summary: string; timeline: string; cause: string; remediation: string; publishedAt: string | null };
export function ReportEditor({ incidentId }: { incidentId: string }) {
  const formatOperatorTime = useOperatorTime();
  const { data, refresh } = useAppData<{ report: Report | null }>(`/api/app/incidents/${incidentId}/report`);
  const [reportChannels, setReportChannels] = useState<Array<"email" | "webhook" | "teams">>(["email"]);
  const [report, setReport] = useState<Report>({ summary: "", timeline: "", cause: "", remediation: "", publishedAt: null });
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (data?.report) setReport(data.report); }, [data]);
  if (report.publishedAt) return <section className="context-section"><h2>Post-incident report</h2><p>Published {formatOperatorTime(report.publishedAt)}.</p></section>;
  const update = (field: keyof Omit<Report, "publishedAt">, value: string) => setReport((current) => ({ ...current, [field]: value }));
  const save = async () => {
    const { summary, timeline, cause, remediation } = report;
    try { await appApi(`/api/app/incidents/${incidentId}/report`, { method: "PUT", body: JSON.stringify({ summary, timeline, cause, remediation }) }); setMessage("Report saved."); refresh(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Report could not be saved."); }
  };
  const publish = async () => { try { await appApi(`/api/app/incidents/${incidentId}/report/publish`, { method: "POST", body: JSON.stringify({ channels: reportChannels }) }); setMessage("Report published."); refresh(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Report could not be published."); } };
  return <section className="context-section report-editor"><h2>Post-incident report</h2><p>Publish one factual report when this incident is complete.</p>{(["summary", "timeline", "cause", "remediation"] as const).map((field) => <label className="form-label" key={field}>{field[0].toUpperCase() + field.slice(1)}<textarea value={report[field]} maxLength={10_000} onChange={(event) => update(field, event.target.value)} /></label>)}{message ? <p role="status">{message}</p> : null}<fieldset className="report-channels"><legend>Report notifications</legend><div className="channel-checks">{(["email", "webhook", "teams"] as const).map(channel => <label className="checkbox-label" key={channel}><input type="checkbox" checked={reportChannels.includes(channel)} onChange={() => setReportChannels(current => current.includes(channel) ? current.filter(value => value !== channel) : [...current, channel])} />{channel === "teams" ? "Teams subscribers" : channel === "email" ? "Email" : "Webhook"}</label>)}</div></fieldset><div className="form-actions"><Button type="button" variant="secondary" onClick={save}>Save report</Button><Button type="button" onClick={publish}>Publish report</Button></div></section>;
}
