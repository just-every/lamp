import type { SavedFile } from "../source.ts";
import { assertSorrySafe, parseSorryJson, retainedSorry } from "./json.ts";
import { managementPageSchema, nextPublicPage, object, publicPageSchema, publicUrl, recordId, sorryId, sorryLimits } from "./schema.ts";
import { reflectedCredentialMatcher } from "../../../../../modules/import-kit/src/provenance/credentials.ts";
import { safeValue } from "../../../../../modules/import-kit/src/readers/records.ts";

function reader(fetcher: typeof fetch, apiKey?: string) {
  const files: SavedFile[] = [];
  let bytes = 0, records = 0, previousRequest = 0;
  async function get(url: URL, name: string) {
    if (files.length >= sorryLimits.files) throw new Error("Sorry exceeds 200 response files; nothing was truncated.");
    const wait = Math.max(0, previousRequest + 125 - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    previousRequest = Date.now();
    let response: Response;
    try { response = await fetcher(url, { method: "GET", redirect: "manual", headers: { Accept: "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, signal: AbortSignal.timeout(20_000) }); }
    catch { throw new Error("Sorry could not be read; check connectivity and page access."); }
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* Preserve the refusal. */ }
      if (response.status >= 300 && response.status < 400) throw new Error("Sorry redirected its read; no credential was forwarded.");
      if (response.status === 401 || response.status === 403) throw new Error("Sorry refused page access or authentication.");
      throw new Error(`Sorry answered HTTP ${response.status}; no import was created.`);
    }
    const stream = response.body?.getReader();
    if (!stream) throw new Error("Sorry returned an empty response body.");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    try {
      for (;;) {
        const chunk = await stream.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > sorryLimits.maxBytes) { await stream.cancel(); throw new Error("Sorry responses exceed 8 MiB; nothing was truncated."); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } catch { try { await stream.cancel(); } catch { /* Preserve the read failure. */ } throw new Error("Sorry returned invalid, incomplete or oversized response bytes."); }
    finally { stream.releaseLock(); }
    let value: ReturnType<typeof object>;
    try {
      if (apiKey && reflectedCredentialMatcher([apiKey])(text)) throw new Error("Reflected credential.");
      value = object(parseSorryJson(text)); assertSorrySafe(value, apiKey, /^sorry-subscribers(?:-[1-9][0-9]*)?\.json$/u.test(name));
      safeValue(retainedSorry(value), apiKey ? [apiKey] : []);
    } catch { throw new Error("Sorry returned invalid JSON, credential material or an access capability; nothing was retained."); }
    function count(row: unknown) {
      if (++records > sorryLimits.maxRecords || new TextEncoder().encode(JSON.stringify(row)).length > sorryLimits.maxRecordBytes) throw new Error("Sorry source count or record size exceeds its limit; nothing was truncated.");
    }
    for (const key of ["components", "notices", "response"]) if (Array.isArray(value[key])) value[key].forEach((row: unknown) => { count(row); const updates = object(row).updates; if (Array.isArray(updates)) updates.forEach(count); });
    for (const key of ["page", "notice", "response"]) if (value[key] && !Array.isArray(value[key])) { count(value[key]); const updates = object(value[key]).updates; if (Array.isArray(updates)) updates.forEach(count); }
    files.push({ name, text });
    return value;
  }
  return { files, get };
}

/** Fixed management origin and page subtree; GET only, manual redirects,
 * ephemeral bearer credentials, complete original response bytes. */
export async function fetchSorryResponses(input: { pageId: string; apiKey: string; fetcher?: typeof fetch }): Promise<SavedFile[]> {
  if (!sorryId.safeParse(input.pageId).success) throw new Error("Enter the Sorry page ID.");
  if (!/^[A-Za-z0-9._-]{16,512}$/u.test(input.apiKey)) throw new Error("Enter a valid Sorry API key.");
  const transport = reader(input.fetcher ?? fetch, input.apiKey);
  const base = `https://api.sorryapp.com/v1/pages/${input.pageId}`;
  const page = await transport.get(new URL(base), "sorry-page.json");
  if (managementPageSchema.parse(page.response).id !== input.pageId) throw new Error("Sorry answered for another page ID.");
  async function collection(resource: string, perPage?: number) {
    const all: ReturnType<typeof object>[] = [];
    let total: number | undefined;
    for (let number = 1; number <= sorryLimits.pages; number++) {
      const url = new URL(`${base}/${resource}`);
      if (resource === "notices") url.searchParams.set("include", "components,updates");
      if (resource === "subscribers") { url.searchParams.set("include", "components"); url.searchParams.set("per_page", String(perPage)); }
      if (perPage || number > 1) url.searchParams.set("page", String(number));
      const value = await transport.get(url, `sorry-${resource}${number === 1 ? "" : `-${number}`}.json`);
      if (!Array.isArray(value.response)) throw new Error("Sorry returned an undocumented management list.");
      all.push(...value.response.map(object));
      let next = false;
      if (value.pagination != null) {
        const pagination = object(value.pagination);
        if (pagination.current !== number || !Number.isSafeInteger(pagination.pages) || Number(pagination.pages) < number || !Number.isSafeInteger(pagination.per_page) || Number(pagination.per_page) < value.response.length || !Number.isSafeInteger(pagination.count)) throw new Error("Sorry authenticated pagination is inconsistent.");
        if (total !== undefined && total !== pagination.count) throw new Error("Sorry changed during pagination; capture again.");
        total = Number(pagination.count); next = number < Number(pagination.pages);
        if (pagination.next !== (next ? number + 1 : null) || next && !value.response.length || !next && total !== all.length) throw new Error("Sorry authenticated pagination is incomplete.");
      } else {
        if (value.count !== value.response.length || perPage && value.response.length > perPage) throw new Error("Sorry management count or page size is inconsistent.");
        next = Boolean(perPage && value.response.length === perPage);
      }
      if (!next) return all;
    }
    throw new Error("Sorry authenticated collection exceeds 50 pages; nothing was truncated.");
  }
  await collection("components");
  const notices = await collection("notices");
  await collection("subscribers", 500);
  const seen = new Set<string>();
  for (const notice of notices) {
    const id = recordId.parse(notice.id);
    if (seen.has(id)) throw new Error("Sorry repeats a notice across collection pages.");
    seen.add(id);
    const detail = await transport.get(new URL(`${base}/notices/${id}?include=components,updates`), `sorry-notice-${id}.json`);
    const row = object(detail.response);
    if (row.id !== id || !Array.isArray(row.components) || !Array.isArray(row.updates)) throw new Error("Sorry notice detail must include its affected components and full updates.");
  }
  return transport.files;
}

/** No key is accepted. API paths are fixed under the selected HTTPS public
 * origin; provider links cannot choose a host, filter or alternate endpoint.
 * noticeLimit is explicit preview capture only; the default reader refuses its
 * missing detail files and strict apply can never use a partial capture. */
export async function fetchSorryPublicResponses(input: { publicUrl: string; fetcher?: typeof fetch; noticeLimit?: number }): Promise<SavedFile[]> {
  const selected = publicUrl(input.publicUrl);
  if (input.noticeLimit !== undefined && (!Number.isSafeInteger(input.noticeLimit) || input.noticeLimit < 1 || input.noticeLimit > sorryLimits.maxRecords)) throw new Error("Sorry preview detail limit must be a positive bounded integer.");
  const transport = reader(input.fetcher ?? fetch);
  const page = await transport.get(new URL("/api/v1/status", selected.origin), "sorry-status.json");
  publicPageSchema.parse(page.page);
  async function collection(resource: "components" | "notices") {
    const rows: ReturnType<typeof object>[] = [];
    const path = `/api/v1/${resource}`;
    let next: string | null = path, total: number | undefined;
    for (let number = 1; number <= sorryLimits.pages && next; number++) {
      const value = await transport.get(new URL(next, selected.origin), `sorry-${resource}${number === 1 ? "" : `-${number}`}.json`);
      const list = value[resource], meta = object(value.meta);
      if (!Array.isArray(list) || list.length > 25 || meta.count !== list.length || !Number.isSafeInteger(meta.total_count)) throw new Error("Sorry public list has undocumented pagination or counts.");
      rows.push(...list.map(object));
      if (total !== undefined && total !== meta.total_count) throw new Error("Sorry public collection changed during capture.");
      total = Number(meta.total_count);
      next = nextPublicPage(meta.next_page, path, number, selected.origin);
      if (total < rows.length || Boolean(next) !== (rows.length < total) || next && !list.length) throw new Error("Sorry public pagination is incomplete or cyclic.");
      if (!next) return rows;
    }
    throw new Error("Sorry public collection exceeds 50 pages; nothing was truncated.");
  }
  await collection("components");
  const notices = await collection("notices");
  const seen = new Set<string>();
  for (const notice of notices) {
    const id = recordId.parse(notice.id);
    if (seen.has(id)) throw new Error("Sorry repeats a notice across public pages.");
    seen.add(id);
  }
  for (const notice of notices.slice(0, input.noticeLimit ?? notices.length)) {
    const id = recordId.parse(notice.id);
    const detail = await transport.get(new URL(`/api/v1/notices/${id}`, selected.origin), `sorry-notice-${id}.json`);
    const row = object(detail.notice);
    if (row.id !== id || !Array.isArray(row.components) || !Array.isArray(row.updates)) throw new Error("Sorry public notice detail must include full components and updates.");
  }
  return transport.files;
}
