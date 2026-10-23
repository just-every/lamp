import { z } from "zod";
import type { Hono } from "hono";

import type { AppEnv } from "../../app/types";
import type { OverviewService } from "./service";
import { registerFollowUpRoutes } from "./follow-ups/routes";

const name = z.string().trim().min(1).max(120);
// Up to the page's limits: 200 components and 25 groups.
const firstRunSchema = z.object({
  components: z.array(name).max(200).default([]),
  groups: z.array(z.object({ name, components: z.array(name).max(200) }).strict()).max(25).default([]),
}).strict();

export function registerOverviewRoutes(app: Hono<AppEnv>, service: OverviewService) {
  registerFollowUpRoutes(app);
  app.get("/api/app/overview", async (context) => context.json({ overview: await service.get() }));
  app.get("/api/app/overview/live", async (context) => context.json({ live: await service.live.get() }));
  app.post('/api/app/overview/first-run', async (context) => {
    if (context.req.header('Sec-Fetch-Site') === 'cross-site') return context.json({ error: 'Cross-site setup actions are not accepted.' }, 403);
    const parsed = firstRunSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Invalid setup action.' }, 400);
    try { await service.finishFirstRun(context.get('operator').id, parsed.data); return context.json({ complete: true }); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : 'First-run setup could not be completed.' }, 400); }
  });
}
