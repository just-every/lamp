import type { Hono } from "hono";

import type { AppEnv } from "../../app/types";
import { HouseStyleUnavailableError, type HouseStyleService } from "./service.ts";

export function registerHouseStyleRoutes(app: Hono<AppEnv>, service: HouseStyleService) {
  app.get("/api/app/house-style", async (context) => context.json({ houseStyle: await service.view() }));
  // The cut-out the public page shows, for Settings on the app host.
  app.get("/api/app/house-style/picture", async (context) => {
    const bytes = await service.picture();
    if (!bytes) return context.json({ error: "No house style has been made yet." }, 404);
    return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  });
  // Settings' "Make again": queues a new picture with the next seed and answers at once; the card follows the make.
  app.post("/api/app/house-style/make-again", async (context) => {
    if (context.req.header("Sec-Fetch-Site") === "cross-site") return context.json({ error: "Cross-site requests are not accepted." }, 403);
    try {
      return context.json({ houseStyle: await service.queueAgain() }, 202);
    } catch (cause) {
      if (cause instanceof HouseStyleUnavailableError) return context.json({ error: cause.message }, 409);
      throw cause;
    }
  });
}
