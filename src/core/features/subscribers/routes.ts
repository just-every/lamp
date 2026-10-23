import type { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../../app/types";
import { MailUnavailableError } from "../../platform/mail";
import { requestNetworkSubject, type PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { ulidSchema } from "../../shared/ids";
import { applyPublicIsolationHeaders } from "../public-snapshot/headers";
import { renderSubscribeResult, renderSubscriberManagementPage, renderSubscriberTokenPage, type SubscribersService } from "./service";
import { registerSubscriberIntakeRoutes } from "./intake-routes";
import { webhookFormatSchema } from "./webhook-format";

const subscriberQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
}).strict();
const emailSchema = z.object({ email: z.email() }).strict();
const webhookSchema = z.object({ destination: z.url(), contactEmail: z.email(), componentIds: z.array(ulidSchema).max(200).default([]),webhookFormat:webhookFormatSchema.optional() }).strict();
const managementSchema=z.object({componentId:z.union([ulidSchema,z.array(ulidSchema).max(200)]).optional(),webhookFormat:webhookFormatSchema.optional()}).strict();

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function tokenHeaders(headers: Headers) {
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex");
  headers.set("Cache-Control", "no-store");
}

function tokenResponse(request: Request, body: string, status = 200) {
  const response = new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
  applyPublicIsolationHeaders(response.headers, new URL(request.url).origin);
  tokenHeaders(response.headers);
  return response;
}

