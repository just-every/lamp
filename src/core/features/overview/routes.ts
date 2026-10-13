import { z } from "zod";
import type { Hono } from "hono";

import type { AppEnv } from "../../app/types";
import type { OverviewService } from "./service";

export function registerOverviewRoutes(app: Hono<AppEnv>, service: OverviewService) {
  app.get("/api/app/overview", async (context) => context.json({ overview: await service.get() }));
  for (const action of ['check-sender', 'check-subscribe', 'accept-address'] as const) {
    app.post(`/api/app/overview/${action}`, async (context) => {
      if (context.req.header('Sec-Fetch-Site') === 'cross-site') return context.json({ error: 'Cross-site setup actions are not accepted.' }, 403);
      if (!z.object({}).strict().safeParse(await context.req.json().catch(() => null)).success) return context.json({ error: 'Invalid setup action.' }, 400);
      try {
        const message = action === 'check-sender' ? await service.setup.checkSender(context.get('operator').email)
          : action === 'check-subscribe' ? await service.setup.checkSubscribe()
          : (await service.setup.acceptAddress(), 'Your current public address is selected.');
        return context.json({ message });
      } catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : 'The setup check could not be completed.' }, 400); }
    });
  }
  app.post('/api/app/overview/first-run', async (context) => {
    if (context.req.header('Sec-Fetch-Site') === 'cross-site') return context.json({ error: 'Cross-site setup actions are not accepted.' }, 403);
    if (!z.object({}).strict().safeParse(await context.req.json().catch(() => null)).success) return context.json({ error: 'Invalid setup action.' }, 400);
    try { await service.setup.completeFirstRun(); return context.json({ complete: true }); }
    catch (cause) { return context.json({ error: cause instanceof Error ? cause.message : 'First-run setup could not be completed.' }, 400); }
  });
  app.post('/api/app/overview/open-public', async (context) => {
    if (context.req.header('Sec-Fetch-Site') === 'cross-site') return context.text('Cross-site setup actions are not accepted.', 403);
    const json = context.req.header('Accept') === 'application/json';
    if (json && !z.object({}).strict().safeParse(await context.req.json().catch(() => null)).success) return context.json({ error: 'Invalid setup action.' }, 400);
    try {
      const url = await service.setup.openPublic();
      return json ? context.json({ url }) : context.redirect(url, 303);
    } catch {
      const error = 'The public page is not reachable yet. Check the deployment address and return to Overview.';
      return json ? context.json({ error }, 503) : context.text(error, 503);
    }
  });
}
