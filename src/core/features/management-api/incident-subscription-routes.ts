import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import type { Context, Hono } from "hono";
import type { AppEnv } from "../../app/types";
import type { PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { ulidSchema } from "../../shared/ids";
import { SubscriberLimitError } from "../subscribers/limits";
import { tokenFence, TokenAuthorityError } from "./repository";
import type { ManagementApiService } from "./service";

const createSchema = z.discriminatedUnion("channel", [
  z.object({ channel:z.literal("email"), email:z.email(), includeReport:z.boolean().optional() }).strict(),
  z.object({ channel:z.literal("webhook"), destination:z.url(), contactEmail:z.email(), includeReport:z.boolean().optional() }).strict(),
  z.object({ channel:z.literal("sms"), phone:z.string().min(5).max(32), includeReport:z.boolean().optional() }).strict(),
]);
const querySchema = z.object({limit:z.coerce.number().int().min(1).max(100).default(100),offset:z.coerce.number().int().min(0).max(1_000_000).default(0)}).strict();
const compatibilityQuery = z.object({limit:z.coerce.number().int().min(1).max(100).default(100),page:z.coerce.number().int().min(1).max(10_001).default(1)}).strict();
export const statuspageCompatibilityPageId = "default";
type Authority = {sql:string;params:(string|number|null)[]};
interface Subscriber {id:string;channel:string;destination:string;state:string;contactEmail?:string|null;createdAt:string}
export interface IncidentSubscriptionApiService {
  incidents: {
    request(input:z.infer<typeof createSchema>&{incidentId:string},origin:string,operatorId?:string,authority?:Authority):Promise<{subscriberId:string;created:boolean}>;
    list(incidentId:string,limit?:number,offset?:number):Promise<Subscriber[]>;
    remove(incidentId:string,subscriberId:string,operatorId:string,authority?:Authority):Promise<boolean>;
  };
}
function compatibilityView(row:Subscriber) {
  return {id:row.id,mode:row.channel,...(row.channel==="email"?{email:row.destination}:row.channel==="sms"?{phone_number:row.destination}:{endpoint:row.destination,email:row.contactEmail}),created_at:row.createdAt,pending:row.state==="pending"};
}
/** The edition has one page: page_settings.id is "default". Compatibility
 * identifiers are local incident and subscriber IDs, not IDs from a former host. */
export function registerIncidentSubscriptionApiRoutes(app:Hono<AppEnv>,management:ManagementApiService,subscribers:IncidentSubscriptionApiService,limiter:PublicWriteRateLimiter) {
  for(const compatible of [false,true]) {
    const path=compatible?"/v1/pages/:pageId/incidents/:incidentId/subscribers":"/api/v1/incidents/:incidentId/subscribers";
    const execute=async(c:Context<AppEnv>,operation:"list"|"create"|"delete")=>{
      c.header("Cache-Control","no-store");
      const incoming=c.req.raw;
      const authorization=incoming.headers.get("Authorization");
      const request=compatible && authorization?.startsWith("OAuth ")?new Request(incoming.url,{headers:new Headers(incoming.headers)}):incoming;
      if(request!==incoming)request.headers.set("Authorization",`Bearer ${authorization!.slice(6)}`);
      const authenticated=await management.authenticate(request);
      if(!authenticated)return c.json({error:"A valid management token is required."},401);
      const scope=operation==="list"?"read":"subscribers:write";
      if(!authenticated.token.scopes.includes(scope))return c.json({error:`The ${scope} scope is required.`},403);
      if(!await limiter.allow({scope:"management-token",subject:authenticated.authority.id,limit:60})) {
        c.header("Retry-After",String(60-Math.floor(Date.now()/1000)%60));
        return c.json({error:"This token's minute request limit was reached."},429);
      }
      if(compatible && c.req.param("pageId")!==statuspageCompatibilityPageId)return c.json({error:"Page not found. This edition's page ID is default."},404);
      const incidentId=ulidSchema.safeParse(c.req.param("incidentId"));
      if(!incidentId.success)return c.json({error:"Expected a canonical incident ID."},400);
      try {
        if(operation==="list") {
          let limit:number,offset:number;
          if(compatible) {
            const query=compatibilityQuery.safeParse(c.req.query());
            if(!query.success)return c.json({error:"Invalid subscriber query."},400);
            limit=query.data.limit;offset=(query.data.page-1)*limit;
          } else {
            const query=querySchema.safeParse(c.req.query());
            if(!query.success)return c.json({error:"Invalid subscriber query."},400);
            ({limit,offset}=query.data);
          }
          const rows=await subscribers.incidents.list(incidentId.data,limit+1,offset);
          if(!await management.recordRead(authenticated.authority))return c.json({error:"A valid management token is required."},401);
          return compatible?c.json(rows.slice(0,limit).map(compatibilityView)):c.json({subscribers:rows.slice(0,limit),limit,offset,hasMore:rows.length>limit});
        }
        const authority=tokenFence(authenticated.authority,"subscribers:write");
        if(operation==="delete") {
          const id=ulidSchema.safeParse(c.req.param("subscriberId"));
          if(!id.success)return c.json({error:"Expected a canonical subscriber ID."},400);
          const removed=await subscribers.incidents.remove(incidentId.data,id.data,authenticated.authority.personId,authority);
          if(!removed)return c.json({error:"Incident subscription not found."},404);
          if(!await management.recordRead(authenticated.authority,"subscribers:write"))return c.json({error:"A valid management token is required."},401);
          return c.body(null,204);
        }
        const input=createSchema.safeParse(compatible?await compatibilityInput(incoming):await c.req.json().catch(()=>null));
        if(!input.success)return c.json({error:"Supply an email, SMS phone number, or webhook destination and contact email.",issues:input.error.issues},compatible?422:400);
        const result=await subscribers.incidents.request({...input.data,incidentId:incidentId.data},new URL(c.req.url).origin,authenticated.authority.personId,authority);
        if(!await management.recordRead(authenticated.authority,"subscribers:write"))return c.json({error:"A valid management token is required."},401);
        return c.json(compatible?{id:result.subscriberId,mode:input.data.channel,pending:true}:result,result.created?201:200);
      } catch(cause) {
        const status=cause instanceof TokenAuthorityError?401:cause instanceof SubscriberLimitError?409:typeof cause==="object"&&cause!==null&&"status" in cause&&cause.status===404?404:400;
        return c.json({error:cause instanceof Error?cause.message:"The incident subscription request failed."},status);
      }
    };
    app.get(path,c=>execute(c,"list"));
    app.post(path,bodyLimit({maxSize:16_384,onError:c=>c.json({error:"Subscriber input is too large."},413)}),c=>execute(c,"create"));
    app.delete(`${path}/:subscriberId`,c=>execute(c,"delete"));
  }
}
async function compatibilityInput(request:Request) {
  let body:Record<string,unknown>;
  if(request.headers.get("Content-Type")?.includes("application/json")) {
    const raw=await request.json().catch(()=>null);
    if(!raw||typeof raw!=="object")return null;
    const object=raw as Record<string,unknown>;
    const candidate=object.subscriber??object;
    if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))return null;
    body=candidate as Record<string,unknown>;
  } else {
    const form=await request.formData().catch(()=>null);
    if(!form)return null;
    body=Object.fromEntries([...form].map(([key,value])=>[key.replace(/^subscriber\[([^\]]+)\]$/u,"$1"),value]));
  }
  if(body.mode!==undefined && !["email","sms","webhook"].includes(String(body.mode)))return null;
  const includeReport=body.include_report===undefined?undefined:body.include_report===true||body.include_report==="true";
  if(body.include_report!==undefined && ![true,false,"true","false"].includes(body.include_report as boolean|string))return null;
  if(body.mode==="sms"||body.phone_number)return {channel:"sms",phone:body.phone_number,includeReport};
  if(body.mode==="webhook"||body.endpoint)return {channel:"webhook",destination:body.endpoint,contactEmail:body.email,includeReport};
  return {channel:"email",email:body.email,includeReport};
}