function publicFormResponse(request: Request, title: string, message: string, status: number, pageName: string) {
  if (request.headers.get("Accept")?.includes("text/html")) {
    return tokenResponse(request, renderSubscriberTokenPage(title, `<p>${message}</p><p><a href="/#subscribe">Back to the subscribe form</a></p>`, pageName), status);
  }
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function allowedTokenRequest(context: { req: { raw: Request } }, limiter: PublicWriteRateLimiter | undefined, scope: string, token: string, pageName: string) {
  if (!limiter || await limiter.allow({ scope, subject: token, limit: 30 })) return null;
  const response = publicFormResponse(context.req.raw, "Too many requests", "Too many requests for this subscription link. Try again in a minute.", 429, pageName);
  tokenHeaders(response.headers);
  return response;
}

function parsedComponentIds(value: unknown) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.filter((entry): entry is string => typeof entry === "string").flatMap((entry) => {
    const result = ulidSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

export function registerSubscriberRoutes(app: Hono<AppEnv>, service: SubscribersService, options: { rateLimiter?: PublicWriteRateLimiter } = {}) {
  registerSubscriberIntakeRoutes(app,service);
  app.post("/subscribe", async (context) => {
    const pageName = await service.getPageName();
    const result = (title: string, message: string, status: number) => publicFormResponse(context.req.raw, title, message, status, pageName);
    if (context.req.header("Sec-Fetch-Site") === "cross-site") return result("Subscription unavailable", "Cross-site subscription requests are not accepted.", 403);
    if (options.rateLimiter && !(await options.rateLimiter.allow({ scope: "subscribe", subject: requestNetworkSubject(context.req.raw), limit: 5 }))) return result("Too many requests", "Too many subscription requests. Try again in a minute.", 429);
    // all: true keeps every ticked componentId; without it Hono keeps only the last one.
    const body = await context.req.parseBody({ all: true });
    const parsed = emailSchema.safeParse({ email: body.email });
    if (!parsed.success) return result("Check your email address", "Enter a valid email address.", 400);
    try {
      const componentIds = parsedComponentIds(body.componentId);
      await service.requestEmailSubscription(parsed.data.email, new URL(context.req.url).origin, componentIds);
      // Preserve the same response for active, pending and suppressed requests.
      if (!context.req.header("Accept")?.includes("text/html")) return result("Check your inbox", "Check your email to confirm or manage this subscription.", 202);
      return tokenResponse(context.req.raw, renderSubscribeResult({ email: parsed.data.email, components: await service.componentNames(componentIds) }, pageName), 202);
    } catch (error) {
      if (error instanceof MailUnavailableError) return result("Subscriptions unavailable", "Subscriptions are not configured because this deployment has no mail sender. No confirmation email was sent.", 503);
      throw error;
    }
  });
  app.get("/confirm-subscription/:token", async (context) => {
    const pageName = await service.getPageName();
    const limited = await allowedTokenRequest(context, options.rateLimiter, "subscription-confirm", context.req.param("token") ?? "", pageName);
    if (limited) return limited;
    const confirmed = await service.confirm(context.req.param("token") ?? "");
    return tokenResponse(context.req.raw, confirmed ? renderSubscriberTokenPage("Subscription confirmed", `<p>You'll get ${escapeHtml(pageName)} updates through this subscription.</p><p><a href="/">See current status</a></p>`, pageName, "done") : renderSubscriberTokenPage("Subscription unavailable", "<p>This confirmation link is invalid or has expired.</p>", pageName), confirmed ? 200 : 404);
  });
  app.get("/manage/:token", async (context) => {
    const pageName = await service.getPageName();
    const token = context.req.param("token") ?? "";
    const limited = await allowedTokenRequest(context, options.rateLimiter, "subscription-manage", token, pageName);
    if (limited) return limited;
    const managed = await service.getManagedSubscription(token);
    return managed ? tokenResponse(context.req.raw, renderSubscriberManagementPage(managed, pageName)) : tokenResponse(context.req.raw, renderSubscriberTokenPage("Subscription unavailable", "<p>This subscription link is invalid or no longer active.</p>", pageName), 404);
  });
  app.post("/manage/:token", async (context) => {
    const pageName = await service.getPageName();
    const token = context.req.param("token") ?? "";
    const limited = await allowedTokenRequest(context, options.rateLimiter, "subscription-manage", token, pageName);
    if (limited) return limited;
    const parsed=managementSchema.safeParse(await context.req.parseBody({all:true}));
    if(!parsed.success)return tokenResponse(context.req.raw,renderSubscriberTokenPage("Subscription unavailable","<p>Choose valid components and a supported webhook format.</p>",pageName),400);
    const updated = await service.updateManagedSelection(token, parsedComponentIds(parsed.data.componentId),parsed.data.webhookFormat);
    return updated ? tokenResponse(context.req.raw, renderSubscriberTokenPage("Subscription updated", "<p>Your selection is saved.</p><p><a href=\"/\">See current status</a></p>", pageName, "done")) : tokenResponse(context.req.raw, renderSubscriberTokenPage("Subscription unavailable", "<p>This subscription link is invalid or no longer active.</p>", pageName), 404);
  });
  app.get("/unsubscribe/:token", async (context) => {
    const pageName = await service.getPageName();
    const limited = await allowedTokenRequest(context, options.rateLimiter, "subscription-unsubscribe", context.req.param("token") ?? "", pageName);
    return limited ?? tokenResponse(context.req.raw, renderSubscriberTokenPage("Unsubscribe", "<form method=\"post\"><input type=\"hidden\" name=\"action\" value=\"unsubscribe\"><button type=\"submit\">Unsubscribe</button></form>", pageName));
  });
  app.post("/unsubscribe/:token", async (context) => {
    const pageName = await service.getPageName();
    const limited = await allowedTokenRequest(context, options.rateLimiter, "subscription-unsubscribe", context.req.param("token") ?? "", pageName);
    if (limited) return limited;
    const form = await context.req.parseBody();
    const oneClick = form["List-Unsubscribe"] === "One-Click";
    const accepted = oneClick || form.action === "unsubscribe";
    const unsubscribed = accepted && await service.unsubscribe(context.req.param("token") ?? "");
    if (!oneClick && context.req.header("Accept")?.includes("text/html")) {
      return tokenResponse(context.req.raw, renderSubscriberTokenPage(unsubscribed ? "Unsubscribed" : "Subscription unavailable", unsubscribed
        ? "<p>You won't get status updates any more.</p><p><a href=\"/#subscribe\">Subscribe again</a></p>"
        : "<p>This subscription link is invalid or no longer active.</p>", pageName), unsubscribed ? 200 : 404);
    }
    const response = new Response(unsubscribed ? "" : "Subscription link is invalid or no longer active.", { status: unsubscribed ? 200 : 404 });
    tokenHeaders(response.headers);
    return response;
  });

  app.get("/api/app/subscribers", async (context) => {
    const parsed = subscriberQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return context.json({ error: "Invalid subscriber query.", issues: parsed.error.issues }, 400);
    const rows = await service.list(parsed.data.limit + 1, parsed.data.offset);
    return context.json({
      subscribers: rows.slice(0, parsed.data.limit),
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      hasMore: rows.length > parsed.data.limit,
    });
  });
  app.post("/api/app/subscribers/webhook", async (context) => {
    const parsed = webhookSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Invalid webhook subscription.", issues: parsed.error.issues }, 400);
    try { return context.json({ subscriber: await service.createWebhookSubscription(parsed.data) }, 201); }
    catch (error) { return context.json({ error: error instanceof Error ? error.message : "Unable to create subscriber." }, 400); }
  });
  app.delete("/api/app/subscribers/:subscriberId", async (context) => {
    const subscriberId = ulidSchema.safeParse(context.req.param("subscriberId"));
    if (!subscriberId.success) return context.json({ error: "Expected a canonical subscriber ID." }, 400);
    return (await service.deleteSubscriber(subscriberId.data, context.get("operator").id)) ? context.body(null, 204) : context.json({ error: "Subscriber not found." }, 404);
  });
}
