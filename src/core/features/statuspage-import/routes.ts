import { z } from "zod";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { AppEnv } from "../../app/types";
import type { StatuspageImportService } from "./service";
import { importLimits } from "./source";
import { findSourcePages } from "./page-finder";
import { importSources } from "./adapters";

const fetchSchema = z.object({ source: z.enum(importSources).optional(), pageId: z.string().max(40).optional(), apiKey: z.string().max(200).optional(), publicAccessAcknowledged: z.boolean().optional(), publicUrl: z.string().url().max(2048).optional() }).strict();
const jobId = z.string().min(1).max(100);

/** Lamp's own refusal wording for the owner. Kit codes name an integrity
 * guard, never source content or the API key. */
export function refusal(cause: unknown) {
  const message = cause instanceof Error ? cause.message.replace(/[\r\n]+/gu, " ") : "";
  return /^[A-Z_]+$/u.test(message) || !message || message.length > 350 ? "The import was refused. Run the dry run again from the same source." : message;
}

export function registerStatuspageImportRoutes(app: Hono<AppEnv>, service: StatuspageImportService) {
  const refused = refusal;
  app.use("/api/app/statuspage-import/*", bodyLimit({ maxSize: importLimits.maxBytes * 2, onError: (context) => context.json({ error: "The saved responses exceed 8 MiB." }, 413) }));
  app.use("/api/app/statuspage-import/*", async (context, next) => { context.header("Cache-Control", "no-store"); await next(); });

  // Move in plans, applies and undoes every import through the import door
  // (door.ts). This only reads a source account or public page for it.
  app.post("/api/app/statuspage-import/fetch", async (context) => {
    const parsed = fetchSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Choose saved source responses, or enter a page ID and API key." }, 400);
    try { return context.json({ files: await service.fetchSource(parsed.data, context.get("operatorSession")) }); }
    catch (cause) { return context.json({ error: refused(cause) }, 400); }
  });
  app.post("/api/app/statuspage-import/pages", async (context) => {
    const parsed = z.object({ source: z.enum(["betterstack", "instatus", "sorry"]), apiKey: z.string().max(256) }).strict().safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Choose Better Stack, Instatus or Sorry and paste its API key." }, 400);
    try { return context.json({ pages: await findSourcePages(parsed.data) }); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Your status pages could not be listed." }, 400); }
  });
  app.get("/api/app/statuspage-import/jobs", async (context) => context.json({ jobs: await service.list(context.get("operatorSession")) }));
  app.get("/api/app/statuspage-import/jobs/:id/verification", async (context) => {
    const id = jobId.safeParse(context.req.param("id"));
    if (!id.success) return context.json({ error: "Import not found." }, 404);
    try { return context.json(await service.verification(id.data, context.get("operatorSession"))); }
    catch (cause) { return context.json({ error: refused(cause) }, 409); }
  });
  // Imports made before the door keep their read, resume and undo here; every
  // import keeps its read and its Cutover invitations.
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
      if (action === 'send-invitations' && !z.union([z.object({}).strict(), z.object({ liveOrigin: z.string().url().max(2048), hostnameLive: z.literal(true), watchWindowClosed: z.literal(true) }).strict()]).safeParse(command).success) return context.json({ error: 'Confirm the live hostname and closed watch window before sending Sorry invitations.' }, 400);
      return context.json(action === "send-invitations" ? await service.sendInvitations(id.data, who, command ?? undefined) : action === "resume" ? await service.resume(id.data, who) : await service.undo(id.data, who)); }
    catch (cause) { return context.json({ error: refused(cause) }, 409); }
  });
}
