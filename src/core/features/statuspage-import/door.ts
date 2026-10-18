import { z } from 'zod';
import type { Hono } from 'hono';
import { createImportDoorHandler, type ImportDoorSource } from '../../../../modules/import-kit/src/door';
import { canonicalJson, sha256 } from '../../../../modules/import-kit/src/d1/index';
import type { Json } from '../../../../modules/import-kit/src/types';
import { ownerClaimConfig } from '../../platform/auth/claim';
import type { AppBindings, AppEnv } from '../../app/types';
import type { StatuspageImportService } from './service';
import { statuspageTargets } from './targets';
import { createImportDoorRepository } from './door.repository';
import { importLimits } from './source';

/** Lamp's server-owned allow-list: one door namespace per source product. The
 * door refuses any other grant namespace with 403 before it writes anything. */
const doorSources = new Set(['statuspage', 'sorry']);
/** The whole upload is one JSON value, so one record may be the whole bundle. */
const doorLimits = { maxBytes: importLimits.maxBytes, maxRecords: importLimits.maxRecords, maxRecordBytes: importLimits.maxBytes };
type Prepared = Awaited<ReturnType<StatuspageImportService['prepareDoor']>> & { valueHash: string };

/** One source's parser and mapping for this request. Lamp plans an upload with
 * its native snapshot and existing imports, which takes D1 reads, so a plan
 * request prepares the upload it names before the door reads it again: the
 * parser returns the prepared records for exactly those bytes and the mapping
 * maps them. Other door actions never parse or map. A preparation failure is
 * the parser's, so the door's own refusals keep their order. */
function importSource(name: string, prepare: (() => Promise<Prepared>) | null): Promise<ImportDoorSource | null> | null {
  if (!doorSources.has(name)) return null;
  if (!prepare) return Promise.resolve({ parse() { throw new Error('Only a plan reads an upload.'); }, mapping: { version: '1', map() { throw new Error('Only a plan maps records.'); } } });
  return prepare().then(
    prepared => ({
      parse(value: Json) {
        if (sha256(canonicalJson(value)) !== prepared.valueHash) throw new Error('The upload changed after it was prepared.');
        return prepared.records;
      },
      mapping: prepared.mapping,
    }),
    (error: unknown) => ({ parse() { throw error; }, mapping: { version: '1', map() { throw error; } } }),
  );
}

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
    // The permanent door key: the RER owner-claim installation id Lamp is configured with.
    const installationId = claim.installationId;
    const planning = c.req.path === '/api/rer/import/plan' && c.req.method === 'POST' ? c.req.raw.clone() : null;
    const prepare = (namespace: string) => async (): Promise<Prepared> => {
      const input = await planning!.json().catch(() => null) as { uploadId?: unknown } | null;
      const bytes = typeof input?.uploadId === 'string' ? await repository.uploadBytes(installationId, namespace, input.uploadId) : null;
      if (!bytes) throw new Error('No complete upload to plan.');
      const valueHash = sha256(canonicalJson(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Json));
      return { ...await service.prepareDoor(bytes, namespace, owner), valueHash };
    };
    const handle = createImportDoorHandler({database:bindings.DB,targets:statuspageTargets,claim,installationId,ownerPrincipalId:owner,destination:'lamp',
      format:'json',limits:doorLimits,reversalPolicy:'preserve-conflicts',
      source:namespace=>importSource(namespace,planning ? prepare(namespace) : null),
    });
    const response = await handle(c.req.raw);
    if (response?.ok && ['/api/rer/import/apply','/api/rer/import/undo'].includes(c.req.path)) await changed();
    return response ?? c.notFound();
  });
}
