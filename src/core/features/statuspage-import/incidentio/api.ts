import { reflectedCredentialMatcher } from "../../../../../modules/import-kit/src/provenance/credentials.ts";
import type { SavedFile } from "../source";
import { id, limits, page, pagination } from "./schema";
import { z } from "zod";

/** Fixed-origin GET transport, with bounded streams and opaque cursors. */
function transport(apiKey: string, fetcher: typeof fetch) {
  if (!/^[\x21-\x7e]{16,256}$/u.test(apiKey)) throw new Error("Enter a valid incident.io API key.");
  const reflected = reflectedCredentialMatcher([apiKey]); let bytes = 0;
  return async (path: string): Promise<{ text: string; value: unknown }> => {
    let response: Response;
    try { response = await fetcher(new URL(path, "https://api.incident.io"), { method: "GET", redirect: "manual", headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); }
    catch { throw new Error("incident.io could not be read; no response data was retained."); }
    if (response.status >= 300 && response.status < 400) throw new Error("incident.io redirected the read; redirects are refused and the key was not forwarded.");
    if (!response.ok) throw new Error("incident.io refused the read (HTTP " + response.status + ").");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("incident.io returned an empty response.");
    const chunks: Uint8Array[] = []; let length = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; length += next.value.byteLength; if (bytes > limits.maxBytes) { await reader.cancel(); throw new Error("incident.io responses exceed the 8 MiB limit."); } chunks.push(next.value); } }
    finally { reader.releaseLock(); }
    const buffer = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    let text: string, value: unknown;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); value = JSON.parse(text); } catch { throw new Error("incident.io returned invalid JSON or UTF-8."); }
    if (reflected(text) || reflected(JSON.stringify(value))) throw new Error("incident.io returned credential material; it was refused without retaining it.");
    return { text, value };
  };
}

export async function findIncidentioPages(input: { apiKey: string; fetcher?: typeof fetch }) {
  const get = transport(input.apiKey, input.fetcher ?? fetch), pages: z.infer<typeof page>[] = [], cursors = new Set<string>();
  let after: string | undefined;
  for (let number = 1; number <= limits.pages; number++) {
    const query = new URLSearchParams({ page_size: "100", ...(after ? { after } : {}) });
    const response = z.object({ status_pages: z.array(page), pagination_meta: pagination }).safeParse((await get("/v2/status_pages?" + query)).value);
    if (!response.success || response.data.status_pages.length > response.data.pagination_meta.page_size) throw new Error("incident.io returned an undocumented page list.");
    pages.push(...response.data.status_pages);
    if (pages.length > limits.maxRecords || new Set(pages.map(row => row.id)).size !== pages.length) throw new Error("incident.io page list exceeds the limit or repeats an identity.");
    after = response.data.pagination_meta.after;
    if (!after) return pages.map(row => ({ id: row.id, name: row.name, address: row.public_url ?? "" }));
    if (cursors.has(after)) throw new Error("incident.io pagination repeated a cursor.");
    cursors.add(after);
  }
  throw new Error("incident.io page list exceeds the bounded page limit.");
}

export async function fetchIncidentioResponses(input: { pageId: string; apiKey: string; fetcher?: typeof fetch }): Promise<SavedFile[]> {
  if (!id.safeParse(input.pageId).success) throw new Error("Enter the incident.io status page ID.");
  const get = transport(input.apiKey, input.fetcher ?? fetch), files: SavedFile[] = [];
  async function save(path: string, name: string) {
    if (files.length >= limits.files) throw new Error("incident.io saved-file limit exceeded; nothing was truncated.");
    const response = await get(path); files.push({ name, text: response.text }); return response.value;
  }
  await save("/v2/status_pages/" + input.pageId, "incidentio-page.json");
  await save("/v2/status_page_structures/" + input.pageId, "incidentio-structure.json");
  await save("/v2/status_page_components", "incidentio-components.json");
  let records = 0;
  for (const kind of ["incidents", "maintenances"] as const) {
    let after: string | undefined, complete = false;
    const cursors = new Set<string>();
    for (let number = 1; number <= limits.pages; number++) {
      const query = new URLSearchParams({ status_page_id: input.pageId, page_size: "100", ...(after ? { after } : {}) });
      const raw = await save("/v2/status_page_" + kind + "?" + query, "incidentio-" + kind + (number === 1 ? "" : "-" + number) + ".json");
      const parsed = z.object({ pagination_meta: pagination }).passthrough().safeParse(raw);
      const rows = (raw as Record<string, unknown> | null)?.["status_page_" + kind];
      if (!parsed.success || !Array.isArray(rows) || rows.length > parsed.data.pagination_meta.page_size) throw new Error("incident.io returned an undocumented history list.");
      records += rows.length;
      if (records > limits.maxRecords) throw new Error("incident.io history record limit exceeded.");
      after = parsed.data.pagination_meta.after;
      if (!after) { complete = true; break; }
      if (cursors.has(after)) throw new Error("incident.io pagination repeated a cursor.");
      cursors.add(after);
    }
    if (!complete) throw new Error("incident.io pagination exceeds the bounded page limit; no partial history was imported.");
  }
  return files;
}
