import { useState, type ReactNode } from "react";
import { tokenizeUpdateLinks } from "../../../shared/update-links";
import type { CheckedSuggestion } from "../../ai/service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";

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

export { ReportEditor } from "../../reports/ui/report-editor";
