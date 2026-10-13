import { z } from "zod";
import { sha256, canonicalJson } from "../../../../../modules/import-kit/src/d1/index.ts";
import { reflectedCredentialMatcher, decodedCredentialText } from "../../../../../modules/import-kit/src/provenance/credentials.ts";
import type { SourceArtifact, Json } from "../../../../../modules/import-kit/src/types.ts";
import type { SavedFile } from "../source";
import { componentSchema, incidentSchema, maintenanceSchema, pageSchema, publicSummarySchema, subscriberSchema, instatusId } from "./schema";

export const instatusLimits = { maxBytes: 8 * 1024 * 1024, maxRecords: 5000, maxRecordBytes: 512 * 1024, files: 200, pages: 50, perPage: 100 };
export const instatusResources = ["pages", "components", "incidents", "maintenances", "subscribers", "audience-groups"] as const;
export type InstatusResource = typeof instatusResources[number];
const schemas = { pages: pageSchema, components: componentSchema, incidents: incidentSchema, maintenances: maintenanceSchema, subscribers: subscriberSchema, "audience-groups": z.object({ id: instatusId }).passthrough() };
export type SavedInstatus = Awaited<ReturnType<typeof readInstatusFiles>>;
const filePattern = /^instatus-(pages|components|incidents|maintenances|subscribers|audience-groups)(?:-([1-9][0-9]?))?\.json$/u;
const detailPattern = /^instatus-maintenance-([A-Za-z0-9_-]+)\.json$/u;
const accessFields = ["private", "useAllowList", "allowList", "secureLink", "audienceGroups", "shouldPublish", "published", "isPublished", "draft"] as const;
const conflictingFacts = (left: Record<string, unknown>, right: Record<string, unknown>, fields: readonly string[]) => fields.some((field) => left[field] !== undefined && right[field] !== undefined && canonicalJson(left[field] as Json) !== canonicalJson(right[field] as Json));

/** Capability fields remain only in transient input. Artifact hashes cover the
 * unchanged response, while retained records omit operational capabilities. */
export function retainedInstatus(value: unknown): Json {
  if (Array.isArray(value)) return value.map(retainedInstatus);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:token|secret|password|authorization|cookie|api.?key|uniqueEmail|secureLink|webhook|slack|discord|microsoftTeams|googleChat)/iu.test(decodedCredentialText(key))).map(([key, child]) => [key, retainedInstatus(child)])) as Json;
  return value as Json;
}

