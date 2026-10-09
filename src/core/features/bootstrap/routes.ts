import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app/types";
import type { AppServices } from "../../app/services";
import { constantTimeEqual, hashOpaqueToken } from "../../platform/security/opaque-tokens";
import { requestNetworkSubject, type PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { createBootstrapRepository } from "./repository";

const inputSchema = z.object({
  mailProvider: z.enum(["resend", "sendgrid"]).optional(),
  mailFromAddress: z.email().optional(),
  email: z.email().transform(value => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(120),
  pageName: z.string().trim().min(1).max(120),
  tagline: z.string().trim().min(1).max(280),
  timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
}).strict();

export function registerBootstrapRoutes(app: Hono<AppEnv>, services: AppServices, limiter: PublicWriteRateLimiter) {
  app.get("/setup/status", async context => {
    context.header("Cache-Control", "no-store");
    const initialized = await createBootstrapRepository(context.env.DB).initialized();
    if (!initialized) return context.json({ state: "setup_required" }, 409);
    if (!(await services.pageSettings.get())) return context.json({ state: "unavailable" }, 503);
    return context.json({ state: "ready" }, 200);
  });
  app.post("/setup", async context => {
    context.header("Cache-Control", "no-store");
    context.header("Referrer-Policy", "no-referrer");
    if (!(await limiter.allow({ scope: "bootstrap", subject: requestNetworkSubject(context.req.raw), limit: 10 }))) return context.json({ error: "Too many setup requests." }, 429);
    const configured = context.env.LAMP_BOOTSTRAP_SECRET;
    if (!configured || configured.length < 32) return context.json({ error: "Owner setup is not enabled." }, 503);
    const authorization = context.req.header("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ") || authorization.length > 512 || !constantTimeEqual(await hashOpaqueToken(authorization.slice(7)), await hashOpaqueToken(configured))) return context.json({ error: "Owner setup authorization is required." }, 401);
    const origin = context.req.header("Origin");
    if (context.req.header("Sec-Fetch-Site") === "cross-site" || (origin && origin !== new URL(context.req.url).origin)) return context.json({ error: "Cross-origin setup is not accepted." }, 403);
    const repository = createBootstrapRepository(context.env.DB);
    if (await repository.initialized()) return context.json({ error: "Owner setup is already complete." }, 409);
    const parsed = inputSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "A valid owner email, display name, page name, tagline and timezone are required." }, 400);
    if (!z.email().safeParse(context.env.MAIL_FROM_ADDRESS).success || !context.env.MAIL_PROVIDER_API_KEY || (context.env.SUBSCRIBER_TOKEN_SECRET?.length ?? 0) < 32 || (context.env.WEBHOOK_SIGNING_SECRET?.length ?? 0) < 32) return context.json({ error: "Configure MAIL_FROM_ADDRESS, MAIL_PROVIDER_API_KEY, SUBSCRIBER_TOKEN_SECRET and WEBHOOK_SIGNING_SECRET before owner setup." }, 503);
    if ((parsed.data.mailProvider && parsed.data.mailProvider !== (context.env.MAIL_PROVIDER ?? "resend")) || (parsed.data.mailFromAddress && parsed.data.mailFromAddress !== context.env.MAIL_FROM_ADDRESS)) return context.json({ error: "Mail choices must match the configured independent deployment." }, 409);
    const created = await repository.initialize({ ...parsed.data, hostname: context.env.LAMP_PAGE_HOST, mailFrom: context.env.MAIL_FROM_ADDRESS });
    if (!created) return context.json({ error: "Owner setup is already complete." }, 409);
    // Initialization is durable even if snapshot publication fails. Health and
    // the normal scheduler repair pending publication; setup never grants a session.
    await services.publicSnapshots.retryPendingBuild();
    return context.json({ initialized: true, signInPath: "/signin" }, 201);
  });
}
