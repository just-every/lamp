import { z } from "zod";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { AppEnv } from "../../app/types";
import type { StatuspageImportService } from "./service";
import { importLimits } from "./source";

const files = z.array(z.object({ name: z.string().max(80), text: z.string() }).strict()).max(importLimits.files);
const sourceFields = { source: z.enum(["statuspage", "betterstack"]).optional(), publicAccessAcknowledged: z.boolean().optional() };
const previewSchema = z.object({ ...sourceFields, files: files.optional(), pageId: z.string().max(40).optional(), apiKey: z.string().max(200).optional() }).strict();
const applySchema = z.object({ ...sourceFields, pageId: z.string().max(64).optional(), files: files.min(1), asOf: z.string().datetime(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), acknowledged: z.literal(true) }).strict();
const jobId = z.string().min(1).max(100);

export function registerStatuspageImportRoutes(app: Hono<AppEnv>, service: StatuspageImportService) {
  const refused = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message.replace(/[\r\n]+/gu, " ") : "";
    // Kit codes name an integrity guard, never source content or the API key.
    return /^[A-Z_]+$/u.test(message) || !message || message.length > 350 ? "The import was refused. Run the dry run again from the same source." : message;
  };
  app.use("/api/app/statuspage-import/*", bodyLimit({ maxSize: importLimits.maxBytes * 2, onError: (context) => context.json({ error: "The saved responses exceed 8 MiB." }, 413) }));
  app.use("/api/app/statuspage-import/*", async (context, next) => { context.header("Cache-Control", "no-store"); await next(); });

  app.post("/api/app/statuspage-import/preview", async (context) => {
    const parsed = previewSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Choose saved source responses, or enter a page ID and API key." }, 400);
    try { return context.json(await service.preview(parsed.data, context.get("operatorSession"))); }
    catch (cause) { return context.json({ error: refused(cause) }, 400); }
  });
  app.post("/api/app/statuspage-import/apply", async (context) => {
    const parsed = applySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Review the dry run and confirm it before importing." }, 400);
    try { return context.json(await service.apply(parsed.data, context.get("operatorSession"))); }
    catch (cause) { return context.json({ error: refused(cause) }, 409); }
  });
  app.get("/api/app/statuspage-import/jobs", async (context) => context.json({ jobs: await service.list(context.get("operatorSession")) }));
  app.get("/api/app/statuspage-import/jobs/:id", async (context) => {
    const id = jobId.safeParse(context.req.param("id"));
    if (!id.success) return context.json({ error: "Import not found." }, 404);
    try { return context.json(await service.read(id.data, context.get("operatorSession"))); }
    catch { return context.json({ error: "Import not found." }, 404); }
  });
  app.post("/api/app/statuspage-import/jobs/:id/:action", async (context) => {
    const id = jobId.safeParse(context.req.param("id"));
    const action = context.req.param("action");
    if (!id.success || (action !== "resume" && action !== "undo" && action !== "send-invitations")) return context.json({ error: "Import not found." }, 404);
    const who = context.get("operatorSession");
    try {
      const command = await context.req.json().catch(() => null);
      if (action === 'send-invitations' && !z.object({}).strict().safeParse(command).success) return context.json({ error: 'Send invitations with an empty command.' }, 400);
      return context.json(action === "send-invitations" ? await service.sendInvitations(id.data, who) : action === "resume" ? await service.resume(id.data, who) : await service.undo(id.data, who)); }
    catch (cause) { return context.json({ error: refused(cause) }, 409); }
  });
}
