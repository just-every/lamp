import { z } from "zod";
import { readVisibility, visibilityFiles } from "./visibility";
import { readFileSource } from "../../../../modules/import-kit/src/readers/index.ts";
import type { SourceArtifact, SourceRecord } from "../../../../modules/import-kit/src/types.ts";

/** Saved Statuspage API responses: a resource array or one of its JSON pages,
 * named `<resource>.json` or `<resource>-<page>.json`. The API reader combines
 * subscriber pages into one array so Enterprise lists fit the file bound. */
export const namespace = "statuspage";
export const importLimits = { maxBytes: 8 * 1024 * 1024, maxRecords: 30_000, maxSubscriberRecords:25_000, maxOtherRecords:5_000, maxCsvRows:5_000, maxRecordBytes: 512 * 1024, files: 200 };
export const resources = ["component-groups", "components", "incidents", "incidents-scheduled", "subscribers", "incident-templates", "incident-template-groups"] as const;
export type Resource = (typeof resources)[number];
export type SavedFile = { name: string; text: string };

const id = z.string().min(1).max(64);
const time = z.string().datetime({ offset: true });
const text = z.string().max(20_000);
const componentStatus = z.enum(["operational", "under_maintenance", "degraded_performance", "partial_outage", "major_outage", ""]);
const incidentStatus = z.enum(["investigating", "identified", "monitoring", "resolved", "postmortem", "scheduled", "in_progress", "verifying", "completed"]);

const shapes = {
  group: { id, name: text, description: text.nullable().optional(), components: z.array(id), position: z.coerce.number().int(), created_at: time, updated_at: time.optional() },
  component: { id, name: text, description: text.nullable().optional(), group_id: id.nullable().optional(), group: z.boolean().optional(), position: z.number().int(), status: componentStatus, showcase: z.boolean().optional(), only_show_if_degraded: z.boolean().optional(), created_at: time, updated_at: time.optional() },
  update: { id, status: incidentStatus, body: text.nullable(), created_at: time, display_at: time.nullable().optional(), affected_components: z.array(z.object({ code: id, name: text.optional(), old_status: componentStatus.optional(), new_status: componentStatus })).nullable().optional() },
  incident: { id, name: text, status: incidentStatus, impact: z.string().optional(), created_at: time, resolved_at: time.nullable().optional(), scheduled_for: time.nullable().optional(), scheduled_until: time.nullable().optional(), postmortem_body: z.unknown().optional(), postmortem_published_at: z.unknown().optional(), components: z.array(z.object({ id })).optional(), incident_updates: z.array(z.unknown()) },
  template: { id, name: z.string(), title: z.string(), body: z.string(), group_id: id.nullable().optional(), group: z.object({ id, name: z.string() }).nullable().optional(), update_status: z.string(), should_send_notifications: z.boolean().nullable().optional(), components: z.array(z.object({ id, status: z.string() }).passthrough()), created_at: time.optional() },
  templateGroup: { id, name: z.string() },
  subscriber: { id, incident_id: id.nullable().optional(), mode: z.string(), email: z.string().max(320).nullable().optional(), quarantined_at: time.nullable().optional(), components: z.array(id).nullable().optional(), created_at: time.optional() },
};
// Undocumented fields pass through to the retained source; only these are read.
export const sourceSchemas = {
  group: z.object(shapes.group).passthrough(),
  component: z.object(shapes.component).passthrough(),
  update: z.object(shapes.update).passthrough(),
  incident: z.object(shapes.incident).passthrough(),
  subscriber: z.object(shapes.subscriber).passthrough(),
  template: z.object(shapes.template).passthrough(),
  templateGroup: z.object(shapes.templateGroup).passthrough(),
};

