import type { Hono } from "hono";

import type { AppEnv } from "../../app/types";
import type { HealthService } from "./service";

export function registerHealthRoutes(
  app: Hono<AppEnv>,
  healthService: HealthService,
) {
  app.get("/health", async (context) => {
    const health = await healthService.check();

    return context.json(health, health.status === "ok" ? 200 : 503);
  });
}
