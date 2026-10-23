import type { Hono } from "hono";
import type { AppEnv } from "../../app/types";
import { requestNetworkSubject, type PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { ulidSchema } from "../../shared/ids";
import { applyPublicIsolationHeaders } from "../public-snapshot/headers";
import { renderSubscriberTokenPage, type SubscribersService } from "./service";
import { formPreferences } from "./preferences";
import { SubscriberLimitError } from "./limits";
import type { TeamsSubscriptionsService } from "./teams-subscriptions";

export function registerTeamsSubscriptionRoutes(app: Hono<AppEnv>, service: TeamsSubscriptionsService, subscribers: SubscribersService, limiter?: PublicWriteRateLimiter) {
  function page(request: Request, name: string, title: string, body: string, status = 200) {
    const response = new Response(renderSubscriberTokenPage(title, body, name), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } });
    applyPublicIsolationHeaders(response.headers, new URL(request.url).origin);
    return response;
  }
  app.post("/subscribe/teams", async context => {
    const name = await subscribers.getPageName();
    const result = (title: string, body: string, status: number) => page(context.req.raw, name, title, body, status);
    if (context.req.header("Sec-Fetch-Site") === "cross-site") return result("Subscription unavailable", "<p>Cross-site subscription requests are not accepted.</p>", 403);
    if (limiter && !await limiter.allow({ scope: "subscribe", subject: requestNetworkSubject(context.req.raw), limit: 5 })) return result("Too many requests", "<p>Too many subscription requests. Try again in a minute.</p>", 429);
    const body = await context.req.parseBody({ all: true });
    if (typeof body.url !== "string") return result("Check the webhook URL", "<p>Paste a Microsoft Teams Workflows webhook URL.</p>", 400);
    try {
      const values = body.componentId === undefined ? [] : Array.isArray(body.componentId) ? body.componentId : [body.componentId];
      const componentIds = values.map(value => ulidSchema.parse(value));
      await service.subscribe({ url: body.url, componentIds, preferences: formPreferences(body) }, new URL(context.req.url).origin);
      return result("Check your Teams channel", "<p>Confirm the verification card in your channel to receive updates.</p><p><a href=\"/\">See current status</a></p>", 202);
    } catch (error) {
      if (error instanceof SubscriberLimitError) return result("Subscriptions full", "<p>This page cannot take new subscriptions on that channel right now.</p><p>Follow updates with <a href=\"/feed.atom\">Atom</a> or <a href=\"/feed.rss\">RSS</a>.</p>", 409);
      return result("Subscription unavailable", "<p>The Teams subscription could not be created. Check the Workflows webhook URL and your selection.</p>", 400);
    }
  });
  app.get("/subscribe/teams/confirm/:token", async context => {
    const name = await subscribers.getPageName(), token = context.req.param("token");
    if (limiter && !await limiter.allow({ scope: "subscription-confirm", subject: token, limit: 30 })) return page(context.req.raw, name, "Too many requests", "<p>Try this link again in a minute.</p>", 429);
    return await service.canConfirm(token)
      ? page(context.req.raw, name, "Confirm Teams subscription", "<form method=\"post\"><input type=\"hidden\" name=\"action\" value=\"confirm\"><button type=\"submit\">Confirm subscription</button></form>")
      : page(context.req.raw, name, "Subscription unavailable", "<p>This confirmation link is invalid or has expired.</p>", 404);
  });
  app.post("/subscribe/teams/confirm/:token", async context => {
    const name = await subscribers.getPageName(), token = context.req.param("token");
    if (context.req.header("Sec-Fetch-Site") === "cross-site") return page(context.req.raw, name, "Subscription unavailable", "<p>Cross-site confirmation requests are not accepted.</p>", 403);
    if (limiter && !await limiter.allow({ scope: "subscription-confirm", subject: token, limit: 30 })) return page(context.req.raw, name, "Too many requests", "<p>Try this link again in a minute.</p>", 429);
    const body = await context.req.parseBody();
    const confirmed = body.action === "confirm" ? await service.confirm(token) : null;
    return confirmed
      ? page(context.req.raw, name, "Subscription confirmed", `<p>Your Teams channel will receive updates.</p><p><a href="/manage/${encodeURIComponent(confirmed.manageToken)}">Manage this subscription</a></p>`)
      : page(context.req.raw, name, "Subscription unavailable", "<p>This confirmation link is invalid or has expired.</p>", 404);
  });
}