export type SourceGroup = z.infer<z.ZodObject<typeof shapes.group>>;
export type SourceComponent = z.infer<z.ZodObject<typeof shapes.component>>;
export type SourceUpdate = z.infer<z.ZodObject<typeof shapes.update>>;
export type SourceIncident = Omit<z.infer<z.ZodObject<typeof shapes.incident>>, "incident_updates" | "status"> & { status: z.infer<z.ZodObject<typeof shapes.incident>>["status"] | "cancelled"; incident_updates: SourceUpdate[] };
export type SourceSubscriber = z.infer<z.ZodObject<typeof shapes.subscriber>>;
export type SourceTemplate = z.infer<z.ZodObject<typeof shapes.template>>;
export type SourceTemplateGroup = z.infer<z.ZodObject<typeof shapes.templateGroup>>;
export interface SourceData {
  templates?: SourceTemplate[]; templateGroups?: SourceTemplateGroup[]; groups: SourceGroup[]; components: SourceComponent[]; incidents: SourceIncident[]; maintenance: SourceIncident[]; subscribers: SourceSubscriber[];
  /** Read from the page's public feeds: an incident's listed components state nothing themselves, so only an update's
   * explicit states make claims, and an incident with none stays history that names its listed components. A component
   * with an empty created_at began, as far as Lamp knows, with the import. */
  publicFeed?: true;
}
export interface ReadSource { namespace?: string; accounting?: import("./rows").Accounting[]; publicAddresses?: Record<string, string[]>; sourceInfo?: { label: string; pageId: string; publicUrl: string }; records: SourceRecord[]; artifacts: SourceArtifact[]; data: SourceData; origins: Map<string, SourceArtifact> }

const incidentSubscriberFile = /^incident-subscribers-([A-Za-z0-9_-]{1,64})\.json$/u;
const fileName = /^(component-groups|components|incidents-scheduled|incidents|subscribers|incident-templates|incident-template-groups)(?:-(\d{1,3}))?\.json$/u;

function resourceOf(name: string): Resource {
  if (incidentSubscriberFile.test(name)) return "subscribers";
  const match = fileName.exec(name);
  if (!match) throw new Error(`${name}: name each saved response <resource>.json or <resource>-<page>.json, where resource is one of ${resources.join(", ")}.`);
  return match[1] as Resource;
}

/** An incident carrying a maintenance window is scheduled maintenance, from
 * whichever list it was saved. */
function isMaintenance(incident: { scheduled_for?: string | null; impact?: string }) {
  return Boolean(incident.scheduled_for) || incident.impact === "maintenance";
}

