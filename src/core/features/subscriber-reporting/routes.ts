import type { Hono } from "hono";
import type { AppEnv } from "../../app/types";
import { subscriberReportingCsv } from "./csv";
import { reportingQuery, reportingRange } from "./query";
import type { SubscriberReportingService } from "./service";

/** Register after the existing /api/app/* operator authentication middleware. */
export function registerSubscriberReportingRoutes(app: Hono<AppEnv>, service: SubscriberReportingService) {
  app.get("/api/app/subscriber-reporting", async context => {
    context.header("Cache-Control", "no-store");
    const query = reportingQuery.safeParse(context.req.query());
    if (!query.success) return context.json({ error: "Choose a valid month or a date range of 1 to 366 days (to is exclusive).", issues: query.error.issues }, 400);
    const report = await service.report(reportingRange(query.data));
    if (query.data.format === "csv" || context.req.header("Accept")?.includes("text/csv")) {
      context.header("Content-Type", "text/csv; charset=utf-8");
      context.header("Content-Disposition", 'attachment; filename="subscriber-reporting.csv"');
      return context.body(subscriberReportingCsv(report));
    }
    return context.json(report);
  });
}
