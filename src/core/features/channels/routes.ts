import { z } from "zod";
import type { Hono } from "hono";

import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import type { ChannelsService } from "./service";

const channelSchema = z.object({ kind: z.enum(["slack", "teams"]), name: z.string().trim().min(1).max(120), url: z.string().min(1).max(4096), componentIds: z.array(ulidSchema).max(200).default([]), operatorAlerts: z.boolean().default(false) }).strict();

export function registerChannelRoutes(app: Hono<AppEnv>, service: ChannelsService) {
  app.get("/api/app/channels", async (context) => context.json({ unavailable: service.unavailable, channels: await service.list(), posts: await service.log(50) }));
  app.post("/api/app/channels", async (context) => {
    const parsed = channelSchema.safeParse(await context.req.json().catch(() => null));
    if (service.unavailable) return context.json({ error: service.unavailable }, 409);
    if (!parsed.success) return context.json({ error: "Choose Slack or Teams, a name and the channel's webhook URL." }, 400);
    if (parsed.data.operatorAlerts && !["owner","admin"].includes(context.get("operatorSession").operator.role)) return context.json({error:"An owner or admin must enable operator alerts."},403);
    try { return context.json({ channel: await service.add(parsed.data, context.get("operator").id) }, 201); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The channel could not be saved." }, 400); }
  });
  app.patch("/api/app/channels/:id", async context => {
    if (!["owner","admin"].includes(context.get("operatorSession").operator.role)) return context.json({error:"An owner or admin must change operator alerts."},403);
    const id=ulidSchema.safeParse(context.req.param("id"));
    const input=z.object({operatorAlerts:z.boolean()}).strict().safeParse(await context.req.json().catch(()=>null));
    if (!id.success || !input.success) return context.json({error:"Choose whether this channel receives operator alerts."},400);
    if (service.unavailable) return context.json({error:service.unavailable},409);
    return await service.setOperatorAlerts(id.data,input.data.operatorAlerts,context.get("operator").id)
      ? context.json({updated:true}) : context.json({error:"Channel not found."},404);
  });
  app.post("/api/app/channels/:id/test", async (context) => {
    const id = ulidSchema.safeParse(context.req.param("id"));
    const result = id.success ? await service.sendTest(id.data) : null;
    return result ? context.json(result) : context.json({ error: "Channel not found." }, 404);
  });
  app.delete("/api/app/channels/:id", async (context) => {
    const id = ulidSchema.safeParse(context.req.param("id"));
    if (!id.success) return context.json({ error: "Channel not found." }, 404);
    return await service.remove(id.data, context.get("operator").id) ? context.json({ removed: true }) : context.json({ error: "Channel not found." }, 404);
  });
}