export async function readSavedResponses(files: SavedFile[]): Promise<ReadSource> {
  if (!files.length) throw new Error("Choose the saved Statuspage responses, or enter an API key.");
  if (files.length > importLimits.files) throw new Error(`Too many files (maximum ${importLimits.files}).`);
  const names = new Set<string>();
  let size = 0;
  for (const file of files) {
    if (names.has(file.name)) throw new Error(`Duplicate file: ${file.name}`);
    names.add(file.name);
    size += new TextEncoder().encode(file.text).length;
  }
  if (size > importLimits.maxBytes) throw new Error("Saved responses exceed the 8 MiB total limit.");
  const visibility = await readVisibility(files);
  const dataFiles = files.filter(file => !visibilityFiles.has(file.name));
  if (!dataFiles.some((file) => resourceOf(file.name) === "components")) throw new Error("Include components.json: every import starts from the page's components.");

  const data: SourceData = { templates: [], templateGroups: [], groups: [], components: [], incidents: [], maintenance: [], subscribers: [] };
  const records: SourceRecord[] = [];
  const artifacts: SourceArtifact[] = [...visibility];
  const origins = new Map<string, SourceArtifact>();
  const seen = new Set<string>();
  for (const file of [...dataFiles].sort((a, b) => a.name.localeCompare(b.name))) {
    const resource = resourceOf(file.name);
    const followedIncident = incidentSubscriberFile.exec(file.name)?.[1];
    let read;
    try {
      // Every Statuspage list response is a JSON array; the reader parses its elements one by one.
      if (!file.text.trimStart().startsWith("[")) throw new Error("shape");
      read = await readFileSource({ namespace, name: file.name, bytes: new TextEncoder().encode(file.text), format: "json", parse: (raw) => {
        if (resource === "incident-templates") { const row = sourceSchemas.template.parse(raw); return { kind: "template", sourceId: row.id, payload: raw }; }
        if (resource === "incident-template-groups") { const row = sourceSchemas.templateGroup.parse(raw); return { kind: "template-group", sourceId: row.id, payload: raw }; }
        if (resource === "component-groups") { const row = sourceSchemas.group.parse(raw); return { kind: "group", sourceId: row.id, payload: raw }; }
        if (resource === "components") { const row = sourceSchemas.component.parse(raw); return { kind: row.group ? "group-component" : "component", sourceId: row.id, payload: raw }; }
        if (resource === "subscribers") {
          const row = sourceSchemas.subscriber.parse(raw);
          if (followedIncident && row.incident_id && row.incident_id !== followedIncident) throw new Error("Incident subscriber belongs to another incident.");
          const incidentId = followedIncident ?? row.incident_id;
          return { kind: "subscriber", sourceId: incidentId ? `incident:${incidentId}:${row.id}` : row.id, payload: raw };
        }
        const row = sourceSchemas.incident.parse(raw);
        row.incident_updates.forEach((update) => sourceSchemas.update.parse(update));
        return { kind: isMaintenance(row) ? "maintenance" : "incident", sourceId: row.id, payload: raw };
      } }, importLimits);
    } catch {
      throw new Error(`${file.name}: not an unchanged Statuspage ${resource} response (invalid JSON or an undocumented shape).`);
    }
    const artifact = read.artifacts[0];
    artifacts.push(artifact);
    for (const record of read.records) {
      if (record.kind === "group-component") continue;
      const key = `${record.kind}:${record.sourceId}`;
      // The incidents list and the scheduled list can both carry one maintenance.
      if (seen.has(key)) continue;
      seen.add(key);
      origins.set(key, artifact);
      records.push(record);
      const raw = record.payload as Record<string, unknown>;
      if (record.kind === "template") data.templates!.push(sourceSchemas.template.parse(raw));
      else if (record.kind === "template-group") data.templateGroups!.push(sourceSchemas.templateGroup.parse(raw));
      else if (record.kind === "group") data.groups.push(sourceSchemas.group.parse(raw));
      else if (record.kind === "component") data.components.push(sourceSchemas.component.parse(raw));
      else if (record.kind === "subscriber") {
        const subscriber = sourceSchemas.subscriber.parse(raw);
        data.subscribers.push({ ...subscriber, ...(followedIncident ? { incident_id: followedIncident } : {}) });
      }
      else {
        const incident = sourceSchemas.incident.parse(raw);
        const parsed = { ...incident, incident_updates: incident.incident_updates.map((update) => sourceSchemas.update.parse(update)) } as SourceIncident;
        (record.kind === "maintenance" ? data.maintenance : data.incidents).push(parsed);
      }
    }
  }
  if(data.subscribers.length>importLimits.maxSubscriberRecords)throw new Error(`Import limit: ${importLimits.maxSubscriberRecords} subscriber records.`);
  if(records.length-data.subscribers.length>importLimits.maxOtherRecords)throw new Error(`Import limit: ${importLimits.maxOtherRecords} other source records.`);
  return { records, artifacts, data, origins };
}

/** The API-key path: GET only, from Statuspage's fixed API origin, following
 * pages until a short page. The key is used for these requests and never stored. */
