import catalog from "./catalog.json";
import { mostSevereState, type ComponentState } from "../../../shared/domain.ts";
import { feedEntries, htmlText } from "../../../platform/status-feeds/xml.ts";
import { decodeEntities } from "../../../platform/site-reader/text.ts";

export type VendorFormat = "statuspage" | "rss" | "atom" | "json" | "google-cloud" | "slack" | "stripe" | "okta" | "pagerduty";
export type JsonStatusConfig = { statePath: string; incidentPath?: string; summaryPath?: string; mapping: Record<string, ComponentState> };
export type ParseVendorOptions = { componentId?: string; json?: JsonStatusConfig; supplementalBody?: string };
export type VendorParseOptions = ParseVendorOptions;
export type VendorStatus = { state: ComponentState; sourceState: string; incidentKey: string | null; summary: string };
export type VendorCatalogEntry = { id: string; name: string; origin: string; statusPageUrl: string; path: string; format: VendorFormat; mapping: Record<string, ComponentState>; fixture: string; selectionNote?: string; supplementalPath?: string };
export const vendorCatalog: VendorCatalogEntry[] = catalog as unknown as VendorCatalogEntry[];
export const statuspageMapping: Record<string, ComponentState> = {
  operational: "Operational", degraded_performance: "Degraded performance", partial_outage: "Partially unavailable",
  major_outage: "Major outage", under_maintenance: "Under maintenance", none: "Operational",
  minor: "Degraded performance", major: "Partially unavailable", critical: "Major outage", maintenance: "Under maintenance",
};
export const feedMapping: Record<string, ComponentState> = {
  operational: "Operational", degraded: "Degraded performance", partial_outage: "Partially unavailable", major_outage: "Major outage", maintenance: "Under maintenance",
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The vendor response is not a status object.");
  return value as Record<string, unknown>;
};
const text = (value: unknown) => typeof value === "string" ? htmlText(value).slice(0, 2000) : "";
const mapped = (sourceState: string, mapping: Record<string, ComponentState>): ComponentState => {
  const state = Object.hasOwn(mapping, sourceState) ? mapping[sourceState] : undefined;
  if (!state) throw new Error(`The vendor reported an unmapped state: ${sourceState.slice(0, 80)}.`);
  return state;
};
const result = (sourceState: string, mapping: Record<string, ComponentState>, incidentKey: unknown, summary: unknown): VendorStatus => ({
  state: mapped(sourceState, mapping), sourceState, incidentKey: typeof incidentKey === "string" || typeof incidentKey === "number" ? String(incidentKey).slice(0, 500) : null,
  summary: text(summary),
});
const atPath = (input: unknown, path: string): unknown => {
  if (!path) return input;
  let value = input;
  for (const part of path.replace(/^\$\.?/, "").split(".")) {
    if (["__proto__", "constructor", "prototype"].includes(part) || !value || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
};
function parseStatuspage(body: string, options: ParseVendorOptions): VendorStatus {
  const data = record(JSON.parse(body));
  if (!Array.isArray(data.components)) throw new Error("The vendor response has no Statuspage components.");
  const components = data.components.map(record);
  const selected = options.componentId ? components.filter(component => component.id === options.componentId) : components;
  if (options.componentId && !selected.length) throw new Error("The selected vendor component is absent.");
  const entries = selected.map(component => result(String(component.status), statuspageMapping, null, component.name));
  if (!options.componentId) {
    const status = record(data.status);
    entries.push(result(String(status.indicator), statuspageMapping, null, status.description));
  }
  const state = mostSevereState(entries.map(entry => entry.state));
  const chosen = entries.find(entry => entry.state === state)!;
  const incidents = Array.isArray(data.incidents) ? data.incidents.map(record) : [];
  const active = incidents.find(incident => !["resolved", "postmortem"].includes(String(incident.status)) && (!options.componentId || (Array.isArray(incident.components) && incident.components.some(component => record(component).id === options.componentId))));
  return { ...chosen, incidentKey: active ? String(active.id) : null, summary: text(active?.name) || chosen.summary };
}
function parseFeed(format: "rss" | "atom", body: string): VendorStatus {
  if (!(format === "rss" ? /<rss\b[\s\S]*<\/rss\s*>/i : /<feed\b[\s\S]*<\/feed\s*>/i).test(body) || (format === "rss" && !/<channel\b/i.test(body)) || /<!DOCTYPE|<!ENTITY/i.test(body)) throw new Error("The vendor response is not a supported status feed.");
  const entries = feedEntries(body).sort((a, b) => {
    const time = (fields: Record<string, string>) => Date.parse(fields.updated || fields.pubdate || fields.published || "") || 0;
    return time(b.fields) - time(a.fields);
  });
  if (!entries.length && (format === "rss" ? /<item\b/i : /<entry\b/i).test(body)) throw new Error("The vendor feed contains malformed report entries.");
  if (!entries.length) return result("operational", feedMapping, null, "The vendor status feed has no active report.");
  const latest = new Map<string, typeof entries[number]>();
  for (const entry of entries) {
    const fields = entry.fields;
    const key = fields.guid || fields.id || fields.link || entry.links.find(link => link.href)?.href || htmlText(fields.title || "");
    if (!key) throw new Error("The vendor report has no incident identity or title.");
    if (!latest.has(key)) latest.set(key, entry);
  }
  const reports = [...latest].map(([key, entry]) => {
    const fields = entry.fields;
    const title = htmlText(fields.title || "");
    const explicit = fields.status || fields["status:state"] || fields.category || "";
    let sourceState: string;
    if (Object.hasOwn(feedMapping, explicit)) sourceState = explicit;
    else if (/^(?:resolved|recovered|closed|operational)$/i.test(explicit) || /^\s*\[(?:resolved|recovered|closed|operational)\]|^(?:resolved|recovered|service is operating normally|all (?:systems|services) operational)\b/i.test(title)) sourceState = "operational";
    else if (/\b(?:maintenance|scheduled work)\b/i.test(title)) sourceState = "maintenance";
    else if (/\b(?:partial outage|partially unavailable)\b/i.test(title)) sourceState = "partial_outage";
    else if (/\b(?:service disruption|major outage|service outage|unavailable)\b/i.test(title)) sourceState = "major_outage";
    else sourceState = "degraded";
    return result(sourceState, feedMapping, key, title || fields.description || fields.summary);
  });
  const state = mostSevereState(reports.map(row => row.state));
  return reports.find(row => row.state === state)!;
}
function parseGoogle(body: string): VendorStatus {
  const data: unknown = JSON.parse(body);
  if (!Array.isArray(data)) throw new Error("The Google Cloud response is not an incident array.");
  const mapping = vendorCatalog.find(row => row.id === "google-cloud")!.mapping;
  const active = data.map(record).filter(incident => !incident.end);
  if (!active.length) return result("AVAILABLE", mapping, null, "No active Google Cloud incident.");
  const rows = active.map(incident => result(String(incident.status_impact), mapping, incident.id, incident.external_desc));
  return rows.find(row => row.state === mostSevereState(rows.map(row => row.state)))!;
}
function parseOkta(body: string): VendorStatus {
  const embedded = /<span\b[^>]*\bdata-id=["']incidents["'][^>]*>([\s\S]*?)<\/span>/i.exec(body)?.[1];
  if (embedded === undefined) throw new Error("The Okta response has no public incident records.");
  const data: unknown = JSON.parse(decodeEntities(embedded));
  if (!Array.isArray(data)) throw new Error("The Okta response is not an incident array.");
  const mapping = vendorCatalog.find(row => row.id === "okta")!.mapping;
  const active = data.map(record).filter(incident => !["Resolved", "Closed"].includes(String(incident.Status__c)));
  if (!active.length) return result("operational", mapping, null, "No active Okta incident.");
  const rows = active.map(incident => result(String(incident.Category__c), mapping, incident.Id, incident.Incident_Title__c));
  return rows.find(row => row.state === mostSevereState(rows.map(row => row.state)))!;
}
function parsePagerDuty(body: string, options: ParseVendorOptions): VendorStatus {
  const data = record(JSON.parse(body));
  if (!Array.isArray(data.impacted_services)) throw new Error("The PagerDuty response has no impacted service records.");
  const mapping = vendorCatalog.find(row => row.id === "pagerduty")!.mapping;
  if (!data.impacted_services.length) return result("operational", mapping, null, "No active PagerDuty service impact.");
  if (!options.supplementalBody) throw new Error("The PagerDuty reader needs its public impact enum table.");
  const supplement = record(JSON.parse(options.supplementalBody));
  if (!Array.isArray(supplement.post_enums)) throw new Error("The PagerDuty impact enum table is absent.");
  const enums = supplement.post_enums.map(record).filter(row => row.post_enum_type === "impacts");
  const rows = data.impacted_services.map(record).filter(row => !options.componentId || row.id === options.componentId).map(row => {
    const native = enums.find(entry => entry.id === row.severityId);
    if (!native) throw new Error("The PagerDuty service reports an unknown impact enum.");
    return result(String(native.name), mapping, row.id, "PagerDuty reports " + String(native.name));
  });
  if (!rows.length) return result("operational", mapping, null, "The selected PagerDuty service has no active impact.");
  return rows.find(row => row.state === mostSevereState(rows.map(row => row.state)))!;
}
export function parseVendorStatus(format: VendorFormat, body: string, options: ParseVendorOptions = {}): VendorStatus {
  if (format === "statuspage") return parseStatuspage(body, options);
  if (format === "rss" || format === "atom") return parseFeed(format, body);
  if (format === "google-cloud") return parseGoogle(body);
  if (format === "okta") return parseOkta(body);
  if (format === "pagerduty") return parsePagerDuty(body, options);
  const data = record(JSON.parse(body));
  if (format === "slack") {
    const incident = Array.isArray(data.active_incidents) && data.active_incidents.length ? record(data.active_incidents[0]) : null;
    return result(String(data.status), vendorCatalog.find(row => row.id === "slack")!.mapping, incident?.id, incident?.title || data.status);
  }
  if (format === "stripe") return result(String(data.UptimeStatus), vendorCatalog.find(row => row.id === "stripe")!.mapping, null, data.message);
  if (format !== "json" || !options.json) throw new Error("A JSON status source needs explicit state paths and mapping.");
  const config = options.json;
  const state = atPath(data, config.statePath);
  if (typeof state !== "string" && typeof state !== "number" && typeof state !== "boolean") throw new Error("The configured JSON state path is absent or not scalar.");
  return result(String(state), config.mapping, config.incidentPath ? atPath(data, config.incidentPath) : null, config.summaryPath ? atPath(data, config.summaryPath) : String(state));
}
