import type { Hono } from "hono";

import type { AppEnv } from "../../app/types";
import type { PageExportService } from "./service";

export function registerPageExportRoutes(app: Hono<AppEnv>, service: PageExportService) {
  app.get("/api/app/page-data", async () => {
    const file = await service.exportFile();
    return new Response(`${JSON.stringify(file, null, 2)}\n`, { headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename=lamp-page-data-${file.exportedAt.slice(0, 10)}.json`,
      "Cache-Control": "no-store",
    } });
  });

  // A dry run: what the file holds and whether this page can take it. Writes nothing.
  app.post("/api/app/page-data/check", async (context) => {
    const input = await context.req.json().catch(() => null);
    return context.json({ check: await service.check(input) });
  });

  app.post("/api/app/page-data/restore", async (context) => {
    const input = await context.req.json().catch(() => null);
    const check = await service.restore(input);
    return context.json({ check }, check.ok ? 200 : 409);
  });
}
