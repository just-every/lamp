import type { Hono } from "hono";

import type { AppEnv } from "../../app/types";
import type { OverviewService } from "./service";

export function registerOverviewRoutes(app: Hono<AppEnv>, service: OverviewService) {
  app.get("/api/app/overview", async (context) => context.json({ overview: await service.get() }));
}
