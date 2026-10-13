import type { Hono } from 'hono';
import type { AppEnv } from '../../app/types';
import type { AppServices } from '../../app/services';
import { createSetupRepository } from './repository';
export function registerSetupRoutes(app:Hono<AppEnv>,services:AppServices) {
  app.get('/',async (c,next)=> {
    try {if(!await services.publicSnapshots.hasCurrentSnapshot()&&!await createSetupRepository(c.env.DB).initialized())return c.text('This status page is not set up yet',503,{'Cache-Control':'no-store'});} catch { /* Snapshot outage response remains authoritative. */ }
    return next();
  });
  app.get('/setup/status',async c=> {
    c.header('Cache-Control','no-store');
    if(!await createSetupRepository(c.env.DB).initialized())return c.json({state:'setup_required'},409);
    return await services.pageSettings.get()?c.json({state:'ready'}):c.json({state:'unavailable'},503);
  });
}
