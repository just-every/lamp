import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings,AppEnv } from '../../app/types';
import { sessionAuthority } from '../../platform/auth/authority';
import { createMailSettingsRepository } from '../../platform/mail/settings.repository';
const schema=z.object({secondaryProvider:z.enum(['resend','sendgrid','mailgun','ses','postmark']).nullable()}).strict();

export function registerMailSettings(app:Hono<AppEnv>,bindings:AppBindings){
  const repository=createMailSettingsRepository(bindings.DB);
  const configured=bindings.MAIL_SECONDARY_PROVIDER&&bindings.MAIL_SECONDARY_API_KEY?bindings.MAIL_SECONDARY_PROVIDER:null;
  const current=async()=>({primaryProvider:bindings.MAIL_PROVIDER||'resend',configuredSecondaryProvider:configured,secondaryProvider:(await repository.selected())===configured?configured:null});
  app.get('/api/app/mail-settings',async c=>{c.header('Cache-Control','private, no-store');return c.json(await current());});
  app.patch('/api/app/mail-settings',async c=>{
    const input=schema.safeParse(await c.req.json().catch(()=>null));
    if(!input.success||input.data.secondaryProvider!==null&&input.data.secondaryProvider!==configured)return c.json({error:'Choose the connected secondary provider or None.'},400);
    if(!await repository.select(input.data.secondaryProvider,sessionAuthority(c.get('operatorSession'))))return c.json({error:'An active owner session is required.'},403);
    c.header('Cache-Control','private, no-store');return c.json(await current());
  });
}
