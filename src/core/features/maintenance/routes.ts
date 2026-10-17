import { maintenanceWordingSchema, maintenanceUpdateSchema, renderMaintenanceNotice } from "./wording";
import { createMaintenanceDraftRepository, maintenanceDraftSchema } from "./drafts";
import type { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../../app/types";
import type { MaintenanceService } from "./service";

const maintenanceSchema = maintenanceWordingSchema.extend({ affectedAudience:z.string().trim().min(1).max(250), customerImpact:z.string().trim().min(1).max(250), autoStart: z.boolean().optional(), autoComplete: z.boolean().optional(), remindPrior: z.boolean().optional(), channels: z.array(z.enum(["email","webhook","chat"])).optional(), draftId: z.string().optional(), draftVersion: z.number().int().positive().optional(), title: z.string().trim().min(1).max(250), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), componentIds: z.array(z.string().min(1)).min(1).max(100) }).strict();
const windowSchema = maintenanceSchema.pick({ startsAt: true, endsAt: true });

export function registerMaintenanceRoutes(app: Hono<AppEnv>, service: MaintenanceService, drafts: ReturnType<typeof createMaintenanceDraftRepository>) {
  const acknowledged = async(input:Record<string,unknown>) => {
    if(!input.draftId && input.draftVersion === undefined)return true;
    if(typeof input.draftId !== "string" || typeof input.draftVersion !== "number")return false;
    const draft=await drafts.read(input.draftId);
    if(!draft || draft.version !== input.draftVersion)return false;
    const canonical={...draft.payload,...maintenanceWordingSchema.parse(draft.payload),title:draft.payload.title.trim()};
    const scheduling="title" in input;
    if(scheduling && canonical.state !== "Scheduled")return false;
    const keys=scheduling?["title","startsAt","endsAt","componentIds","affectedAudience","customerImpact","whatStillWorks","details","channels","autoStart","autoComplete","remindPrior"]:["state","affectedAudience","customerImpact","whatStillWorks","details","channels","correctsNoticeId","autoStart","autoComplete","remindPrior"];
    const submitted={...input,channels:input.channels??["email","webhook","chat"],autoStart:input.autoStart??true,autoComplete:input.autoComplete??true,remindPrior:input.remindPrior??true};
    return keys.every(key=>JSON.stringify(canonical[key as keyof typeof canonical])===JSON.stringify(submitted[key as keyof typeof submitted]));
  };
  app.get("/api/app/maintenance/drafts/:draftId", async context => context.json({ draft: await drafts.read(context.req.param("draftId")) }));
  app.put("/api/app/maintenance/drafts/:draftId", async context => {
    const parsed = z.object({ version:z.number().int().min(0), payload:maintenanceDraftSchema }).safeParse(await context.req.json().catch(()=>null));
    if(!parsed.success) return context.json({error:"A valid draft and its acknowledged version are required."},400);
    try { return context.json({draft:await drafts.save(context.req.param("draftId"),parsed.data.version,parsed.data.payload,context.get("operator").id)}); } catch(cause) {return context.json({error:(cause as Error).message},409);}
  });
  app.post("/api/app/maintenance/preview", async context => {
    const parsed=maintenanceDraftSchema.safeParse(await context.req.json().catch(()=>null));
    if(!parsed.success) return context.json({error:"Valid maintenance wording is required."},400);
    const kind = {Scheduled:"scheduled","In progress":"started",Verifying:"verifying",Completed:"completed"}[parsed.data.state];
    return context.json({preview:renderMaintenanceNotice({...parsed.data,reference:"Preview",calendarSequence:0},kind)});
  });
  app.post("/api/app/maintenance/:maintenanceId/updates", async context => {
    const parsed=maintenanceUpdateSchema.extend({draftId:z.string().optional(),draftVersion:z.number().int().positive().optional()}).safeParse(await context.req.json().catch(()=>null));
    if(!parsed.success) return context.json({error:"Valid wording, state and channels are required."},400);
    if(!(await acknowledged(parsed.data)))return context.json({error:"Publish the complete acknowledged draft. Reload if another tab changed it."},409);
    try { const maintenance=await service.publishUpdate(context.req.param("maintenanceId"),parsed.data,context.get("operator").id); if(maintenance) context.executionCtx.waitUntil(service.refreshPublic()); return maintenance?context.json({maintenance}):context.json({error:"Maintenance not found."},404); } catch(cause) {return context.json({error:(cause as Error).message},409);}
  });
  app.get("/api/app/maintenance", async (context) => context.json({ maintenance: await service.list() }));
  app.post("/api/app/maintenance", async (context) => {
    const input = maintenanceSchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "A title, valid window, and one or more components are required." }, 400);
    if(!(await acknowledged(input.data)))return context.json({error:"Schedule the complete acknowledged draft. Reload if another tab changed it."},409);
    try {
      const maintenance = await service.create(input.data, context.get("operator").id);
      context.executionCtx.waitUntil(service.refreshPublic());
      return context.json({ maintenance }, 201);
    }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Maintenance could not be scheduled." }, 409); }
  });
  app.put("/api/app/maintenance/:maintenanceId/window", async (context) => {
    const input = windowSchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "A valid maintenance window is required." }, 400);
    try {
      const maintenance = await service.reschedule(context.req.param("maintenanceId"), input.data, context.get("operator").id);
      if (maintenance) context.executionCtx.waitUntil(service.refreshPublic());
      return maintenance ? context.json({ maintenance }) : context.json({ error: "Maintenance not found." }, 404);
    }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Maintenance could not be rescheduled." }, 409); }
  });
  app.post("/api/app/maintenance/:maintenanceId/cancel", async (context) => {
    try {
      const maintenance = await service.cancel(context.req.param("maintenanceId"), context.get("operator").id);
      if (maintenance) context.executionCtx.waitUntil(service.refreshPublic());
      return maintenance ? context.json({ maintenance }) : context.json({ error: "Maintenance not found." }, 404);
    }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Maintenance could not be cancelled." }, 409); }
  });
  app.post("/api/app/maintenance/:maintenanceId/complete", async (context) => {
    try {
      const maintenance = await service.complete(context.req.param("maintenanceId"), context.get("operator").id);
      if (maintenance) context.executionCtx.waitUntil(service.finishCompletion(maintenance.id, context.get("operator").id));
      return maintenance ? context.json({ maintenance }) : context.json({ error: "Maintenance not found." }, 404);
    }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Maintenance could not be completed." }, 409); }
  });
}
