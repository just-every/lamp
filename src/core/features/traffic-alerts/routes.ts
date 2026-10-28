import { z } from 'zod';
import type { Hono } from 'hono';
import type { AppEnv } from '../../app/types';
import type { TrafficStorage } from './storage';
const schema = z.object({ multiple: z.number().min(1.1).max(100) }).strict();
export function registerTrafficAlertRoutes(app: Hono<AppEnv>, storage: TrafficStorage) {
  app.get('/api/app/traffic-alerts', async c => {
    c.header('Cache-Control', 'private, no-store');
    return c.json({ settings: await storage.settings() });
  });
  app.put('/api/app/traffic-alerts', async c => {
    if (!['owner', 'admin'].includes(c.get('operatorSession').operator.role)) return c.json({ error: 'An owner or admin must configure traffic alerts.' }, 403);
    const input = schema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Choose a traffic multiple from 1.1 to 100.', issues: input.error.issues }, 400);
    c.header('Cache-Control', 'private, no-store');
    return c.json({ settings: await storage.configure(input.data) });
  });
}
