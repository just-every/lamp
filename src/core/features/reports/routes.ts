import type { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import { reportReview, ReportInputError, ReportDraftError } from "./draft";
import type { ReportsService } from "./service";

const reportSchema = z.object({ summary: z.string().trim().max(10_000), timeline: z.string().trim().max(10_000), cause: z.string().trim().max(10_000), remediation: z.string().trim().max(10_000) }).strict();
const channelsSchema = z.object({ channels: z.array(z.enum(["email", "webhook"])).max(2).transform((channels) => [...new Set(channels)]) }).strict();

export function registerReportRoutes(app: Hono<AppEnv>, service: ReportsService) {
  app.get("/api/app/incidents/:incidentId/report", async (context) => {
    const incidentId = ulidSchema.safeParse(context.req.param("incidentId"));
    if (!incidentId.success) return context.json({ error: "Invalid incident identifier." }, 400);
    const report = await service.get(incidentId.data);
    return context.json({ report, review: report ? reportReview(report) : null });
  });
  app.post("/api/app/incidents/:incidentId/report/draft", async (context) => {
    const incidentId = ulidSchema.safeParse(context.req.param("incidentId"));
    if (!incidentId.success) return context.json({ error: "Invalid incident identifier." }, 400);
    try { return context.json(await service.draft(incidentId.data, context.get("operator").id)); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The report could not be drafted." }, cause instanceof ReportInputError ? 400 : cause instanceof ReportDraftError ? cause.status : 409); }
  });
  app.put("/api/app/incidents/:incidentId/report", async (context) => {
    const incidentId = ulidSchema.safeParse(context.req.param("incidentId"));
    const input = reportSchema.safeParse(await context.req.json().catch(() => null));
    if (!incidentId.success || !input.success) return context.json({ error: "Report fields must be text of at most 10,000 characters." }, 400);
    try { return context.json({ report: await service.save(incidentId.data, input.data, context.get("operator").id) }); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The report could not be saved." }, cause instanceof ReportInputError ? 400 : 409); }
  });
  app.post("/api/app/incidents/:incidentId/report/publish", async (context) => {
    const incidentId = ulidSchema.safeParse(context.req.param("incidentId"));
    const channels = channelsSchema.safeParse(await context.req.json().catch(() => null));
    if (!incidentId.success || !channels.success) return context.json({ error: "A valid channel selection is required." }, 400);
    try { const report = await service.publish(incidentId.data, context.get("operator").id, channels.data.channels); return report ? context.json({ report }) : context.json({ error: "A mutable report for a resolved incident is required before publication." }, 409); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The report could not be published." }, cause instanceof ReportInputError ? 400 : 409); }
  });
  app.get("/api/app/reports/owing", async (context) => context.json({ incidentIds: await service.owing() }));
}
