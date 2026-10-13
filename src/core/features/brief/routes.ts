import type { Hono } from "hono";
import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import type { BriefService } from "./service";

export function registerBriefRoutes(app: Hono<AppEnv>, service: BriefService) {
  app.get("/api/app/incidents/:incidentId/brief", async (context) => {
    const id = ulidSchema.safeParse(context.req.param("incidentId"));
    if (!id.success) return context.json({ error: "Invalid incident identifier." }, 400);
    const brief = await service.get(id.data);
    return brief ? context.json({ brief }) : context.json({ error: "Incident not found." }, 404);
  });
}
