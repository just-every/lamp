import type { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../../app/types";
import { MailUnavailableError } from "../../platform/mail";
import { requestNetworkSubject, type PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { ulidSchema } from "../../shared/ids";
import { applyPublicIsolationHeaders } from "../public-snapshot/headers";
import { renderSubscriberManagementPage, renderSubscriberTokenPage, type SubscribersService } from "./service";

const subscriberQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
}).strict();
const emailSchema = z.object({ email: z.email() }).strict();
const webhookSchema = z.object({ destination: z.url(), contactEmail: z.email(), componentIds: z.array(ulidSchema).max(200).default([]) }).strict();

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

function publicFormResponse(request: Request, title: string, message: string, status: number) {
  if (request.headers.get("Accept")?.includes("text/html")) {
    return tokenResponse(request, renderSubscriberTokenPage(title, `<p>${message}</p><p><a href="/#subscribe">Return to subscriptions</a></p>`), status);
  }
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function allowedTokenRequest(context: { req: { raw: Request } }, limiter: PublicWriteRateLimiter | undefined, scope: string, token: string) {
  if (!limiter || await limiter.allow({ scope, subject: token, limit: 30 })) return null;
  const response = publicFormResponse(context.req.raw, "Too many requests", "Too many requests for this subscription link. Try again in a minute.", 429);
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

export function registerSubscriberRoutes(app: Hono<AppEnv>, service: SubscribersService, options: { localMailCapture?: boolean; rateLimiter?: PublicWriteRateLimiter } = {}) {
  app.post("/subscribe", async (context) => {
    const result = (title: string, message: string, status: number) => publicFormResponse(context.req.raw, title, message, status);
    if (context.req.header("Sec-Fetch-Site") === "cross-site") return result("Subscription unavailable", "Cross-site subscription requests are not accepted.", 403);
    if (options.rateLimiter && !(await options.rateLimiter.allow({ scope: "subscribe", subject: requestNetworkSubject(context.req.raw), limit: 5 }))) return result("Too many requests", "Too many subscription requests. Try again in a minute.", 429);
    const body = await context.req.parseBody();
    const parsed = emailSchema.safeParse({ email: body.email });
    if (!parsed.success) return result("Check your email address", "Enter a valid email address.", 400);
    try {
      await service.requestEmailSubscription(parsed.data.email, new URL(context.req.url).origin);
      // Preserve the same response for active, pending and suppressed requests.
      return result("Check your email", import.meta.env.DEV && options.localMailCapture
        ? "Check the local outbox at /__dev/outbox for any confirmation or management link for this subscription."
        : "Check your email to confirm or manage this subscription.", 202);
    } catch (error) {
      if (error instanceof MailUnavailableError) return result("Subscriptions unavailable", "Subscriptions are not configured because this deployment has no mail sender. No confirmation email was sent.", 503);
      throw error;
    }
  });
  app.get("/confirm-subscription/:token", async (context) => {
    const limited = await allowedTokenRequest(context, options.rateLimiter, "subscription-confirm", context.req.param("token") ?? "");
    if (limited) return limited;
    const confirmed = await service.confirm(context.req.param("token") ?? "");
    return tokenResponse(context.req.raw, confirmed ? renderSubscriberTokenPage("Subscription confirmed", "<p>Your status subscription is confirmed.</p>") : renderSubscriberTokenPage("Subscription unavailable", "<p>This confirmation link is invalid or has expired.</p>"), confirmed ? 200 : 404);
  });
  app.get("/manage/:token", async (context) => {
    const token = context.req.param("token") ?? "";
    const limited = await allowedTokenRequest(context, options.rateLimiter, "subscription-manage", token);
    if (limited) return limited;
    const managed = await service.getManagedSubscription(token);
    return managed ? tokenResponse(context.req.raw, renderSubscriberManagementPage(managed)) : tokenResponse(context.req.raw, renderSubscriberTokenPage("Subscription unavailable", "<p>This subscription link is invalid or no longer active.</p>"), 404);
  });
  app.post("/manage/:token", async (context) => {
    const token = context.req.param("token") ?? "";
    const limited = await allowedTokenRequest(context, options.rateLimiter, "subscription-manage", token);
    if (limited) return limited;
    const updated = await service.updateManagedSelection(token, parsedComponentIds((await context.req.parseBody()).componentId));
    return updated ? tokenResponse(context.req.raw, renderSubscriberTokenPage("Subscription updated", "<p>Your selection has been updated.</p>")) : tokenResponse(context.req.raw, renderSubscriberTokenPage("Subscription unavailable", "<p>This subscription link is invalid or no longer active.</p>"), 404);
  });
  app.get("/unsubscribe/:token", async (context) => {
    const limited = await allowedTokenRequest(context, options.rateLimiter, "subscription-unsubscribe", context.req.param("token") ?? "");
    return limited ?? tokenResponse(context.req.raw, renderSubscriberTokenPage("Unsubscribe", "<form method=\"post\"><input type=\"hidden\" name=\"action\" value=\"unsubscribe\"><button type=\"submit\">Unsubscribe</button></form>"));
  });
  app.post("/unsubscribe/:token", async (context) => {
    const limited = await allowedTokenRequest(context, options.rateLimiter, "subscription-unsubscribe", context.req.param("token") ?? "");
    if (limited) return limited;
    const form = await context.req.parseBody();
    const oneClick = form["List-Unsubscribe"] === "One-Click";
    const accepted = oneClick || form.action === "unsubscribe";
    const unsubscribed = accepted && await service.unsubscribe(context.req.param("token") ?? "");
    if (!oneClick && context.req.header("Accept")?.includes("text/html")) {
      return tokenResponse(context.req.raw, renderSubscriberTokenPage(unsubscribed ? "Unsubscribed" : "Subscription unavailable", unsubscribed
        ? "<p>You will no longer receive status updates.</p><p><a href=\"/\">Return to status</a></p>"
        : "<p>This subscription link is invalid or no longer active.</p>"), unsubscribed ? 200 : 404);
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
