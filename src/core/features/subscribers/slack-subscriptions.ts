import { formPreferences, defaultPreferences } from "./preferences";
import { applyPublicIsolationHeaders } from "../public-snapshot/headers";
import { createSubscriberLimitRepository } from "./limits.repository";
import { SubscriberLimitError } from "./limits";
import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app/types";
import { createUlid, nowIso, ulidSchema } from "../../shared/ids";
import { hashOpaqueToken } from "../../platform/security/opaque-tokens";
import { requestNetworkSubject, type PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { verifySlack } from "../chat-desk/slack/verify";
import { resolveSlackWebhook } from "../../../../modules/integrations/slack/protocol.ts";
import { sealUrl, sealingSecrets } from "../channels/sealing";
import { createChatSubscriptionRepository } from "./chat.repository";
import { createSubscriberRepository } from "./repository";
import { SubscriberTokenCodec } from "./tokens";
import { renderSubscriberTokenPage } from "./service";

const exchangeSchema = z.object({
  ok: z.literal(true), scope: z.literal("incoming-webhook"), team: z.object({ id: z.string().min(1).max(200) }),
  incoming_webhook: z.object({ channel: z.string().min(1).max(120), channel_id: z.string().min(1).max(200), url: z.url() }),
});
const eventSchema = z.object({ type: z.literal("event_callback"), team_id: z.string().min(1).max(200), event: z.object({ type: z.enum(["app_uninstalled","tokens_revoked"]) }) });
const html = (body: string, status = 200) => new Response(body,{status,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","x-robots-tag":"noindex"}});
const escapeHtml = (s:string) => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

export function createSlackSubscriptionsService(db: D1Database, options: {
  clientId?: string; clientSecret?: string; signingSecret?: string; webhookSecret?: string; tokenSecret?: string;
  pageName: () => Promise<string>; limitsChanged?: () => Promise<void>; unavailable?: string | null;
}) {
  const chat = createChatSubscriptionRepository(db), subscribers = createSubscriberRepository(db), limits=createSubscriberLimitRepository(db);
  const tokens = options.tokenSecret ? new SubscriberTokenCodec(options.tokenSecret) : null;
  return {
    pageName: options.pageName,
    async start(origin: string, componentIds: string[], eventKinds: string[], minimumImpact: "Partially unavailable" | null) {
      await limits.assertAvailable("slack");
      if (options.unavailable || !options.clientId || !options.clientSecret || !options.webhookSecret || !options.signingSecret || !tokens) throw new Error("Slack subscriptions are not configured.");
      const state = `${createUlid()}.${crypto.randomUUID()}`, now = nowIso();
      const valid = new Set((await subscribers.listVisibleComponents()).map(c=>c.id));
      await chat.saveOAuthState(await hashOpaqueToken(state), [...new Set(componentIds)].filter(id=>valid.has(id)), eventKinds,minimumImpact,now,new Date(Date.now()+10*60*1000).toISOString());
      const url = new URL("https://slack.com/oauth/v2/authorize");
      url.searchParams.set("client_id",options.clientId); url.searchParams.set("scope","incoming-webhook");
      url.searchParams.set("redirect_uri",new URL("/subscribe/slack/callback",origin).href); url.searchParams.set("state",state);
      return { url: url.href, state };
    },
    async callback(origin:string, code:string, state:string) {
      if (!options.clientId || !options.clientSecret || !tokens || !code || code.length>2000) throw new Error("Slack subscription could not be confirmed.");
      const saved = await chat.consumeOAuthState(await hashOpaqueToken(state),nowIso());
      if (!saved) throw new Error("This Slack installation request has expired or was already used.");
      const endpoint = new URL("https://slack.com/api/oauth.v2.access");
      const response = await fetch(endpoint,{method:"POST",redirect:"manual",signal:AbortSignal.timeout(10_000),headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:options.clientId,client_secret:options.clientSecret,code,redirect_uri:new URL("/subscribe/slack/callback",origin).href})});
      if (!response.ok || Number(response.headers.get("content-length") ?? 0)>64*1024) throw new Error("Slack did not confirm the installation.");
      const raw=await response.text();
      if(new TextEncoder().encode(raw).length>64*1024)throw new Error("Slack did not confirm the installation.");
      const exchange = exchangeSchema.safeParse(JSON.parse(raw));
      if (!exchange.success) throw new Error("Slack did not grant the required incoming-webhook permission.");
      const data=exchange.data;
      const url = await resolveSlackWebhook(async()=>data.incoming_webhook.url,"oauth");
      const destination = `slack:${await hashOpaqueToken(`${data.team.id}:${data.incoming_webhook.channel_id}`)}`;
      const existing = await chat.findDestination(destination);
      await limits.assertAvailable("slack");
      const id=existing?.id ?? createUlid();
      try {
      if(existing?.state!=="active")await chat.create({id,kind:"slack",name:data.incoming_webhook.channel,sealedUrl:await sealUrl(url,id,sealingSecrets(options.webhookSecret)),host:"hooks.slack.com",destination,componentIds:JSON.parse(saved.componentIdsJson),eventKinds:JSON.parse(saved.eventKindsJson),minimumImpact:saved.minimumImpact,state:"active",teamId:data.team.id,channelId:data.incoming_webhook.channel_id,now:nowIso()});
      } catch(cause) {
        if(cause instanceof Error && cause.message.includes("over the subscriber limit"))throw new SubscriberLimitError();
        throw cause;
      }
      await options.limitsChanged?.();
      const tokenId=createUlid(),candidate=await tokens.encode({id:tokenId,scope:"manage"});
      const stored=await subscribers.ensureToken(id,"manage",{id:tokenId,tokenHash:await tokens.hash(candidate),expiresAt:null},nowIso());
      return stored===tokenId?candidate:tokens.encode({id:stored,scope:"manage"});
    },
    async event(raw:string,headers:Headers) {
      if (!options.signingSecret || !await verifySlack(raw,headers,options.signingSecret)) return false;
      let value:unknown;try{value=JSON.parse(raw);}catch{return false;}
      const challenge=z.object({type:z.literal("url_verification"),challenge:z.string().max(2000)}).safeParse(value);
      if(challenge.success)return {challenge:challenge.data.challenge};
      const event=eventSchema.safeParse(value);
      if(!event.success)return false;
      await chat.deactivateTeam(event.data.team_id,event.data.event.type,nowIso());
      return {};
    },
  };
}
export function registerSlackSubscriptionRoutes(app:Hono<AppEnv>,service:ReturnType<typeof createSlackSubscriptionsService>,rateLimiter?:PublicWriteRateLimiter){
  const isolation:MiddlewareHandler<AppEnv>=async(c,next)=>{await next();applyPublicIsolationHeaders(c.res.headers,new URL(c.req.url).origin);c.res.headers.set("Cache-Control","no-store");c.res.headers.set("Referrer-Policy","no-referrer");};
  app.use("/subscribe/slack",isolation);app.use("/subscribe/slack/*",isolation);
  app.post("/subscribe/slack",async c=>{
    const pageName=await service.pageName();
    if(c.req.header("Sec-Fetch-Site")==="cross-site")return c.text("Cross-site subscription requests are not accepted.",403);
    if(rateLimiter&&!await rateLimiter.allow({scope:"subscribe",subject:requestNetworkSubject(c.req.raw),limit:5}))return c.text("Too many subscription requests.",429);
    const body=await c.req.parseBody({all:true}),values=(v:unknown)=>Array.isArray(v)?v: v===undefined?[]:[v];
    try{
      const ids=z.array(ulidSchema).max(200).parse(values(body.componentId));
      const preferences=formPreferences(body) ?? defaultPreferences("slack");
      const started=await service.start(new URL(c.req.url).origin,ids,preferences.eventKinds,preferences.minimumImpact);
      c.header("Cache-Control","no-store");return c.redirect(started.url,303);
    }catch(error){if(error instanceof z.ZodError)return html(renderSubscriberTokenPage("Subscription unavailable","<p>Choose valid components and update preferences.</p>",pageName),400);if(error instanceof SubscriberLimitError)return html(renderSubscriberTokenPage("Subscriptions full",`<p>${error.message}</p><p><a href="/feed.atom">Atom feed</a> · <a href="/feed.rss">RSS feed</a></p>`,pageName),409);return html(renderSubscriberTokenPage("Slack unavailable","<p>Slack subscriptions are not configured for this page.</p>",pageName),503);}
  });
  app.get("/subscribe/slack/callback",async c=>{
    const pageName=await service.pageName(),state=c.req.query("state")??"";
    if(!state)return html(renderSubscriberTokenPage("Subscription unavailable","<p>The Slack installation request could not be verified.</p>",pageName),400);
    try{const token=await service.callback(new URL(c.req.url).origin,c.req.query("code")??"",state);return html(renderSubscriberTokenPage("Slack subscription active",`<p>Your channel will receive the selected updates.</p><p><a href="/manage/${escapeHtml(token)}">Manage subscription</a></p>`,pageName),200);}
    catch(error){if(error instanceof SubscriberLimitError)return html(renderSubscriberTokenPage("Subscriptions full",`<p>${error.message}</p><p><a href="/feed.atom">Atom feed</a> · <a href="/feed.rss">RSS feed</a></p>`,pageName),409);return html(renderSubscriberTokenPage("Subscription unavailable","<p>Slack did not confirm the installation. Start again from the subscribe form.</p>",pageName),400);}
  });
  app.post("/subscribe/slack/events",async c=>{
    const raw=await c.req.text();if(new TextEncoder().encode(raw).length>64*1024)return c.text("Request too large.",413);
    const result=await service.event(raw,c.req.raw.headers);return result?c.json(result):c.text("The Slack request could not be authenticated.",401);
  });
}
