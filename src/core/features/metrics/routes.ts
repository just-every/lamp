import type { Hono } from "hono";
import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import { metricSchema,metricPatchSchema,pointsSchema } from "./schema";
import type { MetricsService } from "./service";
export function registerMetricsRoutes(app:Hono<AppEnv>,service:MetricsService) {
  app.use("/api/app/metrics/*",async(c,next)=>{
    if(!await service.authorize(c.get("operator").id)) return c.json({error:"Only an Owner or Admin can manage public metrics."},403);
    await next();
  });
  app.get("/api/app/metrics",async c=>{
    const componentId=c.req.query("componentId"),sourceId=c.req.query("sourceId");
    if([componentId,sourceId].some(id=>id&&!ulidSchema.safeParse(id).success)) return c.json({error:"Invalid metric filter."},400);
    return c.json({metrics:await service.list(componentId,sourceId)});
  });
  app.post("/api/app/metrics",async c=>{
    const input=metricSchema.safeParse(await c.req.json().catch(()=>null));
    if(!input.success) return c.json({error:"Invalid metric configuration.",issues:input.error.issues},400);
    try{return c.json({metric:await service.create(input.data,c.get("operator").id)},201);}
    catch(cause){return c.json({error:cause instanceof Error?cause.message:"The metric could not be added."},400);}
  });
  app.put("/api/app/metrics/:id",async c=>{
    const id=ulidSchema.safeParse(c.req.param("id")),input=metricPatchSchema.safeParse(await c.req.json().catch(()=>null));
    if(!id.success||!input.success)return c.json({error:"Invalid metric change."},400);
    try { const metric=await service.update(id.data,input.data,c.get("operator").id);return metric?c.json({metric}):c.json({error:"Metric not found."},404); }
    catch(cause){return c.json({error:cause instanceof Error?cause.message:"The metric could not be changed."},400);}
  });
  app.delete("/api/app/metrics/:id",async c=>{
    const id=ulidSchema.safeParse(c.req.param("id"));if(!id.success)return c.json({error:"Invalid metric ID."},400);
    return await service.remove(id.data,c.get("operator").id)?c.json({removed:true}):c.json({error:"Metric not found."},404);
  });
  app.post("/api/app/metrics/:id/points",async c=>{
    const id=ulidSchema.safeParse(c.req.param("id")),input=pointsSchema.safeParse(await c.req.json().catch(()=>null));
    if(!id.success||!input.success)return c.json({error:"Supply UTC minute aggregates as {points:[{at:epochMilliseconds,value:number}]}."},400);
    try{return await service.push(id.data,input.data.points)?c.json({accepted:input.data.points.length}):c.json({error:"Metric not found."},404);}
    catch(cause){return c.json({error:cause instanceof Error?cause.message:"Metric points could not be saved."},400);}
  });
}
