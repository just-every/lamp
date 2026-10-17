import { z } from "zod";
import type { Mapped, Row } from "./rows";
import type { SourceIncident } from "./source";
import { richTextToPlain } from "./rich-text";

/** Reports share the incident's atomic custody. A malformed report refuses
 * that report alone; it cannot discard a valid incident and its history. */
export function attachPostmortem(mapped: Mapped, source: SourceIncident, operatorId: string, asOf: string, identify: (key: string, at: string) => string) {
  if ((source.postmortem_body === undefined || source.postmortem_body === null || source.postmortem_body === "") && !source.postmortem_published_at) return;
  const item = { kind: "postmortem", sourceId: source.id, name: `${source.name} — postmortem` };
  const refuse = (reason: string) => mapped.accounting.push({ ...item, outcome: "rejected", reason });
  if (!mapped.value) { refuse("Its owning incident was refused; no report can be attached."); return; }
  if (typeof source.postmortem_body !== "string" || !source.postmortem_body.trim()) { refuse("The postmortem has no text body."); return; }
  const published = source.postmortem_published_at;
  if (published !== undefined && published !== null && !z.string().datetime({ offset: true }).safeParse(published).success) { refuse("The postmortem publication time is invalid; it was not made public."); return; }
  const summary = richTextToPlain(source.postmortem_body);
  if (!summary) { refuse("The postmortem contains no readable wording."); return; }
  const incident = mapped.value.tables.incidents[0];
  const report: Row = {
    id: identify(`incident-report:${source.id}`, source.created_at), incident_id: incident.id,
    summary, timeline: "", cause: "", remediation: "",
    published_at: typeof published === "string" ? new Date(published).toISOString() : null,
    author_operator_id: operatorId, created_at: asOf, updated_at: asOf,
  };
  mapped.value.tables.incident_reports = [report];
  mapped.accounting.push({ ...item, outcome: report.published_at ? "imported" : "kept-private", reason: report.published_at ? "Published report at its original time; no notification is sent. Images are named, never fetched." : "Kept as a private draft report, visible only to operators; no notification is sent." });
}
