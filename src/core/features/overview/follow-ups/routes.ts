import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../../app/types";
import { createQueueDispatcher } from "../../../platform/jobs";
import { createFollowUpsRepository } from "./repository";
import { createFollowUpRetryRepository } from "./retry.repository";
import { createFollowUpsService } from "./service";

const identity = z.object({id:z.string().min(1).max(256),occurrence:z.string().min(1).max(4096)}).strict();
const dismissal = identity.extend({reason:z.string().trim().min(1).max(1000)}).strict();
const query = z.object({}).strict();

/** Mounted beneath the application's existing operator middleware. */
export function registerFollowUpRoutes(app: Hono<AppEnv>) {
  app.get("/api/app/overview/follow-ups",async context=>{
    if (!query.safeParse(context.req.query()).success) return context.json({error:"Invalid follow-up query."},400);
    const service=createFollowUpsService(createFollowUpsRepository(context.env.DB),createFollowUpRetryRepository(context.env.DB));
    return context.json({followUps:await service.list()},200,{"Cache-Control":"no-store"});
  });
  app.post("/api/app/overview/follow-ups/dismiss",async context=>{
    if (context.req.header("Sec-Fetch-Site")==="cross-site") return context.json({error:"Cross-site follow-up actions are not accepted."},403);
    const parsed=dismissal.safeParse(await context.req.json().catch(()=>null));
    if (!parsed.success) return context.json({error:"A follow-up occurrence and a non-empty reason of at most 1000 characters are required."},400);
    const service=createFollowUpsService(createFollowUpsRepository(context.env.DB),createFollowUpRetryRepository(context.env.DB));
    return await service.dismiss(parsed.data,context.get("operator").id)
      ? context.json({dismissed:true}) : context.json({error:"This failed follow-up changed or has already been dismissed."},409);
  });
  app.post("/api/app/overview/follow-ups/retry",async context=>{
    if (context.req.header("Sec-Fetch-Site")==="cross-site") return context.json({error:"Cross-site follow-up actions are not accepted."},403);
    const parsed=identity.safeParse(await context.req.json().catch(()=>null));
    if (!parsed.success) return context.json({error:"A follow-up identifier and occurrence are required."},400);
    if (context.env.EFFECTS_PAUSED==="1") return context.json({error:"Notification delivery is paused."},409);
    const service=createFollowUpsService(createFollowUpsRepository(context.env.DB),createFollowUpRetryRepository(context.env.DB));
    const result=await service.retry(parsed.data,context.get("operator").id,createQueueDispatcher(context.env.JOBS));
    if (result==="stale") return context.json({error:"This unfinished notification dispatch changed or is already being processed."},409);
    if (result==="queue-failed") return context.json({error:"The queue could not accept this retry. The notification remains pending."},503);
    return context.json({queued:true},202);
  });
}
