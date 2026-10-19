import { z } from "zod";
import type { Hono } from "hono";

import type { AppEnv } from "../../app/types";
import { componentGroupSchema, componentHistoryCorrectionSchema, componentSchema, componentStandingClaimSchema, componentUpdateSchema, componentGroupUpdateSchema } from "../../shared/schemas";
import { ulidSchema } from "../../shared/ids";
import type { ComponentsService } from "./service";

export function registerComponentRoutes(app: Hono<AppEnv>, service: ComponentsService) {
  app.get("/api/app/components", async (context) => {
    const [components, groups] = await Promise.all([service.list(), service.listGroups()]);
    return context.json({ components, groups });
  });

  const moveSchema = z.object({ direction: z.enum(["up", "down"]), expectedIds: z.array(ulidSchema).min(2).max(1000), groupId: ulidSchema.nullable().default(null) }).strict();
  for (const [path, kind] of [["components", "components"], ["component-groups", "groups"]] as const) {
    app.post(`/api/app/${path}/:id/move`, async (context) => {
      const id = ulidSchema.safeParse(context.req.param("id"));
      const input = moveSchema.safeParse(await context.req.json().catch(() => null));
      if (!id.success || !input.success) return context.json({ error: "A current list and move direction are required." }, 400);
      try {
        await service.move(kind, id.data, input.data.direction, input.data.expectedIds, input.data.groupId);
        return context.json({ moved: true });
      } catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The order could not be changed." }, 409); }
    });
  }

  app.get("/api/app/components/:componentId/history", async (context) => {
    const componentId = ulidSchema.safeParse(context.req.param("componentId"));
    if (!componentId.success) return context.json({ error: "Invalid component identifier.", issues: componentId.error.issues }, 400);
    const history = await service.history(componentId.data);
    return history ? context.json(history) : context.json({ error: "Component not found." }, 404);
  });

  app.post("/api/app/components", async (context) => {
    const parsed = componentSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Invalid component.", issues: parsed.error.issues }, 400);
    const component = await service.create(parsed.data, context.get("operator").id);
    return context.json({ component }, 201);
  });

  app.put("/api/app/components/:componentId", async (context) => {
    const componentId = ulidSchema.safeParse(context.req.param("componentId"));
    if (!componentId.success) return context.json({ error: "Invalid component identifier.", issues: componentId.error.issues }, 400);
    const parsed = componentUpdateSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Invalid component.", issues: parsed.error.issues }, 400);
    const component = await service.update(componentId.data, parsed.data);
    return component ? context.json({ component }) : context.json({ error: "Component not found." }, 404);
  });

  app.delete("/api/app/components/:componentId", async (context) => {
    const componentId = ulidSchema.safeParse(context.req.param("componentId"));
    if (!componentId.success) return context.json({ error: "Invalid component identifier.", issues: componentId.error.issues }, 400);
    return (await service.remove(componentId.data, context.get("operator").id)) ? context.body(null, 204) : context.json({ error: "Component not found." }, 404);
  });

  app.post("/api/app/component-groups", async (context) => {
    const parsed = componentGroupSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Invalid component group.", issues: parsed.error.issues }, 400);
    return context.json({ group: await service.createGroup(parsed.data) }, 201);
  });

  app.put("/api/app/component-groups/:groupId", async (context) => {
    const groupId = ulidSchema.safeParse(context.req.param("groupId"));
    if (!groupId.success) return context.json({ error: "Invalid component group identifier.", issues: groupId.error.issues }, 400);
    const parsed = componentGroupUpdateSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Invalid component group.", issues: parsed.error.issues }, 400);
    return (await service.updateGroup(groupId.data, parsed.data)) ? context.body(null, 204) : context.json({ error: "Component group not found." }, 404);
  });

  app.delete("/api/app/component-groups/:groupId", async (context) => {
    const groupId = ulidSchema.safeParse(context.req.param("groupId"));
    if (!groupId.success) return context.json({ error: "Invalid component group identifier.", issues: groupId.error.issues }, 400);
    return (await service.removeGroup(groupId.data, context.get("operator").id)) ? context.body(null, 204) : context.json({ error: "Component group not found." }, 404);
  });

  app.put("/api/app/components/:componentId/standing-claim", async (context) => {
    const componentId = ulidSchema.safeParse(context.req.param("componentId"));
    if (!componentId.success) return context.json({ error: "Invalid component identifier.", issues: componentId.error.issues }, 400);
    const parsed = componentStandingClaimSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Invalid component claim.", issues: parsed.error.issues }, 400);

    const component = await service.setStandingClaim(componentId.data, parsed.data.state, context.get("operator").id);
    return component ? context.json({ component }) : context.json({ error: "Component not found." }, 404);
  });

  app.post("/api/app/components/:componentId/history-corrections", async (context) => {
    const componentId = ulidSchema.safeParse(context.req.param("componentId"));
    if (!componentId.success) return context.json({ error: "Invalid component identifier.", issues: componentId.error.issues }, 400);
    const parsed = componentHistoryCorrectionSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Invalid history correction.", issues: parsed.error.issues }, 400);
    try {
      await service.correctHistory(componentId.data, parsed.data, context.get("operator").id);
      return context.body(null, 204);
    } catch (cause) {
      return context.json({ error: cause instanceof Error ? cause.message : "The history correction could not be saved." }, cause instanceof Error && cause.message === "Component not found." ? 404 : 400);
    }
  });
}
