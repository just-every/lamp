import type { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../../app/types";
import { teamsWorkflowUrl } from "./teams";
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
const teamsSchema = z.object({ destination: z.string().min(1).max(4096), contactEmail: z.email(), componentIds: z.array(ulidSchema).max(200).default([]) }).strict();
const webhookSchema = z.object({ destination: z.url(), contactEmail: z.email(), componentIds: z.array(ulidSchema).max(200).default([]) }).strict();

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

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
    return tokenResponse(request, renderSubscriberTokenPage(title, `<p>${message}</p><p><a href="/#subscribe">Return to subscriptions</a></p>`, pageName), status);
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

export function registerSubscriberRoutes(app: Hono<AppEnv>, service: SubscribersService, options: { rateLimiter?: PublicWriteRateLimiter; localMail?: boolean } = {}) {
  app.get("/subscribe/teams", async (context) => {
    const pageName = await service.getPageName();
    if (options.rateLimiter && !await options.rateLimiter.allow({ scope: "teams-subscription-form", subject: requestNetworkSubject(context.req.raw), limit: 30 })) return publicFormResponse(context.req.raw, "Too many requests", "Too many subscription page requests. Try again in a minute.", 429, pageName);
    const unavailable = service.teamsAvailability();
    if (unavailable) return tokenResponse(context.req.raw, renderSubscriberTokenPage("Teams subscriptions unavailable", `<p>${escapeHtml(unavailable)}</p>`, pageName), 503);
    const components = await service.teamsComponents();
    const checks = components.map(component => `<label><input type="checkbox" name="componentId" value="${component.id}"> ${escapeHtml(component.name)}</label>`).join("");
    return tokenResponse(context.req.raw, renderSubscriberTokenPage("Get updates in Microsoft Teams", `<p>In your Teams channel, open Workflows and create “When a Teams webhook request is received”. Allow Anyone to send requests and use the workflow that posts Adaptive Cards to your channel.</p><p>Paste its webhook URL below. Lamp sends a verification card; open its confirmation link from the channel before updates start. The webhook URL is stored encrypted.</p><form method="post" action="/subscribe/teams"><label for="teams-url">Teams Workflows webhook URL</label><input id="teams-url" name="destination" type="url" required maxlength="4096" autocomplete="off"><label for="teams-contact">Contact email</label><input id="teams-contact" name="contactEmail" type="email" required autocomplete="email"><p>Lamp emails this contact if ten consecutive updates fail and the subscription is deactivated.</p>${checks ? `<fieldset><legend>Components</legend><p>Choose components, or leave every box clear to follow all current and future visible components.</p>${checks}</fieldset>` : ""}<button type="submit">Send verification card</button></form>`, pageName));
  });
  app.post("/subscribe/teams", async (context) => {
    const pageName = await service.getPageName();
    const result = (title: string, message: string, status: number) => publicFormResponse(context.req.raw, title, message, status, pageName);
    if (context.req.header("Sec-Fetch-Site") === "cross-site") return result("Subscription unavailable", "Cross-site subscription requests are not accepted.", 403);
    if (options.rateLimiter && !await options.rateLimiter.allow({ scope: "subscribe", subject: requestNetworkSubject(context.req.raw), limit: 5 })) return result("Too many requests", "Too many subscription requests. Try again in a minute.", 429);
    const body = await context.req.parseBody({ all: true });
    const components = body.componentId === undefined ? [] : Array.isArray(body.componentId) ? body.componentId : [body.componentId];
    const parsed = teamsSchema.safeParse({ destination: body.destination, contactEmail: body.contactEmail, componentIds: components });
    if (!parsed.success) return result("Check your subscription", "Enter a Teams Workflows webhook URL, a contact email and valid components.", 400);
    // Validate the host even on an installation where outbound chat is unavailable.
    try { teamsWorkflowUrl(parsed.data.destination); } catch (error) { return result("Check the Teams webhook", escapeHtml(error instanceof Error ? error.message : "Invalid Teams webhook URL."), 400); }
    const unavailable = service.teamsAvailability();
    if (unavailable) return result("Teams subscriptions unavailable", escapeHtml(unavailable), 503);
    try { await service.requestTeamsSubscription(parsed.data, new URL(context.req.url).origin); }
    catch { return result("Teams verification unavailable", "Microsoft did not accept the card, or its receipt could not be confirmed. Check that the workflow is enabled, accepts Anyone and posts Adaptive Cards. A new workflow URL can be submitted now; this URL can be requested again after 24 hours.", 502); }
    return result("Check your Teams channel", "Open the verification card in your Teams channel and confirm the subscription. If this channel is already subscribed, the card provides its management link. At most one card is sent to a webhook URL in 24 hours.", 202);
  });
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
      await service.requestEmailSubscription(parsed.data.email, new URL(context.req.url).origin, parsedComponentIds(body.componentId));
      // Preserve the same response for active, pending and suppressed requests.
      if (options.localMail) return result("Local email is suppressed", "No email is sent locally. Confirming or managing a subscription by email requires a hosted installation.", 202);
      return result("Check your email", "Check your email to confirm or manage this subscription.", 202);
    } catch (error) {
      if (error instanceof MailUnavailableError) return result("Subscriptions unavailable", "Subscriptions are not configured because this deployment has no mail sender. No confirmation email was sent.", 503);
      throw error;
    }
  });
  app.get("/confirm-subscription/:token", async (context) => {
    const pageName = await service.getPageName();
    const limited = await allowedTokenRequest(context, options.rateLimiter, "subscription-confirm", context.req.param("token") ?? "", pageName);
    if (limited) return limited;
    if (await service.pendingTeamsConfirmation(context.req.param("token") ?? "")) return tokenResponse(context.req.raw, renderSubscriberTokenPage("Confirm Teams subscription", '<p>This link came from the verification card in your Teams channel. Confirm to start status updates for the components selected when the card was requested.</p><form method="post"><button type="submit">Confirm subscription</button></form>', pageName));
    const confirmed = await service.confirm(context.req.param("token") ?? "");
    return tokenResponse(context.req.raw, confirmed ? renderSubscriberTokenPage("Subscription confirmed", "<p>Your status subscription is confirmed.</p>", pageName) : renderSubscriberTokenPage("Subscription unavailable", "<p>This confirmation link is invalid or has expired.</p>", pageName), confirmed ? 200 : 404);
  });
  app.post("/confirm-subscription/:token", async (context) => {
    const pageName = await service.getPageName();
    if (context.req.header("Sec-Fetch-Site") === "cross-site") return tokenResponse(context.req.raw, renderSubscriberTokenPage("Subscription unavailable", "<p>Cross-site confirmation requests are not accepted.</p>", pageName), 403);
    const token = context.req.param("token") ?? "";
    const limited = await allowedTokenRequest(context, options.rateLimiter, "subscription-confirm", token, pageName);
    if (limited) return limited;
    const manage = await service.confirmTeams(token);
    return tokenResponse(context.req.raw, renderSubscriberTokenPage(manage ? "Teams subscription confirmed" : "Subscription unavailable", manage ? `<p>Your Teams channel will receive future updates for its selected components.</p><p><a href="/manage/${encodeURIComponent(manage)}">Manage this subscription</a></p>` : "<p>This confirmation link is invalid or has expired.</p>", pageName), manage ? 200 : 404);
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
    const updated = await service.updateManagedSelection(token, parsedComponentIds((await context.req.parseBody({ all: true })).componentId));
    return updated ? tokenResponse(context.req.raw, renderSubscriberTokenPage("Subscription updated", "<p>Your selection has been updated.</p>", pageName)) : tokenResponse(context.req.raw, renderSubscriberTokenPage("Subscription unavailable", "<p>This subscription link is invalid or no longer active.</p>", pageName), 404);
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
        ? "<p>You will no longer receive status updates.</p>"
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
