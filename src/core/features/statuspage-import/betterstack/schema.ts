import { z } from "zod";

const id = z.union([z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u), z.number().int().nonnegative()]).transform(String);
export const sourceTime = z.string().datetime({ offset: true });
const text = z.string().max(20_000);
const attributes = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();
const resource = <T extends z.ZodRawShape>(type: string, shape: T) => z.object({ id, type: z.literal(type), attributes: attributes(shape) }).passthrough();
const affected = z.array(attributes({ status_page_resource_id: id, status: z.string() }));
export const schemas = {
  page: resource("status_page", { company_name: text, created_at: sourceTime, subdomain: z.string(), custom_domain: z.string().nullable().optional(), published: z.boolean(), password_enabled: z.boolean(), ip_allowlist: z.union([z.array(z.string()), z.string()]) }),
  section: resource("status_page_section", { name: text, position: z.number().int(), status_page_id: id }),
  component: resource("status_page_resource", { public_name: text, explanation: text.nullable().optional(), position: z.number().int(), status_page_section_id: id.nullable(), resource_id: id, resource_type: z.string(), status: z.string() }),
  report: resource("status_report", { title: text, report_type: z.enum(["manual", "automatic", "maintenance"]), starts_at: sourceTime, ends_at: sourceTime.nullable(), status_page_id: id, affected_resources: affected, aggregate_state: z.string() }).extend({ relationships: attributes({ status_updates: attributes({ data: z.array(z.object({ id, type: z.literal("status_update") }).passthrough()) }) }) }),
  update: resource("status_update", { message: text, published_at: sourceTime, status_report_id: id, affected_resources: affected }),
  subscriber: resource("status_page_subscriber", { status_page_id: id, email: z.string().max(320).nullable().optional(), status_page_resource_ids: z.array(id).nullable().optional(), confirmed_at: z.string().nullable().optional(), created_at: sourceTime.optional() }),
};
export const envelope = z.object({ data: z.unknown(), included: z.array(z.unknown()).optional(), pagination: z.object({ first: z.string().nullable().optional(), last: z.string().nullable().optional(), prev: z.string().nullable().optional(), next: z.string().nullable() }).passthrough().optional() }).passthrough();
export type BetterPage = z.infer<typeof schemas.page>;
export type BetterReport = z.infer<typeof schemas.report>;
export type BetterUpdate = z.infer<typeof schemas.update>;
export type BetterSubscriber = z.infer<typeof schemas.subscriber>;
export const API_ORIGIN = "https://incidents.betterstack.com";
export const API_ROOT = `${API_ORIGIN}/api/v2`;
export const limits = { maxBytes: 8 * 1024 * 1024, maxRecords: 5000, maxRecordBytes: 512 * 1024, files: 200, pages: 50 };

/** All continuation URLs are exact, same-page/report GET endpoints. */
export function continuation(value: string, path: string, expectedPage?: number): number {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Better Stack pagination URL is invalid."); }
  const page = Number(url.searchParams.get("page"));
  if (url.origin !== API_ORIGIN || url.pathname !== path || url.username || url.password || url.hash || [...url.searchParams.keys()].some((key) => key !== "page" && key !== "per_page") || url.searchParams.getAll("page").length !== 1 || url.searchParams.getAll("per_page").length > 1 || (url.searchParams.has("per_page") && (!/^\d+$/u.test(url.searchParams.get("per_page")!) || Number(url.searchParams.get("per_page")) < 1 || Number(url.searchParams.get("per_page")) > 250)) || !Number.isSafeInteger(page) || page < 1 || (expectedPage !== undefined && page !== expectedPage)) throw new Error("Better Stack pagination must stay on the selected page and report at its fixed API origin.");
  return page;
}
