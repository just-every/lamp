import { readFileSource } from "../../../../../modules/import-kit/src/readers/index.ts";
import { canonicalJson, sha256 } from "../../../../../modules/import-kit/src/d1/index.ts";
import type { Json, SourceArtifact, SourceRecord } from "../../../../../modules/import-kit/src/types.ts";
import type { Accounting } from "../rows";
import type { ReadSource, SavedFile, SourceData } from "../source";
import { continuation, envelope, limits, schemas, type BetterReport, type BetterUpdate } from "./schema";
import { normalizeBetterStack } from "./normalize";

export interface BetterStackRead extends ReadSource {
  namespace: "betterstack";
  accounting: Accounting[];
  publicAddresses: Record<string, string[]>;
  sourceInfo: { label: string; pageId: string; publicUrl: string };
}

/** Original REST envelopes and optional original webhook payloads remain intact. */
export async function readBetterStack(files: SavedFile[], options: { publicAccessAcknowledged?: boolean } = {}): Promise<BetterStackRead> {
  if (!files.length) throw new Error("Choose saved Better Stack responses, or enter a page ID and API token.");
  if (files.length > limits.files) throw new Error("Better Stack response file limit exceeded.");
  if (files.reduce((sum, file) => sum + new TextEncoder().encode(file.text).length, 0) > limits.maxBytes) throw new Error("Saved responses exceed the 8 MiB total limit.");
  const names = new Set(files.map((file) => file.name));
  if (names.size !== files.length) throw new Error("Duplicate Better Stack response filename.");
  const parsed = new Map<string, ReturnType<typeof envelope.parse>>();
  const originals = new Map<string, unknown>();
  const artifacts: SourceArtifact[] = [];
  let count = 0;
  for (const file of files) {
    if (!/^(status-page|sections(?:-\d+)?|resources(?:-\d+)?|status-reports(?:-\d+)?|status-report-[A-Za-z0-9_-]+|status-updates-[A-Za-z0-9_-]+(?:-\d+)?|subscribers(?:-\d+)?|webhook-[A-Za-z0-9_-]+)\.json$/u.test(file.name)) throw new Error(`${file.name}: unsupported Better Stack saved response filename.`);
    try {
      const saved = await readFileSource({ namespace: "betterstack", name: file.name, bytes: new TextEncoder().encode(file.text), format: "json", parse: (raw) => ({ kind: "response", sourceId: file.name, payload: raw }) }, { ...limits, maxRecordBytes: limits.maxBytes });
      const raw = saved.records[0].payload;
      if (Array.isArray(raw) || raw === null || typeof raw !== "object") throw new Error("shape");
      artifacts.push(saved.artifacts[0]); originals.set(file.name, raw);
      if (!file.name.startsWith("webhook-")) {
        const response = envelope.parse(raw);
        for (const row of [...(Array.isArray(response.data) ? response.data : [response.data]), ...(response.included ?? [])]) {
          count += 1;
          if (new TextEncoder().encode(JSON.stringify(row)).length > limits.maxRecordBytes) throw new Error("record size");
        }
        parsed.set(file.name, response);
      }
    } catch { throw new Error(`${file.name}: invalid Better Stack JSON response shape or record size.`); }
  }
  if (count > limits.maxRecords) throw new Error("Better Stack record limit exceeded.");
  let page: ReturnType<typeof schemas.page.parse>;
  try { page = schemas.page.parse(parsed.get("status-page.json")?.data); }
  catch { throw new Error("status-page.json: include the original page response with published, password_enabled and ip_allowlist visibility evidence."); }
  const access = page.attributes;
  const allowlist = (Array.isArray(access.ip_allowlist) ? access.ip_allowlist : access.ip_allowlist.split(/\r?\n/u)).filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (!access.published || access.password_enabled || allowlist.length || access.private === true || access.access_mode && !["public", "unrestricted"].includes(String(access.access_mode)) || Array.isArray(access.audiences) && access.audiences.length) throw new Error("Better Stack private, password-protected, IP-restricted or audience-specific pages cannot become a public Lamp page.");
  if (!options.publicAccessAcknowledged) throw new Error("Confirm that this Better Stack page is public and unrestricted, including no visitor SSO; its REST response has no documented SSO flag.");
  const base = `/api/v2/status-pages/${page.id}`;
  const used = new Set(["status-page.json"]);
  const origins = new Map<string, SourceArtifact>();
  const records: SourceRecord[] = [];
  const seen = new Map<string, string>();
  function retain(kind: string, sourceId: string, raw: unknown, name: string) {
    const key = `${kind}:${sourceId}`, body = canonicalJson(raw as Json);
    if (seen.has(key)) { if (seen.get(key) !== body) throw new Error(`Better Stack ${key}: conflicting duplicate identity.`); return; }
    seen.set(key, body);
    const artifact = artifacts.find((entry) => entry.name === name)!;
    origins.set(key, artifact); records.push({ namespace: "betterstack", kind, sourceId, payload: raw as Json, payloadHash: sha256(body), artifactHash: artifact.sha256, location: { artifact: name } });
  }
  function list(stem: string, path: string): Array<{ raw: unknown; name: string }> {
    const rows: Array<{ raw: unknown; name: string }> = [];
    for (let number = 1; number <= limits.pages; number += 1) {
      const name = `${stem}${number === 1 ? "" : `-${number}`}.json`;
      const response = parsed.get(name);
      if (!response || !Array.isArray(response.data) || !response.pagination) throw new Error(`${name}: missing complete paginated Better Stack list response.`);
      used.add(name);
      for (const [field, url] of Object.entries(response.pagination)) if (["first", "last", "prev", "next"].includes(field) && typeof url === "string") continuation(url, path, field === "next" ? number + 1 : field === "prev" ? number - 1 : field === "first" ? 1 : undefined);
      rows.push(...response.data.map((raw) => ({ raw, name })));
      if (typeof response.pagination.last === "string") { const last = continuation(response.pagination.last, path); if (last < number || (!response.pagination.next && last !== number)) throw new Error(`${name}: pagination ended before its declared last page.`); }
      if (!response.pagination.next) return rows;
    }
    throw new Error("Better Stack pagination limit exceeded; no partial import was made.");
  }
  function validate<T>(schema: { parse(raw: unknown): T }, raw: unknown, name: string): T {
    try { return schema.parse(raw); } catch { throw new Error(`${name}: invalid Better Stack resource shape.`); }
  }
  const sections = list("sections", `${base}/sections`).map(({ raw, name }) => {
    const row = validate(schemas.section, raw, name); if (row.attributes.status_page_id !== page.id) throw new Error(`${name}: section belongs to another page.`); retain("group", row.id, raw, name); return row;
  });
  const components = list("resources", `${base}/resources`).map(({ raw, name }) => {
    const row = validate(schemas.component, raw, name); if (row.attributes.status_page_id !== undefined && String(row.attributes.status_page_id) !== page.id) throw new Error(`${name}: resource belongs to another page.`); retain("component", row.id, raw, name); return row;
  });
  const reports = list("status-reports", `${base}/status-reports`).map(({ raw, name }) => {
    const row = validate(schemas.report, raw, name); if (row.attributes.status_page_id !== page.id) throw new Error(`${name}: report belongs to another page.`); retain(row.attributes.report_type === "maintenance" ? "maintenance" : "incident", row.id, raw, name); return row;
  });
  const updates = new Map<string, BetterUpdate[]>();
  for (const report of reports) {
    const stem = `status-updates-${report.id}`;
    const detailName = `status-report-${report.id}.json`;
    const detail = parsed.get(detailName);
    if (detail) {
      const original = validate(schemas.report, detail.data, detailName);
      if (original.id !== report.id || canonicalJson(original.attributes as Json) !== canonicalJson(report.attributes as Json)) throw new Error(`${detailName}: report detail differs from the selected report list.`);
      used.add(detailName);
    }
    const supplied = parsed.has(`${stem}.json`) ? list(stem, `${base}/status-reports/${report.id}/status-updates`) : [];
    if (detail) supplied.push(...(detail.included ?? []).map(raw => ({ raw, name: detailName })));
    for (const [name, response] of parsed) if (used.has(name) && name.startsWith("status-reports")) supplied.push(...(response.included ?? []).filter((raw) => String((raw as { attributes?: { status_report_id?: unknown } })?.attributes?.status_report_id) === report.id).map((raw) => ({ raw, name })));
    const unique = new Map<string, BetterUpdate>();
    for (const { raw, name } of supplied) {
      const update = validate(schemas.update, raw, name);
      if (update.attributes.status_report_id !== report.id) throw new Error(`${name}: update belongs to another report.`);
      const prior = unique.get(update.id);
      const content = (row: BetterUpdate) => canonicalJson({ id: row.id, message: row.attributes.message, published_at: row.attributes.published_at, status_report_id: row.attributes.status_report_id, affected_resources: row.attributes.affected_resources } as Json);
      if (prior && content(prior) !== content(update)) throw new Error(`${name}: conflicting duplicate update.`);
      if (!prior) unique.set(update.id, update);
    }
    if (report.relationships.status_updates.data.some((ref) => !unique.has(ref.id))) throw new Error(`Report ${report.id}: missing related status updates; supply every update page.`);
    if (!parsed.has(`${stem}.json`) && unique.size !== report.relationships.status_updates.data.length) throw new Error(`Report ${report.id}: incomplete update timeline.`);
    updates.set(report.id, [...unique.values()]);
  }
  const subscribers = list("subscribers", `${base}/subscribers`).map(({ raw, name }) => {
    const row = validate(schemas.subscriber, raw, name); if (row.attributes.status_page_id !== page.id) throw new Error(`${name}: subscriber belongs to another page.`); retain("subscriber", row.id, raw, name); return row;
  });
  for (const name of parsed.keys()) if (!used.has(name)) throw new Error(`${name}: unexpected or disconnected pagination response.`);
  const publicAddresses = webhookAddresses(originals, reports, page.id);
  const host = access.custom_domain || `${access.subdomain}.betteruptime.com`;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/iu.test(host)) throw new Error("Better Stack status page hostname is invalid.");
  const normalized = normalizeBetterStack(page, sections, components, reports, updates, subscribers);
  // Updates keep their unchanged provider resources alongside the report, without
  // masquerading as REST report attributes. Original bytes also remain retained.
  for (const record of records) if (["incident", "maintenance"].includes(record.kind)) record.payload = { report: record.payload, updates: updates.get(record.sourceId) as unknown as Json };
  return { namespace: "betterstack", ...normalized, records, artifacts, origins, publicAddresses, sourceInfo: { label: "Better Stack", pageId: page.id, publicUrl: `https://${host}` } };
}

function webhookAddresses(originals: Map<string, unknown>, reports: BetterReport[], pageId: string) {
  const addresses: Record<string, string[]> = {};
  for (const [name, raw] of originals) if (name.startsWith("webhook-")) {
    const payload = raw as Record<string, any>;
    if (String(payload.page?.id) !== pageId) throw new Error(`${name}: webhook belongs to another status page.`);
    for (const kind of ["incident", "maintenance"] as const) if (payload[kind]) {
      const record = payload[kind];
      const report = reports.find((entry) => entry.id === String(record.id));
      const updates = record[`${kind}_updates`];
      if (!report || (report.attributes.report_type === "maintenance") !== (kind === "maintenance") || !Array.isArray(updates) || !updates.length || updates.some((update: any) => String(update.status_report_id) !== report.id) || typeof record.shortlink !== "string") throw new Error(`${name}: webhook shortlink lacks an unambiguous report association.`);
      const key = `${kind}:${report.id}`;
      addresses[key] = [...new Set([...(addresses[key] ?? []), record.shortlink])];
    }
  }
  return addresses;
}
