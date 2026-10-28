import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app/types";
import type { PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { requestNetworkSubject } from "../../platform/security/rate-limiter";
import { formPreferences } from "../subscribers/preferences";
import { ulidSchema } from "../../shared/ids";
import { renderSubscriberTokenPage } from "../subscribers/service";
import { applyPublicIsolationHeaders } from "../public-snapshot/headers";
import { SubscriberLimitError } from "../subscribers/limits";
import { smsCountries } from "./phone";
import { verifyTwilioSignature } from "./twilio";
import type { SmsService } from "./service";
const settingsSchema=z.object({countries:z.array(z.enum(smsCountries)).min(1).max(smsCountries.length).transform(values=>[...new Set(values)]),supportContact:z.string().trim().min(1).max(200)}).strict();
const formSchema=z.object({phone:z.string().max(16),componentId:z.union([ulidSchema,z.array(ulidSchema).max(200)]).optional(),preferencesPresent:z.literal('1').optional(),eventKind:z.union([z.enum(['incidents','maintenance','components']),z.array(z.enum(['incidents','maintenance','components'])).max(3)]).optional(),minimumImpact:z.literal('Partially unavailable').optional()}).strict();
function formResponse(request:Request,pageName:string,title:string,message:string,status:number) {
  const safe=message.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const response=new Response(renderSubscriberTokenPage(title,`<p>${safe}</p><p><a href="/#subscribe">Back to subscriptions</a></p>`,pageName),{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  applyPublicIsolationHeaders(response.headers,new URL(request.url).origin);return response;
}
export function registerSmsRoutes(app:Hono<AppEnv>,service:SmsService,pageName:()=>Promise<string>,authToken:string|undefined,limiter?:PublicWriteRateLimiter) {
  app.post('/subscribe/sms',async context=>{
    const name=await pageName();
    if(context.req.header('Sec-Fetch-Site')==='cross-site')return formResponse(context.req.raw,name,'Subscription unavailable','Cross-site subscription requests are not accepted.',403);
    if(limiter&&!await limiter.allow({scope:'sms-subscribe',subject:requestNetworkSubject(context.req.raw),limit:5}))return formResponse(context.req.raw,name,'Too many requests','Try again in a minute.',429);
    const parsed=formSchema.safeParse(await context.req.parseBody({all:true}));
    if(!parsed.success)return formResponse(context.req.raw,name,'Check your phone number','Enter an E.164 phone number and valid preferences.',400);
    try {
      const ids=parsed.data.componentId===undefined?[]:Array.isArray(parsed.data.componentId)?parsed.data.componentId:[parsed.data.componentId];
      await service.subscribe({phone:parsed.data.phone,componentIds:ids,preferences:formPreferences(parsed.data)},new URL(context.req.url).origin);
      return formResponse(context.req.raw,name,'Check your phone','Reply YES to the opt-in text to activate SMS updates.',202);
    } catch(cause) {return formResponse(context.req.raw,name,'Subscription unavailable',cause instanceof Error?cause.message:'Unable to subscribe.',cause instanceof SubscriberLimitError?409:service.configured()?400:503);}
  });
  for(const kind of ['inbound','status'] as const)app.post(`/api/public/sms/${kind}`,async context=>{
    const raw=await context.req.text(),params=new URLSearchParams(raw);
    if(!await verifyTwilioSignature(authToken,context.req.url,params,context.req.header('X-Twilio-Signature')??null))return context.text('Invalid Twilio signature.',401);
    if(kind==='inbound')await service.inbound(params,new URL(context.req.url).origin);else await service.status(params);
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>',{headers:{'Content-Type':'text/xml; charset=utf-8','Cache-Control':'no-store'}});
  });
  app.get('/api/app/sms/settings',async context=>context.json({settings:await service.settings(),configured:service.configured()}));
  app.put('/api/app/sms/settings',async context=>{
    if(!await service.operatorAllowed(context.get('operator').id))return context.json({error:'Only the owner or an admin can configure SMS.'},403);
    const parsed=settingsSchema.safeParse(await context.req.json().catch(()=>null));
    if(!parsed.success)return context.json({error:'Choose supported countries and a support contact.',issues:parsed.error.issues},400);
    try { await service.updateSettings(parsed.data.countries,parsed.data.supportContact,context.get('operator').id,new Date().toISOString()); }
    catch(cause) { return context.json({error:cause instanceof Error?cause.message:'SMS settings could not be saved.'},400); }
    return context.json({settings:await service.settings(),configured:service.configured()});
  });
  app.get('/api/app/sms/deliveries',async context=>{
    const parsed=ulidSchema.optional().safeParse(context.req.query('incidentUpdateId'));
    if(!parsed.success)return context.json({error:'Invalid update id.'},400);
    return context.json({deliveries:await service.deliveries(parsed.data)});
  });
}