export async function readInstatusFiles(files: SavedFile[], pageId: string) {
  if (!instatusId.safeParse(pageId).success) throw new Error("Enter the Instatus page ID for these saved responses.");
  if (!files.length || files.length > instatusLimits.files) throw new Error("Choose between 1 and 200 saved Instatus response files.");
  let bytes = 0, total = 0;
  const artifacts: SourceArtifact[] = [];
  const origins = new Map<string, SourceArtifact>();
  const collections = { pages: [], components: [], incidents: [], maintenances: [], subscribers: [], "audience-groups": [] } as Record<InstatusResource, Array<Record<string, unknown>>>;
  const pagination = new Map<InstatusResource, Map<number, number>>();
  const details = new Map<string, z.infer<typeof maintenanceSchema>>();
  const detailOrigins = new Map<string, SourceArtifact>();
  let summary: z.infer<typeof publicSummarySchema> | undefined;
  const names = new Set<string>(), identities = new Set<string>();
  for (const file of files) {
    if (names.has(file.name)) throw new Error("Duplicate Instatus response filename.");
    names.add(file.name);
    const size = new TextEncoder().encode(file.text).length;
    bytes += size;
    if (bytes > instatusLimits.maxBytes) throw new Error("Saved Instatus responses exceed the 8 MiB total limit.");
    let value: unknown;
    try { value = JSON.parse(file.text); } catch { throw new Error("An Instatus response contains invalid JSON."); }
    const artifact = { name: file.name, sha256: sha256(file.text), size };
    artifacts.push(artifact);
    const match = filePattern.exec(file.name), detail = detailPattern.exec(file.name);
    try {
      if (file.name === "instatus-summary.json") { summary = publicSummarySchema.parse(value); continue; }
      if (detail) {
        const row = maintenanceSchema.parse(value);
        if (row.id !== detail[1] || !row.components || size > instatusLimits.maxRecordBytes) throw new Error("detail");
        total += row.updates.length;
        if (total > instatusLimits.maxRecords) throw new Error("record limit");
        details.set(row.id, row); detailOrigins.set(row.id, artifact); continue;
      }
      if (!match || !Array.isArray(value)) throw new Error("shape");
      const resource = match[1] as InstatusResource, page = Number(match[2] ?? 1);
      const pages = pagination.get(resource) ?? new Map<number, number>();
      if (pages.has(page) || value.length > instatusLimits.perPage || page > instatusLimits.pages) throw new Error("pagination");
      pages.set(page, value.length); pagination.set(resource, pages);
      for (const raw of value) {
        const row = schemas[resource].parse(raw);
        if (new TextEncoder().encode(JSON.stringify(raw)).length > instatusLimits.maxRecordBytes) throw new Error("record limit");
        if (Array.isArray(row.updates) && new Set(row.updates.map((update: { id: string }) => update.id)).size !== row.updates.length) throw new Error("duplicate update");
        const key = `${resource}:${row.id}`;
        if (identities.has(key)) throw new Error("duplicate record");
        identities.add(key); total += 1 + (Array.isArray(row.updates) ? row.updates.length : 0);
        if (total > instatusLimits.maxRecords) throw new Error("record limit");
        collections[resource].push(row);
        const kind = ({ pages: "page", components: "component", incidents: "incident", maintenances: "maintenance", subscribers: "subscriber", "audience-groups": "audience-group" } as const)[resource];
        origins.set(`${kind}:${row.id}`, artifact);
      }
    } catch { throw new Error(`Invalid Instatus ${match?.[1] ?? (detail ? "maintenance detail" : "saved response")}: check its documented JSON shape, identities, pagination and record limits.`); }
  }
  for (const resource of instatusResources) {
    const pages = pagination.get(resource);
    if (!pages) throw new Error(`Include instatus-${resource}.json, including an empty array when there are no records.`);
    const numbers = [...pages.keys()].sort((a, b) => a - b);
    if (numbers.some((number, index) => number !== index + 1) || numbers.slice(0, -1).some((number) => pages.get(number) !== instatusLimits.perPage) || pages.get(numbers.at(-1)!)! >= instatusLimits.perPage) throw new Error(`Instatus ${resource} pagination is incomplete: save consecutive pages of 100 through the final short or empty page.`);
  }
  const selected = collections.pages.find((row) => row.id === pageId);
  if (!selected) throw new Error("The selected Instatus page ID is absent from the saved pages response.");
  for (const row of collections.maintenances) {
    const detail = details.get(String(row.id));
    if (!detail) throw new Error("Every Instatus maintenance needs its saved v1 detail response with affected components.");
    origins.set(`maintenance:${row.id}`, detailOrigins.get(String(row.id))!);
    // List and detail may expose different timestamp fields, but overlapping
    // supplied facts must agree. Never silently choose one snapshot's history.
    for (const field of ["name", "status", "start", "end", "duration", "autoEnd", "createdAt", "updatedAt"] as const) if (row[field] != null && detail[field] != null && canonicalJson(row[field] as Json) !== canonicalJson(detail[field] as Json)) throw new Error("Instatus maintenance list and detail disagree; save them again together.");
    if (conflictingFacts(row, detail, accessFields)) throw new Error("Instatus maintenance access differs between list and detail; save them again together.");
    const listUpdates = maintenanceSchema.parse(row).updates;
    for (const update of listUpdates) {
      const other = detail.updates.find((candidate) => candidate.id === update.id);
      if (!other || conflictingFacts(update, other, ["message", "status", "started", "ended", "duration", "createdAt", "updatedAt", ...accessFields])) throw new Error("Instatus maintenance update history differs between list and detail.");
    }
  }
  if ([...details.keys()].some((id) => !collections.maintenances.some((row) => row.id === id))) throw new Error("An Instatus maintenance detail is missing from its list response.");
  return { collections, details, summary, page: pageSchema.parse(selected), artifacts, origins };
}

export function assertInstatusKeyNotReflected(files: SavedFile[], key: string) {
  const reflected = reflectedCredentialMatcher([key]);
  for (const file of files) {
    if (reflected(file.text)) throw new Error("Instatus returned credential material; the response was refused without retaining it.");
    let value: unknown;
    try { value = JSON.parse(file.text); } catch { continue; }
    if (reflected(JSON.stringify(value))) throw new Error("Instatus returned credential material; the response was refused without retaining it.");
  }
}
