import type { SavedFile } from "../source";
import { instatusId } from "./schema";
import { assertInstatusKeyNotReflected, instatusLimits, instatusResources, type InstatusResource } from "./saved";

/** Fixed-origin management GETs only. The supplied fetcher is a network-edge
 * dependency for credential-free tests, never an owner-controlled URL. */
export async function fetchInstatusResponses(input: { pageId: string; apiKey: string; fetcher?: typeof fetch }): Promise<SavedFile[]> {
  if (!instatusId.safeParse(input.pageId).success) throw new Error("Enter the Instatus page ID.");
  if (!/^[A-Za-z0-9._-]{16,256}$/u.test(input.apiKey)) throw new Error("Enter a valid Instatus API key.");
  const fetcher = input.fetcher ?? fetch;
  const files: SavedFile[] = [];
  let bytes = 0, records = 0;
  async function get(path: string, name: string) {
    if (files.length >= instatusLimits.files) throw new Error("Instatus collection exceeds the saved-file limit; nothing was truncated or imported.");
    let response: Response;
    try { response = await fetcher(new URL(path, "https://api.instatus.com"), { method: "GET", redirect: "manual", headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); }
    catch { throw new Error("Instatus could not be read; check connectivity and try again."); }
    if (response.status >= 300 && response.status < 400) throw new Error("Instatus redirected the request; redirects are refused and the key was not forwarded.");
    if (response.status === 401 || response.status === 403) throw new Error("Instatus refused the API key or page access.");
    if (!response.ok) throw new Error(`Instatus answered HTTP ${response.status}; no response data was retained.`);
    const stream = response.body?.getReader();
    if (!stream) throw new Error("Instatus returned an empty response body.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await stream.read();
        if (next.done) break;
        bytes += next.value.byteLength; length += next.value.byteLength;
        if (bytes > instatusLimits.maxBytes) { await stream.cancel(); throw new Error("Instatus responses exceed the 8 MiB limit; nothing was truncated or imported."); }
        chunks.push(next.value);
      }
    } finally { stream.releaseLock(); }
    const buffer = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    let text: string, value: unknown;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); value = JSON.parse(text); }
    catch { throw new Error("Instatus returned invalid JSON or UTF-8."); }
    const file = { name, text };
    assertInstatusKeyNotReflected([file], input.apiKey);
    files.push(file);
    return value;
  }
  const paths: Record<InstatusResource, string> = { pages: "/v2/pages", components: `/v2/${input.pageId}/components`, incidents: `/v1/${input.pageId}/incidents`, maintenances: `/v2/${input.pageId}/maintenances`, subscribers: `/v2/${input.pageId}/subscribers`, "audience-groups": `/v1/${input.pageId}/audience-groups` };
  const maintenanceIds: string[] = [];
  for (const resource of instatusResources) {
    let complete = false, selected = resource !== "pages";
    for (let page = 1; page <= instatusLimits.pages; page += 1) {
      const rows = await get(`${paths[resource]}?page=${page}&per_page=${instatusLimits.perPage}`, `instatus-${resource}${page === 1 ? "" : `-${page}`}.json`);
      if (!Array.isArray(rows) || rows.length > instatusLimits.perPage) throw new Error(`Instatus returned an undocumented ${resource} list response.`);
      records += rows.length;
      if (records > instatusLimits.maxRecords) throw new Error("Instatus responses exceed the record limit; nothing was truncated or imported.");
      if (resource === "pages") selected ||= rows.some((row) => row?.id === input.pageId);
      if (resource === "maintenances") for (const row of rows) {
        if (!instatusId.safeParse(row?.id).success) throw new Error("Instatus returned an invalid maintenance identity.");
        maintenanceIds.push(row.id);
      }
      if (rows.length < instatusLimits.perPage) { complete = true; break; }
    }
    if (!complete) throw new Error(`Instatus ${resource} exceeds the page limit; save a complete bounded export before importing.`);
    if (!selected) throw new Error("The Instatus page ID is not in the pages available to this key.");
  }
  for (const id of maintenanceIds) await get(`/v1/${input.pageId}/maintenances/${id}`, `instatus-maintenance-${id}.json`);
  return files;
}
