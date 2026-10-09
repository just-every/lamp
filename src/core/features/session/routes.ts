import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../../app/types";
import { MailUnavailableError } from "../../platform/mail";
import { requestNetworkSubject, type PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { ulidSchema } from "../../shared/ids";
import type { SessionService } from "./service";

export const SESSION_COOKIE = "lamp_session";

const emailSchema = z.object({ email: z.email() }).strict();
const inviteSchema = z.object({ email: z.email(), displayName: z.string().trim().min(1).max(120) }).strict();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);

function readCookie(header: string | undefined, name: string) {
  if (!header) return null;
  const values = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  try { return decodeURIComponent(values[0].slice(name.length + 1)); } catch { return null; }
}

function requestOrigin(url: string) {
  return new URL(url).origin;
}

function cookie(sessionId: string, url: string) {
  const secure = new URL(url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secure}`;
}

function expiredCookie(url: string) {
  const secure = new URL(url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readOperatorSessionId(cookieHeader: string | undefined) {
  const value = readCookie(cookieHeader, SESSION_COOKIE);
  const parsed = ulidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function requireOperator(sessionService: SessionService): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const sessionId = readOperatorSessionId(context.req.header("Cookie"));
    if (!sessionId) return context.json({ error: "A valid operator session is required." }, 401);
    const operator = await sessionService.getActiveOperator(sessionId);
    if (!operator) return context.json({ error: "A valid operator session is required." }, 401);
    context.set("operator", operator);
    await next();
  };
}

export function registerSessionRoutes(app: Hono<AppEnv>, service: SessionService, options: { publicPageHost: string; localMailCapture?: boolean; rateLimiter?: PublicWriteRateLimiter }) {
  // This is deployment configuration, deliberately separate from editable page
  // settings. Two-host links must never infer their authority from a display
  // hostname the operator may be editing.
  app.get("/signin/config", (context) => context.json({ publicPageHost: options.publicPageHost }));
  app.post("/signin/request", async (context) => {
    if (context.req.header("Sec-Fetch-Site") === "cross-site") return context.text("Cross-site sign-in requests are not accepted.", 403);
    if (options.rateLimiter && !(await options.rateLimiter.allow({ scope: "signin", subject: requestNetworkSubject(context.req.raw), limit: 10 }))) return context.text("Too many sign-in requests. Try again in a minute.", 429);
    const body = await context.req.parseBody();
    const parsed = emailSchema.safeParse({ email: body.email });
    if (!parsed.success) return context.text("Enter a valid email address.", 400);
    try {
      await service.requestSignIn(parsed.data.email, requestOrigin(context.req.url));
    } catch (error) {
      if (error instanceof MailUnavailableError) return context.text("Sign-in email is not configured for this deployment.", 503);
      throw error;
    }
    // Transport context is the same for known and unknown identities. Never
    // disclose whether the allow-list lookup actually caused a send.
    return context.text(import.meta.env.DEV && options.localMailCapture
      ? "If this address is an allowed operator, find its sign-in link in the local outbox at /__dev/outbox."
      : "If this address is an allowed operator, a sign-in link has been sent.", 202);
  });

  app.get("/signin/complete/:token", async (context) => {
    const token = tokenSchema.safeParse(context.req.param("token"));
    if (!token.success) return context.text("This sign-in link is invalid or has expired.", 400);
    const result = await service.consumeSignIn(token.data);
    if (!result) return context.text("This sign-in link is invalid or has expired.", 400);
    return new Response(null, {
      status: 302,
      headers: {
        Location: new URL("/app", context.req.url).toString(),
        "Set-Cookie": cookie(result.sessionId, context.req.url),
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
      },
    });
  });

  app.get("/api/app/editor-config", async (context) => {
    const sessionId = readOperatorSessionId(context.req.header("Cookie"));
    const operator = sessionId ? await service.getActiveOperator(sessionId) : null;
    if (!operator?.isSetupOperator) return context.json({ error: "Setup operator access required." }, 403);
    context.header("Cache-Control", "no-store");
    const managementOrigin = context.env.RER_MANAGEMENT_ORIGIN || "";
    const installationId = context.env.RER_INSTALLATION_ID || "";
    return context.json({ enabled: Boolean(managementOrigin && installationId), managementOrigin, installationId });
  });
  app.get("/api/app/session", (context) => context.json({ operator: context.get("operator"), publicPageHost: options.publicPageHost }));
  app.post("/api/app/session/signout", async (context) => {
    const sessionId = readOperatorSessionId(context.req.header("Cookie"));
    if (sessionId) await service.signOut(sessionId);
    const response = context.body(null, 204);
    response.headers.set("Set-Cookie", expiredCookie(context.req.url));
    return response;
  });
  app.get("/api/app/operators", async (context) => context.json({ operators: await service.listOperators() }));
  app.get("/api/app/operators/former", async (context) => context.json({ operators: await service.listFormerOperators() }));
  app.post("/api/app/operators/invite", async (context) => {
    const parsed = inviteSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "An email and display name are required.", issues: parsed.error.issues }, 400);
    try {
      await service.inviteOperator({ ...parsed.data, invitedByOperatorId: context.get("operator").id, origin: requestOrigin(context.req.url) });
      return context.body(null, 202);
    } catch (error) {
      if (error instanceof MailUnavailableError) return context.json({ error: error.message }, 503);
      return context.json({ error: error instanceof Error ? error.message : "Unable to invite operator." }, 409);
    }
  });
  app.post("/api/app/operators/:operatorId/revoke-access", async (context) => {
    const operatorId = ulidSchema.safeParse(context.req.param("operatorId"));
    if (!operatorId.success) return context.json({ error: "Expected a canonical operator ID." }, 400);
    try {
      const revoked = await service.revokeOperatorAccess({ operatorId: operatorId.data, requestedByOperatorId: context.get("operator").id });
      return revoked ? context.body(null, 204) : context.json({ error: "Operator not found." }, 404);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "Unable to revoke operator access." }, 409);
    }
  });
  app.delete("/api/app/operators/:operatorId", async (context) => {
    const operatorId = ulidSchema.safeParse(context.req.param("operatorId"));
    if (!operatorId.success) return context.json({ error: "Expected a canonical operator ID." }, 400);
    try {
      const erased = await service.eraseOperator({ operatorId: operatorId.data, requestedByOperatorId: context.get("operator").id });
      return erased ? context.body(null, 204) : context.json({ error: "Operator not found." }, 404);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "Unable to erase operator data." }, 409);
    }
  });
}
