import { z } from "zod";
import type { Hono } from "hono";
import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import type { SocialService } from "./service";
const accountSchema=z.object({network:z.enum(['x','bluesky','mastodon']),name:z.string().trim().min(1).max(120),prefix:z.string().trim().max(80).default(''),credential:z.string().min(1).max(8192).refine(value=>!/[\r\n\x00]/.test(value)),host:z.string().trim().max(2048).optional(),identifier:z.string().trim().max(320).optional(),scopes:z.array(z.string().max(80)).max(20).default([])}).strict();
export function registerSocialRoutes(app:Hono<AppEnv>,service:SocialService) {
  app.get('/api/app/social',async context=>context.json(await service.list()));
  app.use('/api/app/social/*',async(context,next)=>{
    if(!['owner','admin'].includes(context.get('operatorSession').operator.role))return context.json({error:'An owner or admin must manage social accounts.'},403);
    await next();
  });
  const allowed=(role:string)=>['owner','admin'].includes(role);
  app.post('/api/app/social',async context=>{
    if(!allowed(context.get('operatorSession').operator.role))return context.json({error:'An owner or admin must connect social accounts.'},403);
    const input=accountSchema.safeParse(await context.req.json().catch(()=>null));
    if(!input.success)return context.json({error:'Choose a network, name and its posting credential.'},400);
    try {return context.json({account:await service.add(input.data,context.get('operator').id)},201);}
    catch {return context.json({error:'Social account could not be connected. Check its public HTTPS origin, required posting scope and credential.'},400);}
  });
  app.patch('/api/app/social',async context=>{
    if(!allowed(context.get('operatorSession').operator.role))return context.json({error:'An owner or admin must change social defaults.'},403);
    const input=z.object({postByDefault:z.boolean()}).strict().safeParse(await context.req.json().catch(()=>null));
    if(!input.success)return context.json({error:'Choose whether to post by default.'},400);
    await service.setDefault(input.data.postByDefault);return context.json({postByDefault:input.data.postByDefault});
  });
  app.delete('/api/app/social/:id',async context=>{
    const id=ulidSchema.safeParse(context.req.param('id'));
    return id.success&&await service.remove(id.data,context.get('operator').id)?context.json({removed:true}):context.json({error:'Social account not found.'},404);
  });
}
