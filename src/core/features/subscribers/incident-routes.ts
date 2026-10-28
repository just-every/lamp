import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app/types";
import { ulidSchema } from "../../shared/ids";
import { requestNetworkSubject, type PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { MailUnavailableError } from "../../platform/mail";
import { SubscriberLimitError } from "./limits";
import { IncidentSubscriptionUnavailableError } from "./incident.repository";
import { renderSubscriberTokenPage, type SubscribersService } from "./service";

const incidentFollowSchema=z.discriminatedUnion("channel",[
  z.object({incidentId:ulidSchema,channel:z.literal("email"),email:z.email()}).strict(),
  z.object({incidentId:ulidSchema,channel:z.literal("webhook"),destination:z.url(),contactEmail:z.email()}).strict(),
  z.object({incidentId:ulidSchema,channel:z.literal("sms"),phone:z.string().regex(/^\+[1-9]\d{6,14}$/)}).strict(),
]);
const listSchema=z.object({limit:z.coerce.number().int().min(1).max(100).default(100),offset:z.coerce.number().int().min(0).max(1_000_000_000).default(0)}).strict();
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]??c);

export function registerIncidentSubscriberRoutes(app:Hono<AppEnv>,service:SubscribersService,options:{
  rateLimiter?:PublicWriteRateLimiter;
  response:(request:Request,body:string,status?:number)=>Response;
  full:(request:Request,pageName:string)=>Response;
}) {
  app.post("/subscribe/incident",async context=>{
    const pageName=await service.getPageName();
    const result=(title:string,message:string,status:number)=>options.response(context.req.raw,renderSubscriberTokenPage(title,`<p>${message}</p><p><a href="/">See current status</a></p>`,pageName),status);
    if(context.req.header("Sec-Fetch-Site")==="cross-site")return result("Subscription unavailable","Cross-site subscription requests are not accepted.",403);
    if(options.rateLimiter&&!await options.rateLimiter.allow({scope:"subscribe",subject:requestNetworkSubject(context.req.raw),limit:5}))return result("Too many requests","Too many subscription requests. Try again in a minute.",429);
    const input=incidentFollowSchema.safeParse(await context.req.parseBody({all:true}));
    if(!input.success)return result("Check your subscription","Choose a valid incident, channel and address.",400);
    try {
      const incident=await service.requestIncidentSubscription(input.data,new URL(context.req.url).origin);
      return result(input.data.channel==="sms"?"Check your messages":"Check your inbox",`Check your ${input.data.channel==="sms"?"messages":"email"} to confirm or manage this subscription. Following ${escapeHtml(incident.reference)} only.`,202);
    } catch(cause) {
      if(cause instanceof SubscriberLimitError)return options.full(context.req.raw,pageName);
      if(cause instanceof IncidentSubscriptionUnavailableError)return result("Subscription unavailable","This incident is unavailable.",404);
      if(cause instanceof MailUnavailableError || cause instanceof Error&&cause.message.includes("not configured"))return result("Subscriptions unavailable","Subscriptions are not configured for this channel.",503);
      if(cause instanceof Error&&/Webhook destinations|phone|country|number/i.test(cause.message))return result("Check your subscription",escapeHtml(cause.message),400);
      throw cause;
    }
  });
  app.get("/api/app/incidents/:incidentId/subscribers",async context=>{
    const id=ulidSchema.safeParse(context.req.param("incidentId")),query=listSchema.safeParse(context.req.query());
    if(!id.success||!query.success)return context.json({error:"Choose a valid incident and subscriber page."},400);
    const rows=await service.listIncident(id.data,query.data.limit+1,query.data.offset);
    context.header("Cache-Control","private, no-store");
    return context.json({subscribers:rows.slice(0,query.data.limit),...query.data,hasMore:rows.length>query.data.limit});
  });
}
