import { z } from "zod";
import type { Hono } from "hono";
import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import { pointsSchema } from "../metrics/schema";
import type { ComponentsService } from "../components/service";
import type { MetricsService } from "../metrics/service";
import type { PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { TokenAuthorityError } from "./repository";
import type { ManagementApiService } from "./service";
import type { CallResult } from '../../../base/modules/agent-door/types.ts';
const createSchema=z.object({name:z.string().trim().min(1).max(80),scopes:z.array(z.enum(["read","metrics:write"])).max(2).refine(scopes=>new Set(scopes).size===scopes.length).default([]),expiresInSeconds:z.number().int().min(1).max(365*86400).default(86400)}).strict();
export function registerManagementApiRoutes(app:Hono<AppEnv>,service:ManagementApiService,_metrics:MetricsService,limiter:PublicWriteRateLimiter,_components:ComponentsService,invoke:(request:Request,name:string,args:Record<string,unknown>)=>Promise<CallResult>) {
  const response = (result: CallResult) => result.outcome === 'done'
    ? Response.json(result.result, { headers: { 'Cache-Control': 'no-store' } })
    : Response.json({ code: result.code ?? 'approval_required', ...result }, { status: result.outcome === 'pending' ? 202 : result.code === 'unauthenticated' ? 401 : result.code === 'insufficient_scope' ? 403 : 409, headers: { 'Cache-Control': 'no-store' } });
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
  app.get("/api/app/management-tokens",async c=>c.json({tokens:await service.list()}));
  app.post("/api/app/management-tokens",async c=>{
    const input=createSchema.safeParse(await c.req.json().catch(()=>null));
    if(!input.success)return c.json({error:"Supply a name, read and/or metrics:write scopes, and an expiry of 1 second to 365 days."},400);
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
    const admitted=await invoke(c.req.raw,resource==='components'?'lamp.components.list':'lamp.metrics.read',{});
    if(admitted.outcome!=='done')return response(admitted);
    if(!await service.recordRead(authenticated.authority))return c.json({error:"A valid management token is required."},401);
    return response(admitted);
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
    try{
      const bytes=new TextEncoder().encode(JSON.stringify([authenticated.token.id,id.data,input.data.points]));
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(value=>value.toString(16).padStart(2,'0')).join('');
      return response(await invoke(c.req.raw,'lamp.metrics.push',{id:id.data,...input.data,idempotency_key:c.req.header('Idempotency-Key')??`management:${digest}`}));
    }
    catch(cause){return c.json({error:cause instanceof Error?cause.message:"Metric points could not be saved."},cause instanceof TokenAuthorityError?401:400);}
  });
}
