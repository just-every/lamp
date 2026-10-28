import type { Hono } from 'hono';
import type { AppEnv } from '../../app/types';
import type { AppServices } from '../../app/services';
import { createSetupRepository } from './repository';
import { createOperatorRepository } from '../operators/repository';
import { pageSettingsSchema } from '../../shared/schemas';

// Setup is never undone while a Worker runs, so each isolate asks D1 only until it sees the owner.
const claimed=new WeakSet<D1Database>();
const notSetUp = (status: 503) => new Response('This status page is not set up yet', { status, headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' } });

export function registerSetupRoutes(app:Hono<AppEnv>,services:AppServices) {
  // The owner initializer is a production lifecycle step, shared by native
  // installers and disposable verification. It grants no identity or session.
  app.post('/setup', async c => {
    const session = await services.auth().getSession(c.req.raw);
    if (!session || !await createOperatorRepository(c.env.DB).isSetupOperator(session.operator.id)) return c.json({ code: 'owner_required' }, 401);
    if (c.req.header('Origin') !== new URL(c.req.url).origin || c.req.header('Sec-Fetch-Site') === 'cross-site') return c.json({ code: 'origin_required' }, 403);
    if (await services.pageSettings.get()) return c.json({ code: 'already_configured' }, 409);
    const parsed = pageSettingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ code: 'invalid_page_settings' }, 400);
    await services.pageSettings.ensureInitial(parsed.data);
    await services.publicSnapshots.rebuild(true);
    return new Response(null, { status: 303, headers: { Location: '/app', 'Cache-Control': 'no-store' } });
  });
  // Until the owner completes setup, the page host's home answers 503, as the
  // page readiness declaration's pendingSetupStatuses says. A deployment that
  // stored its page settings has already published a snapshot; that page keeps
  // its body, so a visitor still sees it.
  app.get('/',async (c,next)=> {
    if(claimed.has(c.env.DB))return next();
    let initialized:boolean;
    try {initialized=await createSetupRepository(c.env.DB).initialized();} catch {return next(); /* Snapshot outage response remains authoritative. */}
    if(initialized){claimed.add(c.env.DB);return next();}
    await next();
    const rendered=c.res;
    const headers=new Headers(rendered.headers);
    headers.set('Cache-Control','no-store');headers.delete('ETag');headers.delete('Last-Modified');
    // Hono copies the replaced response's headers onto a new one unless it is cleared first.
    c.res=undefined;
    c.res=rendered.status===200?new Response(rendered.body,{status:503,headers}):notSetUp(503);
  });
  app.get('/setup/status',async c=> {
    c.header('Cache-Control','no-store');
    if(!await createSetupRepository(c.env.DB).initialized())return c.json({state:'setup_required'},409);
    return await services.pageSettings.get()?c.json({state:'ready'}):c.json({state:'unavailable'},503);
  });
}
