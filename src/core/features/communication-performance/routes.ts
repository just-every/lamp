import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app/types";
import type { CommunicationPerformanceService } from "./service";
import { performanceCsv, reachCsv } from "./csv";

const id = z.string().min(1).max(200);
const format = z.enum(["json", "csv"]).optional();
const reachQuery = z.object({ updateId: id.optional(), format }).strict();
const performanceQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), incidentId: id.optional(), format }).strict();

/** Register after the app's existing operator-read authentication middleware. */
export function registerCommunicationPerformanceRoutes(app: Hono<AppEnv>, service: CommunicationPerformanceService) {
  app.get("/api/app/incidents/:id/reach", async context => {
    const query = reachQuery.safeParse(context.req.query());
    const incidentId = id.safeParse(context.req.param("id"));
    if (!query.success || !incidentId.success) return context.json({ error: "Invalid reach query." }, 400);
    context.header("Cache-Control", "no-store");
    const result = await service.incidentReach(incidentId.data, query.data.updateId);
    if (!result) return context.json({ error: "Incident or published update not found." }, 404);
    if (query.data.format === "csv" || context.req.header("Accept")?.includes("text/csv")) {
      context.header("Content-Type", "text/csv; charset=utf-8");
      context.header("Content-Disposition", 'attachment; filename="incident-reach.csv"');
      return context.body(reachCsv(result));
    }
    return context.json(result);
  });
  app.get("/api/app/communication-performance", async context => {
    const query = performanceQuery.safeParse(context.req.query());
    if (!query.success || (query.data.month && (Number(query.data.month.slice(0, 4)) < 1000 || Number(query.data.month.slice(0, 4)) > 9998))) return context.json({ error: "Choose a valid calendar month (YYYY-MM)." }, 400);
    context.header("Cache-Control", "no-store");
    const result = await service.monthly(query.data);
    if (query.data.format === "csv" || context.req.header("Accept")?.includes("text/csv")) {
      context.header("Content-Type", "text/csv; charset=utf-8");
      context.header("Content-Disposition", `attachment; filename="communication-performance-${result.month}.csv"`);
      return context.body(performanceCsv(result));
    }
    return context.json(result);
  });
}
