import type { SavedFile } from "../source";
import { API_ROOT, continuation, envelope, limits, schemas } from "./schema";

/** The key never leaves the fixed API origin or enters a retained artifact. */
export async function fetchBetterStack(input: { pageId: string; apiKey: string; fetcher?: typeof fetch }): Promise<SavedFile[]> {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(input.pageId)) throw new Error("Enter the Better Stack status page ID.");
  if (!/^[\x21-\x7e]{16,200}$/u.test(input.apiKey)) throw new Error("Enter a Better Stack API token.");
  const fetcher = input.fetcher ?? fetch;
  const files: SavedFile[] = [];
  let bytes = 0, records = 0;
  async function get(url: string, name: string) {
    if (files.length >= limits.files) throw new Error("Better Stack response file limit exceeded; no partial import was made.");
    const response = await fetcher(url, { method: "GET", redirect: "manual", headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (response.status >= 300 && response.status < 400) throw new Error("Better Stack redirected the API request; redirects are refused.");
    if (!response.ok) throw new Error(`Better Stack answered ${response.status}; check the token and page ID.`);
    if (Number(response.headers.get("content-length")) > limits.maxBytes - bytes) throw new Error("Better Stack responses exceed the 8 MiB total limit.");
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    if (reader) try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > limits.maxBytes) throw new Error("Better Stack responses exceed the 8 MiB total limit."); chunks.push(next.value); } } finally { await reader.cancel(); }
    const all = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(all);
    if (text.includes(input.apiKey)) throw new Error("Better Stack returned credential material; no response was retained.");
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error(`Better Stack ${name}: invalid JSON response shape.`); }
    // Inspect every JSON string, including names and overwritten duplicate
    // properties: the retained original bytes contain more than the parsed tree.
    for (const [literal] of text.matchAll(/"(?:[^"\\]|\\.)*"/gu)) {
      if ((JSON.parse(literal) as string).includes(input.apiKey)) throw new Error("Better Stack returned credential material; no response was retained.");
    }
    let parsed: ReturnType<typeof envelope.parse>;
    try { parsed = envelope.parse(raw); } catch { throw new Error(`Better Stack ${name}: invalid JSON response shape.`); }
    records += (Array.isArray(parsed.data) ? parsed.data.length : 1) + (parsed.included?.length ?? 0);
    if (records > limits.maxRecords) throw new Error("Better Stack record limit exceeded; no partial import was made.");
    files.push({ name, text }); return parsed;
  }
  async function list(path: string, stem: string) {
    const all: unknown[] = [];
    let url = `https://incidents.betterstack.com${path}`;
    for (let page = 1; page <= limits.pages; page += 1) {
      const response = await get(url, `${stem}${page === 1 ? "" : `-${page}`}.json`);
      if (!Array.isArray(response.data) || !response.pagination) throw new Error(`Better Stack ${stem}: expected a paginated list response.`);
      all.push(...response.data);
      if (typeof response.pagination.last === "string") { const last = continuation(response.pagination.last, path); if (last < page || (!response.pagination.next && last !== page)) throw new Error("Better Stack pagination ended before its declared last page."); }
      if (!response.pagination.next) return all;
      continuation(response.pagination.next, path, page + 1);
      if (page === limits.pages) throw new Error("Better Stack pagination limit exceeded; no partial import was made.");
      url = response.pagination.next;
    }
    throw new Error("Better Stack pagination did not complete.");
  }
  const base = `/api/v2/status-pages/${input.pageId}`;
  const page = await get(`${API_ROOT}/status-pages/${input.pageId}`, "status-page.json");
  if (schemas.page.parse(page.data).id !== input.pageId) throw new Error("Better Stack returned a different status page.");
  await list(`${base}/sections`, "sections");
  await list(`${base}/resources`, "resources");
  const reports = await list(`${base}/status-reports`, "status-reports");
  for (const raw of reports) { const report = schemas.report.parse(raw); await list(`${base}/status-reports/${report.id}/status-updates`, `status-updates-${report.id}`); }
  await list(`${base}/subscribers`, "subscribers");
  return files;
}
