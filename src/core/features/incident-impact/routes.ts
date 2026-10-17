import { z } from "zod";
import type { Hono } from "hono";
import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import { INCIDENT_IMPACTS } from "../../shared/incident-impact";
import type { IncidentImpactService } from "./service";

const impactSchema = z.object({ impactOverride: z.enum(INCIDENT_IMPACTS).nullable() }).strict();

export function registerIncidentImpactRoutes(app: Hono<AppEnv>, service: IncidentImpactService) {
  app.get("/api/app/incidents/:incidentId/impact/history", async context => {
    const id = ulidSchema.safeParse(context.req.param("incidentId"));
    if (!id.success) return context.json({ error: "Invalid incident identifier.", issues: id.error.issues }, 400);
    const impact = await service.get(id.data);
    return impact ? context.json({ history: impact.history }) : context.json({ error: "Incident not found." }, 404);
  });
  app.get("/api/app/incidents/:incidentId/impact", async context => {
    const id = ulidSchema.safeParse(context.req.param("incidentId"));
    if (!id.success) return context.json({ error: "Invalid incident identifier.", issues: id.error.issues }, 400);
    const impact = await service.get(id.data);
    return impact ? context.json({ impact }) : context.json({ error: "Incident not found." }, 404);
  });
  app.put("/api/app/incidents/:incidentId/impact", async context => {
    const id = ulidSchema.safeParse(context.req.param("incidentId"));
    const input = impactSchema.safeParse(await context.req.json().catch(() => null));
    if (!id.success || !input.success) return context.json({ error: "Choose none, minor, major, critical, or null to use component claims." }, 400);
    const impact = await service.set(id.data, input.data.impactOverride, context.get("operator").id);
    return impact ? context.json({ impact }) : context.json({ error: "Incident not found." }, 404);
  });
}
