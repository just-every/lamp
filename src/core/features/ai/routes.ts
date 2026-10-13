import type { Hono } from "hono";
import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import type { AiService } from "./service";

export function registerAiRoutes(app: Hono<AppEnv>, service: AiService) {
  app.get("/api/app/ai/status", (context) => context.json({ configured: service.configured() }));
  app.post("/api/app/incidents/:incidentId/ai-suggestion", async (context) => { const id = ulidSchema.safeParse(context.req.param("incidentId")); if (!id.success) return context.json({ error: "Invalid incident identifier." }, 400); if (!service.configured()) return context.json({ error: "No AI provider is configured." }, 404); try { const checked = await service.suggest(id.data); return checked ? context.json(checked) : context.json({ error: "Incident not found." }, 404); } catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "AI suggestion failed." }, 502); } });
}
