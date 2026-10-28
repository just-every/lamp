import { SubscriberLimitError } from "./limits";
import type { Hono, Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AppEnv } from "../../app/types";
import { notificationOrigin } from "../../app/mail";
import { MailUnavailableError } from "../../platform/mail";
import { ulidSchema } from "../../shared/ids";
import { SubscriberIntakeError, subscriberAddSchema } from "./intake-schema";
import type { SubscribersService } from "./service";

const preview=z.object({csv:z.string().min(1)}).strict();
const apply=preview.extend({reviewedFingerprint:z.string().min(1).max(256)}).strict();
const empty=z.object({}).strict();

function failure(context:Context<AppEnv>,cause:unknown) {
  if(cause instanceof SubscriberLimitError)return context.json({error:cause.message},409);
  if(cause instanceof SubscriberIntakeError)return context.json({error:cause.message},cause.status);
  if(cause instanceof MailUnavailableError)return context.json({error:"Confirmation mail is not configured."},503);
  // Raw transport exceptions can carry a destination. Never return or log it.
  return context.json({error:"Subscriber intake could not complete. No existing subscription was changed."},503);
}

export function registerSubscriberIntakeRoutes(app:Hono<AppEnv>,service:SubscribersService) {
  // A JSON escape can occupy six bytes per CSV character; the decoded CSV is
  // separately bounded to the same 8 MiB as the existing source imports.
  app.use("/api/app/subscribers/import/*",bodyLimit({maxSize:50*1024*1024,onError:context=>context.json({error:"The CSV request is too large."},413)}));
  app.use("/api/app/subscribers/import/*",async(context,next)=>{
    if(context.req.header("Sec-Fetch-Site")==="cross-site")return context.json({error:"Cross-site subscriber intake is not accepted."},403);
    await next();
  });
  app.get("/api/app/subscribers/import/batches",async context=>{
    if(!empty.safeParse(context.req.query()).success)return context.json({error:"Invalid subscriber import query."},400);
    try{return context.json({batches:await service.intake.batches(context.get("operator").id)});}catch(cause){return failure(context,cause);}
  });
  app.post("/api/app/subscribers/import/preview",async context=>{
    const parsed=preview.safeParse(await context.req.json().catch(()=>null));
    if(!parsed.success)return context.json({error:"Choose a CSV file."},400);
    try{return context.json(await service.intake.preview(parsed.data.csv));}catch(cause){return failure(context,cause);}
  });
  app.post("/api/app/subscribers/import/apply",async context=>{
    const parsed=apply.safeParse(await context.req.json().catch(()=>null));
    if(!parsed.success)return context.json({error:"A CSV and its reviewed fingerprint are required."},400);
    try{return context.json(await service.intake.apply(parsed.data.csv,parsed.data.reviewedFingerprint,context.get("operator").id));}catch(cause){return failure(context,cause);}
  });
  app.post("/api/app/subscribers/import/:batchId/send-invitations",async context=>{
    const batchId=ulidSchema.safeParse(context.req.param("batchId"));
    const parsed=empty.safeParse(await context.req.json().catch(()=>null));
    if(!batchId.success||!parsed.success)return context.json({error:"Choose a subscriber import and an empty invitation action."},400);
    if(context.env.EFFECTS_PAUSED==="1")return context.json({error:"Outbound effects are paused."},409);
    try{return context.json(await service.intake.sendInvitations(batchId.data,context.get("operator").id,await notificationOrigin(context.env)));}catch(cause){return failure(context,cause);}
  });
  app.get("/api/app/subscribers.csv",async context=>{
    if(!empty.safeParse(context.req.query()).success)return context.json({error:"Invalid subscriber export query."},400);
    try{return context.body(await service.intake.exportCsv(),200,{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="subscribers.csv"',"Cache-Control":"no-store"});}catch(cause){return failure(context,cause);}
  });
  app.post("/api/app/subscribers",bodyLimit({maxSize:16_384,onError:context=>context.json({error:"Subscriber input is too large."},413)}),async context=>{
    if(context.req.header("Sec-Fetch-Site")==="cross-site")return context.json({error:"Cross-site subscriber intake is not accepted."},403);
    const parsed=subscriberAddSchema.safeParse(await context.req.json().catch(()=>null));
    if(!parsed.success)return context.json({error:"Choose a valid email, phone number or public webhook, contact address and components."},400);
    if(context.env.EFFECTS_PAUSED==="1")return context.json({error:"Outbound effects are paused."},409);
    try{const result=await service.intake.add(parsed.data,context.get("operator").id,await notificationOrigin(context.env));return context.json(result,result.created?201:200);}catch(cause){return failure(context,cause);}
  });
}