export async function fetchSavedResponses(input: { pageId: string; apiKey: string; fetcher?: typeof fetch; origin?: string }): Promise<SavedFile[]> {
  if (!/^[a-z0-9]{6,32}$/u.test(input.pageId)) throw new Error("Enter the page ID shown on Statuspage's API info page.");
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(input.apiKey)) throw new Error("Enter the API key shown on Statuspage's API info page.");
  const origin = input.origin ?? "https://api.statuspage.io";
  const fetcher = input.fetcher ?? fetch;
  const files: SavedFile[] = [];
  let bytes=0;
  const unresolved = new Set<string>();
  const bounded=(body:string)=>{bytes+=new TextEncoder().encode(body).byteLength;if(bytes>importLimits.maxBytes)throw new Error("Saved responses exceed the 8 MiB total limit.");return body;};
  for (const [name, path] of [["page.json", ""], ["page-access-groups.json", "/page_access_groups"]]) {
    const response = await fetcher(new URL(`/v1/pages/${input.pageId}${path}`, origin), { method: "GET", redirect: "manual", headers: { Authorization: `OAuth ${input.apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error("Statuspage visibility could not be read. Check the key and page ID; the import was refused.");
    files.push({ name, text: bounded(await response.text()) });
  }
  await readVisibility(files);
  const perPage = 100;
  const paths: Partial<Record<Resource, string>> = { "incident-templates": "incident_templates", "component-groups": "component-groups", components: "components", incidents: "incidents", "incidents-scheduled": "incidents/scheduled", subscribers: "subscribers" };
  // The management API exposes templates but no documented template-group read.
  // Group names can accompany saved responses or an embedded source group.
  for (const resource of resources.filter((resource) => resource !== "incident-template-groups")) {
    const subscribers:unknown[]=[];
    const maxPages=Math.floor((resource==="subscribers"?importLimits.maxSubscriberRecords:importLimits.maxOtherRecords)/perPage)+1;
    for (let page = 1; page <= maxPages; page += 1) {
      const url = new URL(`/v1/pages/${input.pageId}/${paths[resource]}`, origin);
      url.searchParams.set("page", String(page));
      url.searchParams.set(resource === "incidents" || resource === "subscribers" ? "limit" : "per_page", String(perPage));
      const response = await fetcher(url, { method: "GET", redirect: "manual", headers: { Authorization: `OAuth ${input.apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (response.status === 401 || response.status === 403) throw new Error("Statuspage refused the API key. Check the key and the page ID.");
      if (!response.ok) throw new Error(`Statuspage answered ${response.status} for ${resource}.`);
      const body = bounded(await response.text());
      const rows = JSON.parse(body) as unknown;
      if (!Array.isArray(rows)) throw new Error(`Statuspage returned an undocumented ${resource} response.`);
      if (resource === "incidents") for (const raw of rows) {
        const row = sourceSchemas.incident.parse(raw);
        if (!isMaintenance(row) && !["resolved", "postmortem"].includes(row.status)) unresolved.add(row.id);
      }
      if(resource==="subscribers")subscribers.push(...rows);
      else files.push({ name: page === 1 ? `${resource}.json` : `${resource}-${page}.json`, text: body });
      if (rows.length < perPage) break;
      if(page===maxPages)throw new Error(`Statuspage ${resource} exceeds the import limit; nothing was truncated.`);
    }
    if(resource==="subscribers")files.push({name:"subscribers.json",text:JSON.stringify(subscribers)});
  }
  // Incident followers have their own Statuspage resource. Only unresolved
  // incidents can still produce live updates after the move; resolved history
  // never resurrects a subscriber or sends a replay notification.
  let incidentSubscriberCount = 0;
  for (const incidentId of unresolved) {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(incidentId)) throw new Error("Statuspage returned an unsupported incident identity.");
    const subscribers: unknown[] = [];
    const maxPages = Math.floor(importLimits.maxSubscriberRecords / perPage) + 1;
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(`/v1/pages/${input.pageId}/incidents/${incidentId}/subscribers`, origin);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(perPage));
      const response = await fetcher(url, { method: "GET", redirect: "manual", headers: { Authorization: `OAuth ${input.apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`Statuspage answered ${response.status} for incident subscribers.`);
      const rows = JSON.parse(bounded(await response.text())) as unknown;
      if (!Array.isArray(rows)) throw new Error("Statuspage returned an undocumented incident-subscriber response.");
      subscribers.push(...rows);
      incidentSubscriberCount += rows.length;
      if (incidentSubscriberCount > importLimits.maxSubscriberRecords) throw new Error("Statuspage incident subscribers exceed the import limit; nothing was truncated.");
      if (rows.length < perPage) break;
      if (page === maxPages) throw new Error("Statuspage incident subscribers exceed the import limit; nothing was truncated.");
    }
    if (subscribers.length) files.push({ name: `incident-subscribers-${incidentId}.json`, text: JSON.stringify(subscribers) });
    if (files.length > importLimits.files) throw new Error("Statuspage responses exceed the saved-file import limit; nothing was truncated.");
  }
  return files;
}
