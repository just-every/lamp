import { z } from "zod";

export const sorryLimits = { maxBytes: 8 * 1024 * 1024, maxRecords: 5000, maxRecordBytes: 512 * 1024, files: 200, pages: 50 };
export const sorryId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
export const recordId = z.string().regex(/^(?:0|[1-9][0-9]*)$/u).max(128);
const text = z.string().max(100_000);
const time = z.string().datetime({ offset: true });
const optionalTime = time.nullable().optional();
export const componentSchema = z.object({
  id: recordId, name: text, description: text.nullable().optional(), state: z.enum(["operational", "degraded", "partially-degraded", "under-maintenance"]),
  parent_id: recordId.nullable().optional(), position: z.number().int().optional(), created_at: time, updated_at: time.optional(),
}).passthrough();
export const updateSchema = z.object({ id: recordId.optional(), content: text, state: z.string().nullable().optional(), created_at: time, updated_at: time.optional() }).passthrough();
export const noticeSchema = z.object({
  id: recordId, type: z.enum(["planned", "unplanned", "general"]), subject: text, state: z.string().nullable().optional(),
  created_at: time, updated_at: time.optional(), began_at: optionalTime, ended_at: optionalTime,
  begins_at: optionalTime, ends_at: optionalTime, url: z.string().url().optional(), link: z.string().url().optional(),
  components: z.array(z.object({ id: recordId }).passthrough()).optional(), component_ids: z.array(recordId).optional(),
  updates: z.array(updateSchema).optional(), latest_update: updateSchema.optional(),
}).passthrough();
export const subscriberSchema = z.object({
  id: recordId, email: z.string().max(320).nullable().optional(), notify_by_email: z.boolean(),
  components: z.array(z.object({ id: recordId }).passthrough()).optional(), component_ids: z.array(recordId).optional(),
}).passthrough();
export const publicPageSchema = z.object({ name: text, url: z.string().url(), id: sorryId.optional(), created_at: time, updated_at: time.optional() }).passthrough();
export const managementPageSchema = z.object({ id: sorryId, name: text, endpoint: z.string().min(1).max(2048), created_at: time, updated_at: time.optional() }).passthrough();
export type SorryComponent = z.infer<typeof componentSchema>;
export type SorryNotice = z.infer<typeof noticeSchema>;
export type SorryUpdate = z.infer<typeof updateSchema>;
export type SorrySubscriber = z.infer<typeof subscriberSchema>;
export type ObjectValue = Record<string, unknown>;

export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Sorry returned an undocumented response envelope.");
  return value as ObjectValue;
}

/** No userinfo, access query or non-public destination can be a source endpoint. */
export function publicUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter the complete HTTPS public Sorry page URL."); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port || url.href !== value && url.href !== `${value}/`
    || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.includes(":") || /^\d+(?:\.\d+){0,3}$/u.test(host) || !host.includes(".")) throw new Error("Sorry needs an unrestricted public HTTPS URL without credentials, query parameters or a local address.");
  return url;
}

export function publicCollectionPath(path: string): string {
  if (!/^\/api\/v1\/(?:components|notices)$/u.test(path)) throw new Error("Unsupported Sorry public collection.");
  return path;
}

/** Docs use both /v1 and /api/v1. Only page=N on this same collection is accepted. */
export function nextPublicPage(value: unknown, path: string, current: number, origin?: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !value || !origin && !value.startsWith("/")) throw new Error("Sorry pagination has an invalid next page.");
  const base = origin ?? "https://saved-sorry.invalid";
  const next = new URL(value, base);
  if (next.origin !== new URL(base).origin || next.username || next.password || next.hash || next.pathname !== path && next.pathname !== path.replace("/api/v1/", "/v1/")) throw new Error("Sorry pagination leaves its collection or origin.");
  const params = [...next.searchParams];
  if (params.length !== 1 || params[0][0] !== "page" || params[0][1] !== String(current + 1)) throw new Error("Sorry pagination is incomplete, cyclic or filtered.");
  return `${path}?page=${current + 1}`;
}
