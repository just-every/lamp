import type { Context, Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../../app/types";
import { COMPONENT_STATES, INCIDENT_LIFECYCLES } from "../../shared/domain";
import { ulidSchema } from "../../shared/ids";
import { incidentDraftSchema } from "../../shared/schemas";
import { InvalidIncidentUpdateError, type IncidentsService } from "./service";
import { draftFromIncident } from "./draft";

const incidentQuerySchema = z.object({ lifecycle: z.enum(INCIDENT_LIFECYCLES).optional() }).strict();
const publishSchema = z.object({ channels: z.array(z.enum(["email", "webhook", "chat"])).max(3).transform((channels) => [...new Set(channels)]), publishedAt: z.iso.datetime().optional() }).strict();
const scheduleSchema = z.object({ publishAt: z.iso.datetime(), channels: z.array(z.enum(["email", "webhook", "chat"])).max(3).transform((channels) => [...new Set(channels)]) }).strict();
const deleteSchema = z.object({ reason: z.string().trim().min(1).max(1_000) }).strict();
const attachedComponentSchema = z.object({ componentId: ulidSchema, state: z.enum(COMPONENT_STATES), relationship: z.enum(["Primary", "Dependent"]).default("Primary") }).strict();
const componentChangeSchema = z.discriminatedUnion("action", [
  attachedComponentSchema.extend({ action: z.literal("attach") }).strict(),
  z.object({ action: z.literal("detach"), componentId: ulidSchema }).strict(),
]);
const createIncidentSchema = z.object({ title: z.string().trim().min(1).max(250), openedAt: z.iso.datetime().optional(), components: z.array(z.object({ componentId: ulidSchema, state: z.enum(COMPONENT_STATES), relationship: z.enum(["Primary", "Dependent"]).default("Primary") }).strict()).min(1).max(100) }).strict();
const templateSchema = z.object({ name: z.string().trim().min(1).max(120), lifecycle: z.enum(INCIDENT_LIFECYCLES), affectedAudience: z.string().trim().min(1).max(250), customerImpact: z.string().trim().min(1).max(250), whatStillWorks: z.string().max(250), details: z.string().max(500), nextUpdateOffsetMinutes: z.number().int().min(1).max(10_080), components: z.array(z.object({ componentId: ulidSchema, state: z.enum(COMPONENT_STATES), relationship: z.enum(["Primary", "Dependent"]).default("Primary") }).strict()).min(1).max(100) }).strict();
const correctionSchema = z.object({ updateId: ulidSchema }).strict();
const internalNoteSchema = z.object({ body: z.string().trim().min(1).max(5_000) }).strict();

function incidentIdFrom(context: Context<AppEnv>) {
  return ulidSchema.safeParse(context.req.param("incidentId"));
}

export function registerIncidentRoutes(app: Hono<AppEnv>, service: IncidentsService, options: { hasChatChannels?: () => Promise<boolean> } = {}) {
  app.get("/api/app/incident-templates", async (context) => context.json({ templates: await service.listTemplates() }));
  app.post("/api/app/incident-templates", async (context) => {
    const input = templateSchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "A complete template and at least one affected component are required." }, 400);
    try { return context.json({ template: await service.saveTemplate(input.data, context.get("operator").id) }, 201); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Template could not be saved." }, 409); }
  });
  app.post("/api/app/incidents", async (context) => {
    const input = createIncidentSchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "An incident title and one or more affected components are required." }, 400);
    try { return context.json({ incident: await service.create(input.data, context.get("operator").id) }, 201); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Incident could not be created." }, 409); }
  });
  app.get("/api/app/incidents", async (context) => {
    const parsed = incidentQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return context.json({ error: "Invalid incident query.", issues: parsed.error.issues }, 400);
    const incidents = await service.list();
    return context.json({ incidents: parsed.data.lifecycle ? incidents.filter((incident) => incident.lifecycle === parsed.data.lifecycle) : incidents });
  });

  app.get("/api/app/incidents/:incidentId", async (context) => {
    const incidentId = incidentIdFrom(context);
    if (!incidentId.success) return context.json({ error: "Invalid incident identifier.", issues: incidentId.error.issues }, 400);
    const incident = await service.get(incidentId.data);
    if (!incident) return context.json({ error: "Incident not found." }, 404);
    const [hasChatChannels, preview] = await Promise.all([
      options.hasChatChannels ? options.hasChatChannels() : false,
      service.preview(incident.id, draftFromIncident(incident)),
    ]);
    return context.json({ incident, hasChatChannels, preview });
  });

  app.post("/api/app/incidents/:incidentId/components/preview", async (context) => {
    const incidentId = incidentIdFrom(context); const input = componentChangeSchema.safeParse(await context.req.json().catch(() => null));
    if (!incidentId.success || !input.success) return context.json({ error: "A valid component change is required." }, 400);
    try { return context.json({ preview: await service.previewComponentChange(incidentId.data, input.data) }); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Component change could not be previewed." }, 409); }
  });

  app.post("/api/app/incidents/:incidentId/components", async (context) => {
    const incidentId = incidentIdFrom(context); const input = attachedComponentSchema.safeParse(await context.req.json().catch(() => null));
    if (!incidentId.success || !input.success) return context.json({ error: "A valid component, claim state and relationship are required." }, 400);
    try { await service.attachComponent(incidentId.data, input.data, context.get("operator").id); return context.json({ attached: true }, 201); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Component could not be attached." }, 409); }
  });
  app.delete("/api/app/incidents/:incidentId/components/:componentId", async (context) => {
    const incidentId = incidentIdFrom(context); const componentId = ulidSchema.safeParse(context.req.param("componentId"));
    if (!incidentId.success || !componentId.success) return context.json({ error: "Invalid incident or component identifier." }, 400);
    try { await service.detachComponent(incidentId.data, componentId.data, context.get("operator").id); return context.json({ detached: true }); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Component could not be detached." }, 409); }
  });

  // Mutating a draft always refers to the exact acknowledged version. Old
  // browser builds must reload rather than bypass the concurrency protocol.
  app.use("/api/app/incidents/:incidentId/*", async (context, next) => {
    const path = context.req.path.replace(/^\/api\/app\/incidents\/[^/]+/, "");
    const guarded = (context.req.method === "PUT" && path === "/draft") ||
      (context.req.method === "POST" && (/^\/(?:publish|draft\/(?:schedule|review|correction))$/.test(path) || /^\/templates\/[^/]+\/apply$/.test(path)));
    if (guarded) {
      const version = context.req.header("If-Match");
      if (!version) return context.json({ error: "Reload the incident before changing its draft; a saved draft version is required." }, 428);
      if (!/^(?:[0-9A-HJKMNP-TV-Z]{26}|-):\d+$/.test(version)) return context.json({ error: "Invalid draft version." }, 400);
    }
    await next();
  });

  app.put("/api/app/incidents/:incidentId/draft", async (context) => {
    const incidentId = incidentIdFrom(context);
    if (!incidentId.success) return context.json({ error: "Invalid incident identifier.", issues: incidentId.error.issues }, 400);
    const parsed = incidentDraftSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Invalid incident draft.", issues: parsed.error.issues }, 400);
    try {
      const expectedVersion = context.req.header("If-Match")!;
      const requestedId = context.req.header("X-Draft-Id");
      if (requestedId !== undefined && (!ulidSchema.safeParse(requestedId).success || requestedId === expectedVersion.split(":")[0])) return context.json({ error: "A new draft identifier is required." }, 400);
      const draft = await service.saveDraft(incidentId.data, parsed.data, context.get("operator").id, expectedVersion, requestedId);
      return draft ? context.json({ draft }) : context.json({ error: "Incident not found." }, 404);
    } catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The draft could not be saved." }, 409); }
  });

  app.post("/api/app/incidents/:incidentId/draft/preview", async (context) => {
    const incidentId = incidentIdFrom(context);
    if (!incidentId.success) return context.json({ error: "Invalid incident identifier.", issues: incidentId.error.issues }, 400);
    const parsed = incidentDraftSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Invalid incident draft.", issues: parsed.error.issues }, 400);
    const preview = await service.preview(incidentId.data, parsed.data);
    return preview ? context.json({ preview }) : context.json({ error: "Incident not found." }, 404);
  });

  app.post("/api/app/incidents/:incidentId/publish", async (context) => {
    const incidentId = incidentIdFrom(context); const parsed = publishSchema.safeParse(await context.req.json().catch(() => null));
    if (!incidentId.success || !parsed.success) return context.json({ error: "Invalid publication request." }, 400);
    try {
      const update = await service.publish(incidentId.data, context.get("operator").id, { ...parsed.data, expectedVersion: context.req.header("If-Match")! });
      if (update) context.executionCtx.waitUntil(service.finishPublication(update));
      return update ? context.json({ update }) : context.json({ error: "A saved draft is required." }, 409);
    } catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The update could not be published." }, cause instanceof InvalidIncidentUpdateError ? 400 : 409); }
  });

  app.post("/api/app/incidents/:incidentId/draft/schedule", async (context) => {
    const incidentId = incidentIdFrom(context); const parsed = scheduleSchema.safeParse(await context.req.json().catch(() => null));
    if (!incidentId.success || !parsed.success) return context.json({ error: "Invalid scheduled publish request." }, 400);
    try { const draft = await service.schedule(incidentId.data, context.get("operator").id, parsed.data.publishAt, parsed.data.channels, context.req.header("If-Match")!); return draft ? context.json({ draft }, 202) : context.json({ error: "A saved draft is required." }, 409); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The update could not be scheduled." }, 409); }
  });

  app.post("/api/app/incidents/:incidentId/draft/review", async (context) => {
    const incidentId = incidentIdFrom(context);
    if (!incidentId.success) return context.json({ error: "Invalid incident identifier." }, 400);
    return (await service.review(incidentId.data, context.get("operator").id, context.req.header("If-Match")!)) ? context.json({ reviewed: true }) : context.json({ error: "A different operator must review a saved draft." }, 409);
  });

  app.post("/api/app/incidents/:incidentId/draft/correction", async (context) => {
    const incidentId = incidentIdFrom(context); const input = correctionSchema.safeParse(await context.req.json().catch(() => null));
    if (!incidentId.success || !input.success) return context.json({ error: "A published update from this incident is required." }, 400);
    return (await service.markCorrection(incidentId.data, input.data.updateId, context.req.header("If-Match")!)) ? context.json({ marked: true }) : context.json({ error: "Draft or published update not found." }, 409);
  });

  app.post("/api/app/incidents/:incidentId/internal-notes", async (context) => {
    const incidentId = incidentIdFrom(context); const input = internalNoteSchema.safeParse(await context.req.json().catch(() => null));
    if (!incidentId.success || !input.success) return context.json({ error: "An internal note is required." }, 400);
    try { return (await service.addInternalNote(incidentId.data, input.data.body, context.get("operator").id)) ? context.json({ created: true }, 201) : context.json({ error: "Incident not found." }, 404); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Internal note could not be saved." }, 400); }
  });

  app.post("/api/app/incidents/:incidentId/templates/:templateId/apply", async (context) => {
    const incidentId = incidentIdFrom(context); const templateId = ulidSchema.safeParse(context.req.param("templateId"));
    if (!incidentId.success || !templateId.success) return context.json({ error: "Invalid incident or template identifier." }, 400);
    try { const draft = await service.applyTemplate(incidentId.data, templateId.data, context.get("operator").id, context.req.header("If-Match")!); return draft ? context.json({ draft }) : context.json({ error: "Incident or template not found." }, 404); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Template could not be applied." }, 409); }
  });

  app.delete("/api/app/incidents/:incidentId", async (context) => {
    const incidentId = incidentIdFrom(context); const parsed = deleteSchema.safeParse(await context.req.json().catch(() => null));
    if (!incidentId.success || !parsed.success) return context.json({ error: "A deletion reason is required." }, 400);
    try {
      const operatorId = context.get("operator").id;
      const deletedAt = await service.delete(incidentId.data, parsed.data.reason, operatorId);
      if (deletedAt) context.executionCtx.waitUntil(service.finishDeletion(incidentId.data, operatorId, deletedAt));
      return deletedAt ? context.json({ deleted: true }) : context.json({ error: "Incident not found." }, 404);
    }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The incident could not be deleted." }, 409); }
  });
}
