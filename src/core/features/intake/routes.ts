import type { Hono } from "hono";
import { z } from "zod";
import { publicPageOrigin } from "../../app/public-origin";
import type { AppEnv } from "../../app/types";
import type { PublicWriteRateLimiter } from "../../platform/security/rate-limiter";
import { labelMatcherSchema } from "./grouped-alerts";
import { ALERT_PRESETS } from "./presets";
import { AlertSourceNotFoundError, UnauthorizedAlertError, type AlertSourceEndpointView, type AlertSourceView, type IntakeService } from "./service";

const sourceSchema = z.object({ name: z.string().trim().min(1).max(120), preset: z.enum(ALERT_PRESETS).optional(), labelMatchers: z.array(labelMatcherSchema).max(200).optional(), componentId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).optional(), credentialKind: z.enum(["hmac-sha256", "bearer-token"]), signingSecret: z.string().min(1).optional(), bearerToken: z.string().min(1).optional(), timestampHeader: z.string().min(1).max(120).optional(), signatureHeader: z.string().min(1).max(120).optional(), deduplicationPath: z.string().max(250).default(""), titlePath: z.string().max(250).default(""), statePath: z.string().max(250).default(""), recoveredValue: z.string().min(1).max(100).optional() }).strict();

// Operators read sources on the app host, but monitoring tools must post to the
// page host: derive that origin from the configured page hostname on the server.
function withEndpointUrl(source: AlertSourceView, requestUrl: string, publicPageHost: string): AlertSourceEndpointView {
  return { ...source, endpointUrl: `${publicPageOrigin(requestUrl, publicPageHost)}${source.endpointPath}` };
}

export function registerIntakeRoutes(app: Hono<AppEnv>, service: IntakeService, options: { publicPageHost: string; rateLimiter?: PublicWriteRateLimiter }) {
  const endpointView = (source: AlertSourceView, requestUrl: string) => withEndpointUrl(source, requestUrl, options.publicPageHost);
  app.get("/api/app/intake/sources", async (context) => context.json({ sources: (await service.listSources()).map((source) => endpointView(source, context.req.url)) }));
  app.get("/api/app/intake/receipts", async (context) => {
    const limit = z.coerce.number().int().min(1).max(250).safeParse(context.req.query("limit") ?? "100");
    if (!limit.success) return context.json({ error: "limit must be an integer from 1 to 250." }, 400);
    return context.json({ receipts: await service.listReceipts(limit.data) });
  });
  app.post("/api/app/intake/sources", async (context) => { const input = sourceSchema.safeParse(await context.req.json().catch(() => null)); if (!input.success) return context.json({ error: "Invalid alert source." }, 400); try { return context.json({ source: endpointView(await service.saveSource(input.data, context.get("operator").id), context.req.url) }, 201); } catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The source could not be saved." }, 400); } });
  app.put("/api/app/intake/sources/:sourceId", async (context) => { const input = sourceSchema.safeParse(await context.req.json().catch(() => null)); if (!input.success) return context.json({ error: "Invalid alert source." }, 400); try { return context.json({ source: endpointView(await service.saveSource(input.data, context.get("operator").id, context.req.param("sourceId")), context.req.url) }); } catch (cause) { if (cause instanceof AlertSourceNotFoundError) return context.json({ error: "Alert source not found." }, 404); return context.json({ error: cause instanceof Error ? cause.message : "The source could not be saved." }, 400); } });
  // Presets also take their token as the last path segment, for tools that cannot send a header.
  app.post("/api/intake/:sourceId/:token?", async (context) => {
    try {
      const verified = await service.authenticate(context.req.param("sourceId"), context.req.raw, context.req.param("token"));
      if (options.rateLimiter && !(await options.rateLimiter.allow({ scope: "intake", subject: verified.source.id, limit: 120 }))) return context.json({ error: "Too many intake requests." }, 429);
      const accepted = await service.acceptVerified(verified);
      return context.json(accepted, accepted.status);
    } catch (cause) { if (cause instanceof UnauthorizedAlertError) return context.json({ error: "Invalid alert credential." }, 401); if (cause instanceof AlertSourceNotFoundError) return context.json({ error: "Alert source not found." }, 404); if (cause instanceof SyntaxError) return context.json({ error: "Alert payload must be JSON." }, 400); return context.json({ error: cause instanceof Error ? cause.message : "The alert could not be accepted." }, 500); }
  });
}
