import type { Hono } from "hono";

import { deploymentHealth } from "../../../base/deployment-health";
import type { AppBindings, AppEnv } from "../../app/types";
import type { HealthService } from "./service";

export function registerHealthRoutes(
  app: Hono<AppEnv>,
  healthService: HealthService,
  bindings: Pick<AppBindings, "RER_DEPLOY_SOURCE" | "RER_DEPLOY_FINGERPRINT" | "RER_VERSION">,
) {
  app.get("/health", async (context) => {
    const health = await healthService.check();
    // A healthy answer names the deployment that gave it, so a deploy can
    // confirm the version it just uploaded is the one serving.
    return health.status === "ok"
      ? context.json({ ...health, ...deploymentHealth(bindings) })
      : context.json(health, 503);
  });
}
