import { useCallback, useEffect, useState, type RefObject } from "react";

import type { IncidentView } from "../service";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError, useOperatorTime } from "../../../app/client/ui/states";
import { IncidentBrief, briefSummary, useIncidentBrief } from "../../brief/ui/incident-brief";
import { ReachDetails, useIncidentReach } from "../../communication-performance/ui/incident-reach";
import { IncidentImpactChoice, impactSummary, useIncidentImpact } from "../../incident-impact/ui";
import { ReportEditor, reportSummary, useIncidentReport } from "../../reports/ui/report-editor";
import { IncidentSubscribers } from "../../subscribers/ui/incident-subscribers";
import { CommunicationOwnerControl, ownerSummary } from "./communication-owner";
import { DeleteIncident } from "./incident-delete";
import { IncidentNotes, notesSummary } from "./incident-notes";
import { Glyph } from "./local-glyphs";
import { PanelRow } from "./panel-row";

const REVEAL = "incident-panel:reveal";

/** Opens the panel row that holds the element with this id (a brief fact a source link cites) and brings it into view. */
export function revealInPanel(id: string) {
  window.dispatchEvent(new CustomEvent(REVEAL, { detail: id }));
}

/** The incident's own record and tools under the timeline, one list of named rows: Brief, Reach (once something was
 * sent), Notes, Impact, the post-incident report once Resolved, the communication owner and the incident's
 * subscribers (a row once someone follows it), extensions, then a quiet Delete incident. Every row's content stays mounted while closed, and a refresh
 * never closes a row an operator opened. */
export function IncidentPanel({ incident, briefRevision, captureVisit, captureUpdate, onChanged, onDeleted }: {
  incident: IncidentView;
  briefRevision: string | null;
  captureVisit: () => () => boolean;
  captureUpdate: () => () => boolean;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const time = useOperatorTime();
  const brief = useIncidentBrief(incident.id, briefRevision);
  const reach = useIncidentReach(incident.id, incident.updates.map(update => update.id));
  const impact = useIncidentImpact(incident.id);
  const report = useIncidentReport(incident.id);
  // With no one following the incident there is nothing to open: the row reads as a quiet line, as the empty card did.
  const followers = useAppData<{ subscribers: unknown[] }>(`/api/app/incidents/${incident.id}/subscribers?limit=1&offset=0`);
  const followed = Boolean(followers.data?.subscribers.length);
  // The brief opens by itself when alerts brought facts the composer does not show.
  const alertFacts = Boolean(brief.brief?.whatWeKnow.alerts.length);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(alertFacts ? ["brief"] : []));
  const toggle = useCallback((name: string) => setOpen(current => { const next = new Set(current); if (!next.delete(name)) next.add(name); return next; }), []);
  useEffect(() => { if (alertFacts) setOpen(current => current.has("brief") ? current : new Set(current).add("brief")); }, [alertFacts]);

  // A link to a row (#post-incident-report) or to something inside one (#brief-A1) opens that row first.
  useEffect(() => {
    const reveal = (id: string) => {
      const target = document.getElementById(id);
      const row = target?.closest<HTMLElement>("[data-panel-row]");
      if (!target || !row?.dataset.panelRow) return;
      const name = row.dataset.panelRow;
      setOpen(current => current.has(name) ? current : new Set(current).add(name));
      requestAnimationFrame(() => {
        target.querySelector("details")?.setAttribute("open", "");
        target.scrollIntoView({ block: target === row ? "start" : "center" });
      });
    };
    const fromHash = () => { if (window.location.hash.length > 1) reveal(decodeURIComponent(window.location.hash.slice(1))); };
    const fromLink = (event: Event) => reveal((event as CustomEvent<string>).detail);
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener(REVEAL, fromLink);
    return () => { window.removeEventListener("hashchange", fromHash); window.removeEventListener(REVEAL, fromLink); };
  }, []);

  const row = (name: string) => ({ name, open: open.has(name), onToggle: toggle });
  return <div className="incident-panel">
    <PanelRow {...row("brief")} title="Brief" glyph="lines" summary={briefSummary(brief.brief, brief.error)}><IncidentBrief brief={brief.brief} error={brief.error} /></PanelRow>
    {/* Reach is read while this place is on screen; its row appears once the server reports a send. */}
    <div ref={reach.element as RefObject<HTMLDivElement>} className="panel-reach">
      {reach.data && reach.line ? <PanelRow {...row("reach")} title="Reach" glyph="mail" summary={reach.line}><ReachDetails path={reach.path} data={reach.data} error={reach.error} onRefresh={reach.refresh} /></PanelRow>
        : reach.error ? <div className="panel-note"><FormError>{reach.error}</FormError><Button variant="secondary" type="button" onClick={reach.refresh}>Refresh counts</Button></div> : null}
    </div>
    <PanelRow {...row("notes")} title="Notes" glyph="note" summary={notesSummary(incident.internalNotes.length)}><IncidentNotes incident={incident} captureUpdate={captureUpdate} onChanged={onChanged} /></PanelRow>
    <PanelRow {...row("impact")} title="Impact" glyph="chart" summary={impactSummary(impact.impact, impact.error)}><IncidentImpactChoice incidentId={incident.id} impact={impact.impact} error={impact.error} onSaved={impact.refresh} /></PanelRow>
    {incident.lifecycle === "Resolved" ? <PanelRow {...row("report")} id="post-incident-report" title="Post-incident report" glyph="report" summary={reportSummary(report.data, report.error, time)}><ReportEditor incidentId={incident.id} resource={report} /></PanelRow> : null}
    <PanelRow {...row("owner")} title="Communication owner" glyph="person" summary={ownerSummary(incident.owner, incident.unowned)}><CommunicationOwnerControl key={incident.id} incidentId={incident.id} lifecycle={incident.lifecycle} owner={incident.owner} unowned={incident.unowned} captureVisit={captureVisit} onChanged={onChanged} /></PanelRow>
    {followed ? <PanelRow {...row("subscribers")} title="Incident subscribers" glyph="subscribers" summary="People follow this incident"><IncidentSubscribers incidentId={incident.id} /></PanelRow>
      : followers.data ? <p className="panel-line"><Glyph name="subscribers" className="panel-row-icon" /><span className="panel-row-text"><span className="panel-row-name">Incident subscribers</span><span className="panel-row-summary">No one follows this incident yet</span></span></p> : null}
    <ClientExtensionSlot id="incident.sidebar.after.v1" context={{ incident: { id: incident.id, reference: incident.reference, lifecycle: incident.lifecycle } }} />
    <DeleteIncident incidentId={incident.id} captureVisit={captureVisit} onDeleted={onDeleted} />
  </div>;
}
