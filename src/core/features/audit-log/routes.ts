import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app/types";
import { createAuditLogRepository, type AuditEntry } from "./repository";

const filter = z.object({ actorId: z.string().min(1).max(200).optional(), action: z.string().min(1).max(100).optional(), from: z.iso.datetime().optional(), until: z.iso.datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(1_000_000_000).default(0), format: z.enum(["json", "csv"]).optional() }).strict().refine(value => !value.from || !value.until || value.from < value.until, "The end must follow the start.");
const columns = ["id", "createdAt", "actorId", "actorName", "action", "entityType", "entityId", "reason", "approvedBy", "nativeReviewedBy"] as const;
function cell(value: string | null) { const text = value ?? ""; return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`; }
export function auditCsv(rows: AuditEntry[]) { return [columns.join(","), ...rows.map(row => columns.map(key => cell(row[key])).join(","))].join("\r\n") + "\r\n"; }

/** Uses the same session admission as Settings, under TEAM-001's equal operators. */
export function registerAuditLogRoutes(app: Hono<AppEnv>, repository: ReturnType<typeof createAuditLogRepository>) {
  app.get("/api/app/audit-log", async context => {
    const parsed = filter.safeParse(context.req.query());
    if (!parsed.success) return context.json({ error: "Choose a valid actor, action and time range." }, 400);
    context.header("Cache-Control", "no-store");
    const { limit, offset, format, ...selection } = parsed.data;
    if (format === "csv") {
      context.header("Content-Type", "text/csv; charset=utf-8");
      context.header("Content-Disposition", 'attachment; filename="lamp-audit-log.csv"');
      return context.body(auditCsv(await repository.export(selection)));
    }
    const [rows, options] = await Promise.all([repository.list(selection, limit, offset), repository.options()]);
    return context.json({ entries: rows.slice(0, limit), hasMore: rows.length > limit, limit, offset, ...options });
  });
}
