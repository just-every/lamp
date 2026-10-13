import { z } from "zod";
import { readFileSource } from "../../../../modules/import-kit/src/readers/index.ts";
import type { Json, SourceArtifact, SourceRecord } from "../../../../modules/import-kit/src/types.ts";

/** Saved Statuspage API responses: each file is one unchanged JSON array page
 * from https://api.statuspage.io/v1, named `<resource>.json` or
 * `<resource>-<page>.json`. The API-key path saves exactly these files. */
export const namespace = "statuspage";
export const importLimits = { maxBytes: 8 * 1024 * 1024, maxRecords: 5000, maxRecordBytes: 512 * 1024, files: 200 };
export const resources = ["component-groups", "components", "incidents", "incidents-scheduled", "subscribers"] as const;
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
  incident: { id, name: text, status: incidentStatus, impact: z.string().optional(), created_at: time, resolved_at: time.nullable().optional(), scheduled_for: time.nullable().optional(), scheduled_until: time.nullable().optional(), postmortem_body: text.nullable().optional(), components: z.array(z.object({ id })).optional(), incident_updates: z.array(z.unknown()) },
  subscriber: { id, mode: z.string(), email: z.string().max(320).nullable().optional(), quarantined_at: time.nullable().optional(), components: z.array(id).nullable().optional(), created_at: time.optional() },
};
// Undocumented fields pass through to the retained source; only these are read.
export const sourceSchemas = {
  group: z.object(shapes.group).passthrough(),
  component: z.object(shapes.component).passthrough(),
  update: z.object(shapes.update).passthrough(),
  incident: z.object(shapes.incident).passthrough(),
  subscriber: z.object(shapes.subscriber).passthrough(),
};

export type SourceGroup = z.infer<z.ZodObject<typeof shapes.group>>;
export type SourceComponent = z.infer<z.ZodObject<typeof shapes.component>>;
export type SourceUpdate = z.infer<z.ZodObject<typeof shapes.update>>;
export type SourceIncident = Omit<z.infer<z.ZodObject<typeof shapes.incident>>, "incident_updates"> & { incident_updates: SourceUpdate[] };
export type SourceSubscriber = z.infer<z.ZodObject<typeof shapes.subscriber>>;
export interface SourceData { groups: SourceGroup[]; components: SourceComponent[]; incidents: SourceIncident[]; maintenance: SourceIncident[]; subscribers: SourceSubscriber[] }
export interface ReadSource { records: SourceRecord[]; artifacts: SourceArtifact[]; data: SourceData; origins: Map<string, SourceArtifact> }

const fileName = /^(component-groups|components|incidents-scheduled|incidents|subscribers)(?:-(\d{1,3}))?\.json$/u;

function resourceOf(name: string): Resource {
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
  if (![...names].some((name) => resourceOf(name) === "components")) throw new Error("Include components.json: every import starts from the page's components.");

  const data: SourceData = { groups: [], components: [], incidents: [], maintenance: [], subscribers: [] };
  const records: SourceRecord[] = [];
  const artifacts: SourceArtifact[] = [];
  const origins = new Map<string, SourceArtifact>();
  const seen = new Set<string>();
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const resource = resourceOf(file.name);
    let read;
    try {
      // Every Statuspage list response is a JSON array; the reader parses its elements one by one.
      if (!file.text.trimStart().startsWith("[")) throw new Error("shape");
      read = await readFileSource({ namespace, name: file.name, bytes: new TextEncoder().encode(file.text), format: "json", parse: (raw) => {
        if (resource === "component-groups") { const row = sourceSchemas.group.parse(raw); return { kind: "group", sourceId: row.id, payload: raw }; }
        if (resource === "components") { const row = sourceSchemas.component.parse(raw); return { kind: row.group ? "group-component" : "component", sourceId: row.id, payload: raw }; }
        if (resource === "subscribers") { const row = sourceSchemas.subscriber.parse(raw); return { kind: "subscriber", sourceId: row.id, payload: raw }; }
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
      if (record.kind === "group") data.groups.push(sourceSchemas.group.parse(raw));
      else if (record.kind === "component") data.components.push(sourceSchemas.component.parse(raw));
      else if (record.kind === "subscriber") data.subscribers.push(sourceSchemas.subscriber.parse(raw));
      else {
        const incident = sourceSchemas.incident.parse(raw);
        const parsed = { ...incident, incident_updates: incident.incident_updates.map((update) => sourceSchemas.update.parse(update)) } as SourceIncident;
        (record.kind === "maintenance" ? data.maintenance : data.incidents).push(parsed);
      }
    }
  }
  if (records.length > importLimits.maxRecords) throw new Error(`Import limit: ${importLimits.maxRecords} source records.`);
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
  const perPage = 100;
  const paths: Record<Resource, string> = { "component-groups": "component-groups", components: "components", incidents: "incidents", "incidents-scheduled": "incidents/scheduled", subscribers: "subscribers" };
  for (const resource of resources) {
    for (let page = 1; page <= 50; page += 1) {
      const url = new URL(`/v1/pages/${input.pageId}/${paths[resource]}`, origin);
      url.searchParams.set("page", String(page));
      url.searchParams.set(resource === "incidents" || resource === "subscribers" ? "limit" : "per_page", String(perPage));
      const response = await fetcher(url, { method: "GET", redirect: "manual", headers: { Authorization: `OAuth ${input.apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (response.status === 401 || response.status === 403) throw new Error("Statuspage refused the API key. Check the key and the page ID.");
      if (!response.ok) throw new Error(`Statuspage answered ${response.status} for ${resource}.`);
      const body = await response.text();
      const rows = JSON.parse(body) as unknown;
      if (!Array.isArray(rows)) throw new Error(`Statuspage returned an undocumented ${resource} response.`);
      files.push({ name: page === 1 ? `${resource}.json` : `${resource}-${page}.json`, text: body });
      if (rows.length < perPage) break;
    }
  }
  return files;
}
