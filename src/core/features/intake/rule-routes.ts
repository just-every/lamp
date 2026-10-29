import type { Hono } from "hono";
import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import { alertRuleSchema } from "./rule-schema";
import type { AlertRuleService } from "./rule-service";

export function registerAlertRuleRoutes(app:Hono<AppEnv>,service:AlertRuleService) {
  app.get('/api/app/intake/rules',async c=>c.json({rules:await service.list()}));
  app.get('/api/app/intake/rule-runs',async c=>c.json({runs:await service.runs()}));
  app.post('/api/app/intake/rule-runs/:runId/undo',async c=>{
    const run=ulidSchema.safeParse(c.req.param('runId'));
    if(!run.success)return c.json({error:'Invalid automatic change.'},400);
    return await service.undo(run.data,c.get('operator').id)?c.json({undone:true}):c.json({error:'This automatic change has already ended.'},409);
  });
  app.put('/api/app/intake/rules/:sourceId/:componentId',async c=>{
    const source=ulidSchema.safeParse(c.req.param('sourceId')),component=ulidSchema.safeParse(c.req.param('componentId'));
    const input=alertRuleSchema.safeParse(await c.req.json().catch(()=>null));
    if(!source.success || !component.success || !input.success)return c.json({error:'Invalid alert rule.'},400);
    try {return c.json({rule:await service.save(source.data,component.data,input.data,c.get('operator').id)});}
    catch(cause){return c.json({error:cause instanceof Error?cause.message:'The alert rule could not be saved.'},400);}
  });
  app.delete('/api/app/intake/rules/:sourceId/:componentId',async c=>{
    const source=ulidSchema.safeParse(c.req.param('sourceId')),component=ulidSchema.safeParse(c.req.param('componentId'));
    if(!source.success || !component.success)return c.json({error:'Invalid alert rule.'},400);
    return await service.remove(source.data,component.data,c.get('operator').id)?c.json({erased:true}):c.json({error:'Alert rule not found.'},404);
  });
}
