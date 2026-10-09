import type { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../../app/types";
import type { MaintenanceService } from "./service";

const maintenanceSchema = z.object({ title: z.string().trim().min(1).max(250), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), componentIds: z.array(z.string().min(1)).min(1).max(100) }).strict();
const windowSchema = maintenanceSchema.pick({ startsAt: true, endsAt: true });

export function registerMaintenanceRoutes(app: Hono<AppEnv>, service: MaintenanceService) {
  app.get("/api/app/maintenance", async (context) => context.json({ maintenance: await service.list() }));
  app.post("/api/app/maintenance", async (context) => {
    const input = maintenanceSchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "A title, valid window, and one or more components are required." }, 400);
    try {
      const maintenance = await service.create(input.data, context.get("operator").id);
      context.executionCtx.waitUntil(service.refreshPublic());
      return context.json({ maintenance }, 201);
    }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Maintenance could not be scheduled." }, 409); }
  });
  app.put("/api/app/maintenance/:maintenanceId/window", async (context) => {
    const input = windowSchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "A valid maintenance window is required." }, 400);
    try {
      const maintenance = await service.reschedule(context.req.param("maintenanceId"), input.data, context.get("operator").id);
      if (maintenance) context.executionCtx.waitUntil(service.refreshPublic());
      return maintenance ? context.json({ maintenance }) : context.json({ error: "Maintenance not found." }, 404);
    }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Maintenance could not be rescheduled." }, 409); }
  });
  app.post("/api/app/maintenance/:maintenanceId/cancel", async (context) => {
    try {
      const maintenance = await service.cancel(context.req.param("maintenanceId"), context.get("operator").id);
      if (maintenance) context.executionCtx.waitUntil(service.refreshPublic());
      return maintenance ? context.json({ maintenance }) : context.json({ error: "Maintenance not found." }, 404);
    }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Maintenance could not be cancelled." }, 409); }
  });
  app.post("/api/app/maintenance/:maintenanceId/complete", async (context) => {
    try {
      const maintenance = await service.complete(context.req.param("maintenanceId"), context.get("operator").id);
      if (maintenance) context.executionCtx.waitUntil(service.finishCompletion(maintenance.id, context.get("operator").id));
      return maintenance ? context.json({ maintenance }) : context.json({ error: "Maintenance not found." }, 404);
    }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Maintenance could not be completed." }, 409); }
  });
}
