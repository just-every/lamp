import type { Hono } from "hono";

import type { AppEnv } from "../../app/types";
import { pageSettingsSchema } from "../../shared/schemas";
import { UnsupportedMailIdentityError, type PageSettingsService } from "./service";

export function registerPageSettingsRoutes(app: Hono<AppEnv>, service: PageSettingsService) {
  app.get("/api/app/page-settings", async (context) => {
    const settings = await service.get();
    return settings ? context.json({ settings }) : context.json({ error: "Page settings are not configured." }, 404);
  });

  app.put("/api/app/page-settings", async (context) => {
    const parsed = pageSettingsSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Invalid page settings.", issues: parsed.error.issues }, 400);

    try {
      const settings = await service.update(parsed.data);
      return settings ? context.json({ settings }) : context.json({ error: "Page settings are not configured." }, 404);
    } catch (cause) {
      if (cause instanceof UnsupportedMailIdentityError) return context.json({ error: cause.message }, 400);
      throw cause;
    }
  });

  app.post("/api/app/page-settings/logo", async (context) => {
    const body = await context.req.parseBody().catch(() => null);
    const logo = body?.logo;
    if (!(logo instanceof File)) return context.json({ error: "Upload a logo file in the logo field." }, 400);
    try {
      const settings = await service.uploadLogo({ bytes: await logo.arrayBuffer(), contentType: logo.type });
      return settings ? context.json({ settings }) : context.json({ error: "Page settings are not configured." }, 404);
    } catch (cause) {
      return context.json({ error: cause instanceof Error ? cause.message : "The logo could not be saved." }, 400);
    }
  });

  app.delete("/api/app/page-settings/logo", async (context) => {
    const settings = await service.removeLogo();
    return settings ? context.json({ settings }) : context.json({ error: "Page settings are not configured." }, 404);
  });
}
