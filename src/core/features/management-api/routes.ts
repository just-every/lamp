import { z } from "zod";
import type { Hono } from "hono";
import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import { pointsSchema } from "../metrics/schema";
import type { ComponentsService } from "../components/service";
import type { MetricsService } from "../metrics/service";
import type { PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { registerIncidentSubscriptionApiRoutes, statuspageCompatibilityPageId } from "./incident-subscription-routes";
import type { IncidentSubscriptionApiService } from "./incident-subscription-routes";
import { TokenAuthorityError } from "./repository";
import type { ManagementApiService } from "./service";
const createSchema=z.object({name:z.string().trim().min(1).max(80),scopes:z.array(z.enum(["read","metrics:write","subscribers:write","subscribers:read"])).max(4).refine(scopes=>new Set(scopes).size===scopes.length).default([]),expiresInSeconds:z.number().int().min(1).max(365*86400).default(86400)}).strict();
export function registerManagementApiRoutes(app:Hono<AppEnv>,service:ManagementApiService,metrics:MetricsService,limiter:PublicWriteRateLimiter,components:ComponentsService,subscribers?:IncidentSubscriptionApiService) {
  if(subscribers)registerIncidentSubscriptionApiRoutes(app,service,subscribers,limiter);
  app.use("/api/app/management-tokens",async(c,next)=>{
    c.header("Cache-Control","no-store");
    if(!await service.isManager(c.get("operator").id))return c.json({error:"Only an Owner or Admin can manage tokens."},403);
    await next();
  });
  app.use("/api/app/management-tokens/*",async(c,next)=>{
    c.header("Cache-Control","no-store");
    if(!await service.isManager(c.get("operator").id))return c.json({error:"Only an Owner or Admin can manage tokens."},403);
    await next();
  });
  app.get("/api/app/management-tokens",async c=>c.json({tokens:await service.list(),compatibility:{pageId:statuspageCompatibilityPageId}}));
  app.post("/api/app/management-tokens",async c=>{
    const input=createSchema.safeParse(await c.req.json().catch(()=>null));
    if(!input.success)return c.json({error:"Supply a name, read, metrics:write, subscribers:read or subscribers:write scopes, and an expiry of 1 second to 365 days."},400);
    return c.json(await service.create(c.req.raw,input.data,c.get("operator").id,c.get("operatorSession").operator.version),201);
  });
  app.post("/api/app/management-tokens/:id/revoke",async c=>{
    const id=z.uuid().safeParse(c.req.param("id"));
    if(!id.success || !z.object({}).strict().safeParse(await c.req.json().catch(()=>null)).success)return c.json({error:"Supply a valid token ID and an empty revoke request."},400);
    return await service.revoke(id.data,c.get("operator").id,c.get("operatorSession").operator.version)?c.json({revoked:true}):c.json({error:"Active management token not found."},404);
  });
  for (const resource of ["components","metrics"] as const) app.get(`/api/v1/${resource}`,async c=>{
    c.header("Cache-Control","no-store");
    const authenticated=await service.authenticate(c.req.raw);
    if(!authenticated)return c.json({error:"A valid management token is required."},401);
    if(!authenticated.token.scopes.includes("read"))return c.json({error:"The read scope is required."},403);
    if(!await limiter.allow({scope:"management-token",subject:authenticated.authority.id,limit:60})) {
      c.header("Retry-After",String(60-Math.floor(Date.now()/1000)%60));
      return c.json({error:"This token's minute request limit was reached."},429);
    }
    const body=resource === "components"
      ? await Promise.all([components.list(),components.listGroups()]).then(([rows,groups])=>({components:rows,groups}))
      : {metrics:await metrics.list()};
    if(!await service.recordRead(authenticated.authority))return c.json({error:"A valid management token is required."},401);
    return c.json(body);
  });
  app.post("/api/v1/metrics/:id/points",async c=>{
    c.header("Cache-Control","no-store");
    const authenticated=await service.authenticate(c.req.raw);
    if(!authenticated)return c.json({error:"A valid management token is required."},401);
    if(!authenticated.token.scopes.includes("metrics:write"))return c.json({error:"The metrics:write scope is required."},403);
    if(!await limiter.allow({scope:"management-token",subject:authenticated.authority.id,limit:60})) {
      c.header("Retry-After",String(60-Math.floor(Date.now()/1000)%60));
      return c.json({error:"This token's minute request limit was reached."},429);
    }
    const id=ulidSchema.safeParse(c.req.param("id")),input=pointsSchema.safeParse(await c.req.json().catch(()=>null));
    if(!id.success||!input.success)return c.json({error:"Supply UTC minute aggregates as {points:[{at:epochMilliseconds,value:number}]}."},400);
    try{return await metrics.push(id.data,input.data.points,authenticated.authority)?c.json({accepted:input.data.points.length}):c.json({error:"Metric not found."},404);}
    catch(cause){return c.json({error:cause instanceof Error?cause.message:"Metric points could not be saved."},cause instanceof TokenAuthorityError?401:400);}
  });
}
