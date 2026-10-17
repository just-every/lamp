import { z } from "zod";
import type { Hono } from "hono";
import type { AppEnv } from "../../app/types";
import { catalogueSchema } from "./catalogue-schema";
import { CatalogueChangedError } from "./catalogue.repository";
import type { CatalogueService } from "./catalogue-service";

const previewSchema = z.union([z.object({ csv: z.string().min(1).max(1_000_000) }).strict(), z.object({ catalogue: catalogueSchema, revision: z.number().int().nonnegative() }).strict()]);
const applySchema = z.object({ catalogue: catalogueSchema, revision: z.number().int().nonnegative(), reviewToken: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();

export function registerCatalogueRoutes(app: Hono<AppEnv>, service: CatalogueService) {
  app.get("/api/app/components/bulk", async context => context.json(await service.read()));
  app.post("/api/app/components/bulk/preview", async context => {
    const input = previewSchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "Check the component catalogue.", issues: input.error.issues }, 400);
    try { return context.json(await service.preview(input.data)); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The component catalogue could not be reviewed." }, cause instanceof CatalogueChangedError ? 409 : 400); }
  });
  app.post("/api/app/components/bulk/apply", async context => {
    const input = applySchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "A complete reviewed catalogue is required.", issues: input.error.issues }, 400);
    try { return context.json(await service.apply(input.data, context.get("operator").id)); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "The component catalogue could not be applied." }, cause instanceof CatalogueChangedError ? 409 : 400); }
  });
}
