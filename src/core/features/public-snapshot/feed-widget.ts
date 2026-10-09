import { renderIncidentUpdate } from "../incidents/renderer";

import { DAY, escapeXml, formatTime } from "./format";
import { parseWidgetAllowedOrigins } from "../../shared/widget-origins";

export interface PublicFeedUpdate {
  id: string;
  lifecycle: string;
  affectedAudience: string;
  customerImpact: string;
  whatStillWorks: string;
  details: string;
  nextUpdateAt: string | null;
  publishedAt: string;
}

export interface PublicFeedIncident {
  id: string;
  reference: string;
  title: string;
  lifecycle: string;
  updates: PublicFeedUpdate[];
}

export interface PublicFeedMaintenance {
  reference: string;
  title: string;
  components: string[];
  notices: Array<{ id: string; kind: string; body: string; publishedAt: string }>;
}

export interface FeedSettings {
  feedId: string;
  hostname: string;
  pageName: string;
  timezone: string;
  widgetAllowedOrigins: string;
}

export function renderedUpdate(incident: PublicFeedIncident, update: PublicFeedUpdate, timezone: string) {
  return renderIncidentUpdate({
    incidentReference: incident.reference,
    incidentTitle: incident.title,
    lifecycle: update.lifecycle as "Investigating" | "Identified" | "Monitoring" | "Resolved",
    affectedAudience: update.affectedAudience,
    customerImpact: update.customerImpact,
    whatStillWorks: update.whatStillWorks,
    details: update.details,
    nextUpdateAt: update.nextUpdateAt || null,
    nextUpdateDisplay: update.nextUpdateAt ? formatTime(update.nextUpdateAt, timezone) : null,
  });
}

export function updateText(incident: PublicFeedIncident, update: PublicFeedUpdate, timezone: string) {
  return renderedUpdate(incident, update, timezone).email.plainText;
}

export function updateSummary(incident: PublicFeedIncident, update: PublicFeedUpdate) {
  const impact = update.customerImpact.trim().replace(/\s+/g, " ");
  const compactImpact = impact.length > 160 ? `${impact.slice(0, 157)}…` : impact;
  return [incident.reference, update.lifecycle, compactImpact].filter(Boolean).join(" · ");
}

export function renderAtom(input: { incidents: PublicFeedIncident[]; maintenance: PublicFeedMaintenance[]; generatedAt: string; settings: FeedSettings }) {
  const entries = [
    ...input.incidents.flatMap((incident) => incident.updates.map((update) => ({ id: `update-${update.id}`, title: `${incident.reference}: ${incident.title}`, publishedAt: update.publishedAt, content: updateText(incident, update, input.settings.timezone) }))),
    ...input.maintenance.flatMap((item) => item.notices.map((notice) => ({ id: `maintenance-notice-${notice.id}`, title: `${item.reference}: ${item.title} — ${notice.kind}`, publishedAt: notice.publishedAt, content: [notice.kind, notice.body, item.components.join(", ")].filter(Boolean).join("\n") }))),
  ].filter((entry) => new Date(entry.publishedAt).getTime() >= new Date(input.generatedAt).getTime() - 365 * DAY).sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  if (!input.settings.feedId || input.settings.feedId === "pending-feed-identity") {
    throw new Error("Lamp requires a persisted feed identity before rendering Atom.");
  }
  const host = escapeXml(input.settings.hostname);
  const identity = escapeXml(input.settings.feedId);
  return `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>urn:lamp:${identity}</id><title>${escapeXml(input.settings.pageName)}</title><updated>${escapeXml(input.generatedAt)}</updated><author><name>${escapeXml(input.settings.pageName)}</name></author><link href="https://${host}/feed.atom" rel="self"/>${entries.map((entry) => `<entry><id>urn:lamp:${identity}:event:${escapeXml(entry.id)}</id><title>${escapeXml(entry.title)}</title><updated>${escapeXml(entry.publishedAt)}</updated><content type="text">${escapeXml(entry.content)}</content></entry>`).join("")}</feed>`;
}

export function statusPayload(input: { incidents: PublicFeedIncident[]; generatedAt: string; overall: string; settings: Pick<FeedSettings, "timezone"> }) {
  const newest = input.incidents.filter((incident) => incident.lifecycle !== "Resolved").flatMap((incident) => incident.updates.map((update) => ({ incident, update }))).sort((left, right) => right.update.publishedAt.localeCompare(left.update.publishedAt))[0];
  return {
    version: 1,
    generatedAt: input.generatedAt,
    overall: input.overall,
    incident: newest ? {
      reference: newest.incident.reference,
      title: newest.incident.title,
      lifecycle: newest.incident.lifecycle,
      publishedAt: newest.update.publishedAt,
      summary: updateSummary(newest.incident, newest.update),
      message: updateText(newest.incident, newest.update, input.settings.timezone),
    } : null,
  };
}

function widgetOrigins(settings: Pick<FeedSettings, "widgetAllowedOrigins">) {
  return parseWidgetAllowedOrigins(settings.widgetAllowedOrigins);
}

export function renderWidget(payload: ReturnType<typeof statusPayload>, settings: Pick<FeedSettings, "widgetAllowedOrigins">) {
  const encoded = JSON.stringify(payload).replaceAll("<", "\\u003c");
  const origins = JSON.stringify(widgetOrigins(settings)).replaceAll("<", "\\u003c");
  return `(function(){var d=${encoded},a=${origins},s=document.currentScript;if(!s||a.indexOf(window.location.origin)<0)return;var n=document.createElement('section'),dot=document.createElement('span'),state=document.createElement('strong'),detail=document.createElement('span');n.setAttribute('role','status');n.setAttribute('aria-live','polite');n.style.cssText='font:14px/1.5 system-ui,sans-serif;display:flex;flex-wrap:wrap;gap:8px;align-items:center;border:1px solid #d8e0df;border-radius:8px;padding:12px 14px;color:#0e2238;background:#fff;overflow-wrap:anywhere';dot.style.cssText='flex:0 0 9px;width:9px;height:9px;border-radius:50%;background:'+(d.overall==='Operational'?'#16794c':'#d66a1f');state.textContent=d.overall;detail.style.cssText='flex:1 1 240px;min-width:0;white-space:pre-line';detail.textContent=d.incident?' · '+d.incident.title+' — '+d.incident.message:'';n.append(dot,state,detail);s.parentNode&&s.parentNode.insertBefore(n,s.nextSibling)}());`;
}
