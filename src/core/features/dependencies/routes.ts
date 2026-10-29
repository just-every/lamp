import type { Hono } from "hono";
import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import { vendorCatalog } from "./formats/index";
import { followSchema, behaviorSchema, type DependenciesService } from "./service";
export function registerDependencyRoutes(app:Hono<AppEnv>,service:DependenciesService) {
  app.get('/api/app/dependencies',async c=>c.json({dependencies:await service.list(),catalog:vendorCatalog}));
  app.post('/api/app/dependencies',async c=>{
    const input=followSchema.safeParse(await c.req.json().catch(()=>null));if(!input.success)return c.json({error:'Choose valid vendor status settings.'},400);
    try{return c.json({dependency:await service.follow(input.data,c.get('operator').id)},201);}
    catch(cause){return c.json({error:cause instanceof Error?cause.message:'Could not follow this vendor.'},400);}
  });
  app.put('/api/app/dependencies/:id',async c=>{
    const id=ulidSchema.safeParse(c.req.param('id')),input=behaviorSchema.safeParse(await c.req.json().catch(()=>null));
    if(!id.success||!input.success)return c.json({error:'Choose a valid dependency behavior.'},400);
    try{const row=await service.configure(id.data,input.data,c.get('operator').id);return row?c.json({dependency:row}):c.json({error:'Dependency not found.'},404);}
    catch(cause){return c.json({error:cause instanceof Error?cause.message:'Could not configure this dependency.'},400);}
  });
  app.delete('/api/app/dependencies/:id',async c=>{
    const id=ulidSchema.safeParse(c.req.param('id'));if(!id.success)return c.json({error:'Invalid dependency.'},400);
    return await service.remove(id.data,c.get('operator').id)?c.body(null,204):c.json({error:'Dependency not found.'},404);
  });
}
