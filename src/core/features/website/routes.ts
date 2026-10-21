import type { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../../app/types";
import type { WebsiteService } from "./service";

// `components: false` reads only the brand (Settings), so no model call is spent on products nobody uses.
const readSchema = z.object({ website: z.string().trim().min(1).max(500), components: z.boolean().optional() }).strict();

export function registerWebsiteRoutes(app: Hono<AppEnv>, service: WebsiteService) {
  app.get("/api/app/website", async (context) => context.json({ website: await service.current() }));
  app.post("/api/app/website/read", async (context) => {
    if (context.req.header("Sec-Fetch-Site") === "cross-site") return context.json({ error: "Cross-site requests are not accepted." }, 403);
    const parsed = readSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Enter a website address like example.com." }, 400);
    return context.json(await service.read(parsed.data.website, { components: parsed.data.components ?? true }));
  });
}
