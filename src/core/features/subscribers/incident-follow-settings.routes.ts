import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app/types";
import { createIncidentFollowSettingsRepository } from "./incident-follow-settings.repository";

const settingsSchema = z.object({ includeReport: z.boolean() }).strict();

export function registerIncidentFollowSettingsRoutes(app: Hono<AppEnv>, binding: D1Database) {
  const repository = createIncidentFollowSettingsRepository(binding);
  app.get("/api/app/incident-follow-settings", async context => {
    context.header("Cache-Control", "private, no-store");
    return context.json(await repository.get());
  });
  app.patch("/api/app/incident-follow-settings", async context => {
    const input = settingsSchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "Choose whether incident subscriptions include the post-incident report.", issues: input.error.issues }, 400);
    if (!await repository.set(input.data.includeReport, context.get("operator").id, new Date().toISOString())) return context.json({ error: "Only an active owner or admin can configure incident subscriptions." }, 403);
    context.header("Cache-Control", "private, no-store");
    return context.json(await repository.get());
  });
}
