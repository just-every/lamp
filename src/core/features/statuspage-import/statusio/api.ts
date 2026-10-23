import { reflectedCredentialMatcher } from "../../../../../modules/import-kit/src/provenance/credentials.ts";
import type { SavedFile } from "../source";
import { id, limits, schemas } from "./schema";

/** Fixed-origin GETs. The API ID is an authentication credential distinct from
 * the status page ID. Neither credential enters the plan or saved responses. */
export async function fetchStatusioResponses(input: { pageId: string; apiId: string; apiKey: string; fetcher?: typeof fetch }): Promise<SavedFile[]> {
  if (!id.safeParse(input.pageId).success || !/^[A-Za-z0-9._-]{8,256}$/u.test(input.apiId) || !/^[A-Za-z0-9._-]{8,256}$/u.test(input.apiKey)) throw new Error("Enter the Status.io status page ID, API ID and API key.");
  const fetcher = input.fetcher ?? fetch, files: SavedFile[] = [];
  const reflected = reflectedCredentialMatcher([input.apiId, input.apiKey]);
  let bytes = 0, lastRequest = 0;
  async function get(path: string, name: string) {
    if (files.length >= limits.files) throw new Error("Status.io saved-file limit exceeded; nothing was truncated.");
    // Status.io asks clients to leave one second between sequential requests.
    const wait = Math.max(0, 1000 - (Date.now() - lastRequest));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequest = Date.now();
    let response: Response;
    try { response = await fetcher(new URL("/v2" + path, "https://api.status.io"), { method: "GET", redirect: "manual", headers: { "x-api-id": input.apiId, "x-api-key": input.apiKey, "Content-Type": "application/json", Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); }
    catch { throw new Error("Status.io could not be read; no response data was retained."); }
    if (response.status >= 300 && response.status < 400) throw new Error("Status.io redirected the request; redirects are refused and credentials were not forwarded.");
    if (!response.ok) throw new Error("Status.io refused the read (HTTP " + response.status + ").");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Status.io returned an empty response.");
    const chunks: Uint8Array[] = []; let length = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; length += next.value.byteLength; if (bytes > limits.maxBytes) { await reader.cancel(); throw new Error("Status.io responses exceed the 8 MiB limit."); } chunks.push(next.value); } }
    finally { reader.releaseLock(); }
    const buffer = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    let text: string, value: unknown;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); value = JSON.parse(text); } catch { throw new Error("Status.io returned invalid JSON or UTF-8."); }
    if (reflected(text) || reflected(JSON.stringify(value))) throw new Error("Status.io returned credential material; it was refused without retaining it.");
    if (!value || typeof value !== "object" || (value as { status?: { error?: unknown } }).status?.error !== "no") throw new Error("Status.io refused the read; no response data was retained.");
    files.push({ name, text }); return value;
  }
  const page = encodeURIComponent(input.pageId);
  await get("/admin/ip_access_control/list/" + page, "statusio-acl.json");
  await get("/component/list/" + page, "statusio-components.json");
  await get("/status/summary/" + page, "statusio-summary.json");
  await get("/incident/list/" + page, "statusio-incidents.json");
  const listed = schemas.maintenances.safeParse(await get("/maintenances/" + page, "statusio-maintenances.json"));
  if (!listed.success) throw new Error("Status.io returned an undocumented maintenance enumeration.");
  const ids = Object.values(listed.data.result).flat();
  if (new Set(ids).size !== ids.length) throw new Error("Status.io maintenance enumeration repeats an identity.");
  for (const maintenanceId of ids) await get("/maintenance/" + page + "/" + maintenanceId, "statusio-maintenance-" + maintenanceId + ".json");
  return files;
}
