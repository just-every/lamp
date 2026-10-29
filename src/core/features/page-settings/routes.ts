import { ThemeValidationError } from "./theme-safety";
import type { ThemeAssetKind } from "./theme-assets";
import type { Hono } from "hono";

import type { AppEnv } from "../../app/types";
import { pageSettingsSchema } from "../../shared/schemas";
import { UnavailablePageTemplateError, UnsupportedMailIdentityError, type PageSettingsService } from "./service";

const BRAND_ARTIFACTS = { mark: "assets/mark.svg", favicon: "assets/favicon.svg", social: "assets/og.svg", logo: "assets/logo" } as const;

export function registerPageSettingsRoutes(app: Hono<AppEnv>, service: PageSettingsService, readArtifact: (key: string) => Promise<{ bytes: ArrayBuffer; contentType: string } | null>) {
  app.get("/api/app/page-settings/embed-preview", async (context) => {
    const artifact = await readArtifact("status.json");
    if (!artifact) return context.json({ error: "Your page has not been published yet." }, 404);
    return new Response(artifact.bytes, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  });

  // The published mark, favicon and social image, served on the app host so Settings and Your page can
  // show them wherever the page host lives. Images only: nothing in them can run here.
  app.get("/api/app/page-settings/brand/:kind", async (context) => {
    const kind = context.req.param("kind");
    const key = Object.hasOwn(BRAND_ARTIFACTS, kind) ? BRAND_ARTIFACTS[kind as keyof typeof BRAND_ARTIFACTS] : undefined;
    const artifact = key ? await readArtifact(key) : null;
    if (!artifact || !/^image\//.test(artifact.contentType)) return context.json({ error: "Not published yet." }, 404);
    return new Response(artifact.bytes, { headers: { "Content-Type": artifact.contentType, "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=60" } });
  });

  app.get("/api/app/page-settings", async (context) => {
    const settings = await service.get();
    return settings ? context.json({ settings }) : context.json({ error: "Page settings are not configured." }, 404);
  });

  // Native first-run initialization uses the same owner/session/CSRF admission
  // as later settings edits. Existing installations are never overwritten.
  app.post("/api/app/page-settings", async (context) => {
    const parsed = pageSettingsSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ code: "invalid_page_settings" }, 400);
    if (await service.get()) return context.json({ code: "page_already_initialized" }, 409);
    await service.ensureInitial(parsed.data);
    return context.json({ settings: await service.get() }, 201);
  });

  app.put("/api/app/page-settings", async (context) => {
    const parsed = pageSettingsSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "Invalid page settings.", issues: parsed.error.issues }, 400);

    if (parsed.data.theme && !["owner", "admin"].includes(context.get("operatorSession").operator.role)) {
      const current = await service.get();
      if (JSON.stringify(parsed.data.theme) !== JSON.stringify(current?.theme)) return context.json({ error: "Only a page owner or admin can change its theme." }, 403);
    }
    try {
      const settings = await service.update(parsed.data);
      return settings ? context.json({ settings }) : context.json({ error: "Page settings are not configured." }, 404);
    } catch (cause) {
      if (cause instanceof ThemeValidationError || cause instanceof UnsupportedMailIdentityError || cause instanceof UnavailablePageTemplateError) return context.json({ error: cause.message }, 400);
      throw cause;
    }
  });

  app.post("/api/app/page-settings/theme-assets/:kind", async context => {
    if (!["owner", "admin"].includes(context.get("operatorSession").operator.role)) return context.json({ error: "Only a page owner or admin can change theme assets." }, 403);
    const kind = context.req.param("kind");
    if (kind !== "font" && kind !== "header") return context.json({ error: "Unknown theme asset." }, 404);
    const body = await context.req.parseBody().catch(() => null);
    const file = body?.file;
    if (!(file instanceof File)) return context.json({ error: "Choose a file to upload." }, 400);
    try { return context.json({ settings: await service.uploadThemeAsset(kind as ThemeAssetKind, { bytes: await file.arrayBuffer(), contentType: file.type }) }); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : "Asset could not be saved." }, 400); }
  });
  app.delete("/api/app/page-settings/theme-assets/:kind", async context => {
    if (!["owner", "admin"].includes(context.get("operatorSession").operator.role)) return context.json({ error: "Only a page owner or admin can remove theme assets." }, 403);
    const kind = context.req.param("kind");
    if (kind !== "font" && kind !== "header") return context.json({ error: "Unknown theme asset." }, 404);
    return context.json({ settings: await service.removeThemeAsset(kind as ThemeAssetKind) });
  });

  app.post("/api/app/page-settings/logo", async (context) => {
    const body = await context.req.parseBody().catch(() => null);
    const logo = body?.logo;
    if (!(logo instanceof File)) return context.json({ error: "Upload a logo file in the logo field." }, 400);
    try {
      const settings = await service.uploadLogo({ bytes: await logo.arrayBuffer(), contentType: logo.type }, context.get("operator").id);
      return settings ? context.json({ settings }) : context.json({ error: "Page settings are not configured." }, 404);
    } catch (cause) {
      return context.json({ error: cause instanceof Error ? cause.message : "The logo could not be saved." }, 400);
    }
  });

  app.delete("/api/app/page-settings/logo", async (context) => {
    const settings = await service.removeLogo(context.get("operator").id);
    return settings ? context.json({ settings }) : context.json({ error: "Page settings are not configured." }, 404);
  });
}
