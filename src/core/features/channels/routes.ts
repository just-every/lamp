import { z } from "zod";
import type { Hono } from "hono";

import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import type { ChannelsService } from "./service";

const channelSchema = z.object({ kind: z.enum(["slack", "teams"]), name: z.string().trim().min(1).max(120), url: z.string().min(1).max(4096), componentIds: z.array(ulidSchema).max(200).default([]) }).strict();

export function registerChannelRoutes(app: Hono<AppEnv>, service: ChannelsService) {
  app.get("/api/app/channels", async (context) => context.json({ channels: await service.list(), posts: await service.log(50) }));
  app.post("/api/app/channels", async (context) => {
    const parsed = channelSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Choose Slack or Teams, a name and the channel's webhook URL." }, 400);
    try { return context.json({ channel: await service.add(parsed.data, context.get("operator").id) }, 201); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The channel could not be saved." }, 400); }
  });
  app.delete("/api/app/channels/:id", async (context) => {
    const id = ulidSchema.safeParse(context.req.param("id"));
    if (!id.success) return context.json({ error: "Channel not found." }, 404);
    return await service.remove(id.data) ? context.json({ removed: true }) : context.json({ error: "Channel not found." }, 404);
  });
}
