import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app/types";
import type { AvailabilityReportService } from "./service";
import { availabilityCsv } from "./csv";
import { availabilityPdf } from "./pdf";

const year = (period: string) => Number(period.slice(0, 4)) >= 1000 && Number(period.slice(0, 4)) <= 9998;
const querySchema = z.object({
  component: z.string().min(1).max(200),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(year).optional(),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/).refine(year).optional(),
  format: z.enum(["csv", "pdf", "json"]).optional(),
}).strict().refine(query => Boolean(query.month) !== Boolean(query.quarter));

/** Register after the existing /api/app operator authentication middleware. */
export function registerAvailabilityReportRoutes(app: Hono<AppEnv>, service: AvailabilityReportService) {
  app.get("/api/app/availability-report", async context => {
    const query = querySchema.safeParse(context.req.query());
    if (!query.success) return context.json({ error: "Choose a component and exactly one UTC month (YYYY-MM) or quarter (YYYY-Q1 to YYYY-Q4), with CSV or PDF format." }, 400);
    context.header("Cache-Control", "no-store");
    const report = await service.report(query.data);
    if (!report) return context.json({ error: "Component not found." }, 404);
    const filename = `availability-${report.component.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-${report.period}`;
    if (query.data.format === "pdf") {
      context.header("Content-Type", "application/pdf");
      context.header("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      return context.body(availabilityPdf(report).buffer);
    }
    if (query.data.format !== "json") {
      context.header("Content-Type", "text/csv; charset=utf-8");
      context.header("Content-Disposition", `attachment; filename="${filename}.csv"`);
      return context.body(availabilityCsv(report));
    }
    return context.json(report);
  });
}
