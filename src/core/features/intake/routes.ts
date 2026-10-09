import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app/types";
import type { PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { AlertSourceNotFoundError, UnauthorizedAlertError, type IntakeService } from "./service";

const sourceSchema = z.object({ name: z.string().trim().min(1).max(120), credentialKind: z.enum(["hmac-sha256", "bearer-token"]), signingSecret: z.string().min(1).optional(), bearerToken: z.string().min(1).optional(), timestampHeader: z.string().min(1).max(120).optional(), signatureHeader: z.string().min(1).max(120).optional(), deduplicationPath: z.string().min(1).max(250), titlePath: z.string().min(1).max(250), statePath: z.string().min(1).max(250), recoveredValue: z.string().min(1).max(100).optional() }).strict();

export function registerIntakeRoutes(app: Hono<AppEnv>, service: IntakeService, options: { rateLimiter?: PublicWriteRateLimiter } = {}) {
  app.get("/api/app/intake/sources", async (context) => context.json({ sources: await service.listSources() }));
  app.get("/api/app/intake/receipts", async (context) => {
    const limit = z.coerce.number().int().min(1).max(250).safeParse(context.req.query("limit") ?? "100");
    if (!limit.success) return context.json({ error: "limit must be an integer from 1 to 250." }, 400);
    return context.json({ receipts: await service.listReceipts(limit.data) });
  });
  app.post("/api/app/intake/sources", async (context) => { const input = sourceSchema.safeParse(await context.req.json().catch(() => null)); if (!input.success) return context.json({ error: "Invalid alert source." }, 400); try { return context.json({ source: await service.saveSource(input.data, context.get("operator").id) }, 201); } catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The source could not be saved." }, 400); } });
  app.put("/api/app/intake/sources/:sourceId", async (context) => { const input = sourceSchema.safeParse(await context.req.json().catch(() => null)); if (!input.success) return context.json({ error: "Invalid alert source." }, 400); try { return context.json({ source: await service.saveSource(input.data, context.get("operator").id, context.req.param("sourceId")) }); } catch (cause) { if (cause instanceof AlertSourceNotFoundError) return context.json({ error: "Alert source not found." }, 404); return context.json({ error: cause instanceof Error ? cause.message : "The source could not be saved." }, 400); } });
  app.post("/api/intake/:sourceId", async (context) => {
    try {
      const verified = await service.authenticate(context.req.param("sourceId"), context.req.raw);
      if (options.rateLimiter && !(await options.rateLimiter.allow({ scope: "intake", subject: verified.source.id, limit: 120 }))) return context.json({ error: "Too many intake requests." }, 429);
      const accepted = await service.acceptVerified(verified);
      return context.json(accepted, accepted.status);
    } catch (cause) { if (cause instanceof UnauthorizedAlertError) return context.json({ error: "Invalid alert credential." }, 401); if (cause instanceof AlertSourceNotFoundError) return context.json({ error: "Alert source not found." }, 404); if (cause instanceof SyntaxError) return context.json({ error: "Alert payload must be JSON." }, 400); return context.json({ error: cause instanceof Error ? cause.message : "The alert could not be accepted." }, 500); }
  });
}
