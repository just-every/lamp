import { z } from "zod";
import type { Hono } from "hono";

import type { AppEnv } from "../../app/types";
import type { OverviewService } from "./service";

const firstRunSchema = z.object({ components: z.array(z.string().trim().min(1).max(120)).max(20).default([]) }).strict();

export function registerOverviewRoutes(app: Hono<AppEnv>, service: OverviewService) {
  app.get("/api/app/overview", async (context) => context.json({ overview: await service.get() }));
  app.get("/api/app/overview/live", async (context) => context.json({ live: await service.live.get() }));
  app.post('/api/app/overview/first-run', async (context) => {
    if (context.req.header('Sec-Fetch-Site') === 'cross-site') return context.json({ error: 'Cross-site setup actions are not accepted.' }, 403);
    const parsed = firstRunSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Invalid setup action.' }, 400);
    try { await service.finishFirstRun(context.get('operator').id, parsed.data.components); return context.json({ complete: true }); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : 'First-run setup could not be completed.' }, 400); }
  });
}
