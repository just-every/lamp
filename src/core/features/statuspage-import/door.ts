import { z } from 'zod';
import type { Hono } from 'hono';
import { createImportDoorHandler } from '../../../../modules/import-kit/src/door';
import { ownerClaimConfig } from '../../platform/auth/claim';
import type { AppBindings, AppEnv } from '../../app/types';
import type { StatuspageImportService } from './service';
import { statuspageTargets } from './targets';
import { createImportDoorRepository } from './door.repository';
import { importLimits } from './source';

export function registerImportDoor(app: Hono<AppEnv>, bindings: AppBindings, service: StatuspageImportService, changed: ()=>Promise<unknown>) {
  const repository = createImportDoorRepository(bindings.DB);
  app.get('/api/app/import-door/settings',async c=> {
    c.header('Cache-Control','no-store');
    return c.json(await repository.settings(ownerClaimConfig(bindings),c.get('operatorSession')));
  });
  app.put('/api/app/import-door/settings',async c=> {
    c.header('Cache-Control','no-store');
    const input = z.object({enabled:z.boolean(),revokedKids:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(100).optional()}).strict().safeParse(await c.req.json().catch(()=>null));
    if (!input.success) return c.json({error:'Choose whether to allow Business imports and which grant keys to revoke.'},400);
    const claim = ownerClaimConfig(bindings);
    if (!claim) return c.json({error:'The installation has no configured Business grant keys.'},409);
    await repository.save(claim,c.get('operatorSession'),input.data);
    return c.json(await repository.settings(claim,c.get('operatorSession')));
  });
  app.all('/api/rer/import/*',async c=> {
    const claim = ownerClaimConfig(bindings);
    if (!claim) return c.json({error:'not_found'},404);
    const owner = await repository.ownerId(claim.expectedEmail);
    if (!owner) return c.json({error:'not_found'},404);
    const handle = createImportDoorHandler({database:bindings.DB,targets:statuspageTargets,claim,ownerPrincipalId:owner,destination:'lamp',
      mapping:{version:'1'},format:'json',reversalPolicy:'preserve-conflicts',
      limits:{maxBytes:importLimits.maxBytes,maxRecords:importLimits.maxRecords},
      prepareSource:(bytes,context,namespace)=>service.prepareDoor(bytes,context,namespace),
    });
    const response = await handle(c.req.raw);
    if (response?.ok && ['/api/rer/import/apply','/api/rer/import/undo'].includes(c.req.path)) await changed();
    return response ?? c.notFound();
  });
}
