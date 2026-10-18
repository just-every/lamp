import { z } from 'zod';
import type { Hono } from 'hono';
import type { OperatorAuth } from '@runeditrun/rer/modules/operator-auth';
import { createImportDoorHandler, type ImportDoorSource } from '../../../../modules/import-kit/src/door';
import { createImportOperatorHandler } from '../../../../modules/import-kit/src/door/operator';
import { canonicalJson, sha256, type D1Sql } from '../../../../modules/import-kit/src/d1/index';
import type { Json } from '../../../../modules/import-kit/src/types';
import { ownerClaimConfig } from '../../platform/auth/claim';
import { authConfig, authOrigin } from '../../platform/auth/config';
import { sessionAuthority } from '../../platform/auth/authority';
import type { AppBindings, AppEnv } from '../../app/types';
import type { StatuspageImportService } from './service';
import { statuspageTargets } from './targets';
import { createImportDoorRepository } from './door.repository';
import { importLimits } from './source';
import { isImportSource } from './adapters';
import { refusal } from './routes';

/** The whole upload is one JSON value, so one record may be the whole bundle.
 * It carries each saved response as JSON text, so it may take twice the 8 MiB
 * of responses the source readers accept, as Move in's request always could. */
const doorLimits = { maxBytes: importLimits.maxBytes * 2, maxRecords: importLimits.maxRecords, maxRecordBytes: importLimits.maxBytes * 2 };
const operatorPrefix = '/api/operator/import/';
type Prepared = Awaited<ReturnType<StatuspageImportService['prepareDoor']>> & { valueHash: string };

/** Lamp's one allow-list (adapters.ts `importSources`): every source Move in
 * offers, each one door namespace, for the owner's Move in and Business grants
 * alike. Lamp plans an upload with its native snapshot and existing imports,
 * which takes D1 reads, so a plan request prepares the upload it names before
 * the door reads it again: the parser returns the prepared records for exactly
 * those bytes and the mapping maps them. Other door actions never parse or map.
 * A preparation failure is the parser's, so the door's own refusals keep their order. */
function importSource(name: string, prepared: Promise<Prepared> | null): Promise<ImportDoorSource | null> | null {
  if (!isImportSource(name)) return null;
  if (!prepared) return Promise.resolve({ parse() { throw new Error('Only a plan reads an upload.'); }, mapping: { version: '1', map() { throw new Error('Only a plan maps records.'); } } });
  return prepared.then(
    ready => ({
      parse(value: Json) {
        if (sha256(canonicalJson(value)) !== ready.valueHash) throw new Error('The upload changed after it was prepared.');
        return ready.records;
      },
      mapping: ready.mapping,
    }),
    (error: unknown) => ({ parse() { throw error; }, mapping: { version: '1', map() { throw error; } } }),
  );
}

export function registerImportDoor(app: Hono<AppEnv>, bindings: AppBindings, service: StatuspageImportService, changed: ()=>Promise<unknown>, auth: () => OperatorAuth) {
  const repository = createImportDoorRepository(bindings.DB);
  /** Plans an upload exactly as Move in plans a source, under the door's authority. */
  const prepare = async (key: string, namespace: string, uploadId: unknown, principalId: string, operatorId: string, authority: D1Sql, business: boolean): Promise<Prepared> => {
    const bytes = typeof uploadId === 'string' ? await repository.uploadBytes(key, namespace, uploadId) : null;
    if (!bytes) throw new Error('No complete upload to plan.');
    const valueHash = sha256(canonicalJson(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Json));
    return { ...await service.prepareDoor(bytes, namespace, principalId, operatorId, authority, business), valueHash };
  };
  /** What every successful apply or undo changes, whichever authority approved it. */
  const settle = async (path: string, response: Response, fence: D1Sql) => {
    if (!response.ok || !['apply', 'undo'].includes(path.slice(path.lastIndexOf('/') + 1))) return;
    const { job } = await response.clone().json() as { job?: { id: string; state: string } };
    if (!job) return;
    if (path.endsWith('/undo')) await service.forgetUndoneInvites(job.id, fence);
    await changed();
  };

  app.get('/api/app/import-door/settings',async c=> {
    c.header('Cache-Control','no-store');
    return c.json(await repository.settings(await repository.key(bindings),ownerClaimConfig(bindings),c.get('operatorSession')));
  });
  app.put('/api/app/import-door/settings',async c=> {
    c.header('Cache-Control','no-store');
    const input = z.object({enabled:z.boolean(),revokedKids:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(100).optional()}).strict().safeParse(await c.req.json().catch(()=>null));
    if (!input.success) return c.json({error:'Choose whether to allow Business imports and which grant keys to revoke.'},400);
    const claim = ownerClaimConfig(bindings);
    if (!claim) return c.json({error:'The installation has no configured Business grant keys.'},409);
    const key = await repository.key(bindings);
    await repository.save(key,c.get('operatorSession'),input.data);
    return c.json(await repository.settings(key,claim,c.get('operatorSession')));
  });

  // Business grants: off until the owner opts in, and only with RER's key ring.
  app.all('/api/rer/import/*',async c=> {
    const claim = ownerClaimConfig(bindings);
    if (!claim) return c.json({error:'not_found'},404);
    const owner = await repository.ownerId(claim.expectedEmail);
    if (!owner) return c.json({error:'not_found'},404);
    const key = await repository.key(bindings);
    const authority = { sql: "EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active')", params: [owner] };
    const planning = c.req.path === '/api/rer/import/plan' && c.req.method === 'POST' ? await c.req.raw.clone().json().catch(() => null) as { uploadId?: unknown } | null : undefined;
    const handle = createImportDoorHandler({database:bindings.DB,targets:statuspageTargets,claim,installationId:key,ownerPrincipalId:owner,destination:'lamp',
      format:'json',limits:doorLimits,reversalPolicy:'preserve-conflicts',
      source:namespace=>importSource(namespace,planning === undefined || !isImportSource(namespace) ? null : prepare(key,namespace,planning?.uploadId,owner,owner,authority,true)),
    });
    const response = await handle(c.req.raw);
    if (response) await settle(c.req.path, response, authority);
    return response ?? c.notFound();
  });

  // The owner's own Move in: the current owner session, same-origin requests,
  // one source per request (X-Import-Source), on the same allow-list and door key.
  app.all(`${operatorPrefix}*`,async c=> {
    const session = await auth().getSession(c.req.raw);
    if (!session) return c.json({error:'owner_required'},401);
    const authority = sessionAuthority(session);
    if (!await repository.allowed(authority)) return c.json({error:'owner_required'},401);
    const name = c.req.header('X-Import-Source') ?? '';
    if (!isImportSource(name)) return c.json({error:'unknown_import_source'},400);
    const principal = await repository.principalId(authConfig(bindings).OWNER_EMAIL);
    if (!principal) return c.json({error:'owner_required'},409);
    const key = await repository.key(bindings);
    await repository.ensureSettings(key, authority);
    const action = c.req.path.slice(operatorPrefix.length);
    const input = c.req.method === 'POST' && ['plan', 'undo'].includes(action) ? await c.req.raw.clone().json().catch(() => null) as { uploadId?: unknown; planId?: unknown } | null : null;
    const handler = async (prepared: Promise<Prepared> | null) => createImportOperatorHandler({database:bindings.DB,targets:statuspageTargets,installationId:key,appOrigin:authOrigin(bindings),
      ownerEmail:session.operator.email,ownerPrincipalId:principal,namespace:name,destination:'lamp',format:'json',limits:doorLimits,reversalPolicy:'preserve-conflicts',
      ...(await importSource(name,prepared))!,
      authorize:async()=>authority,
    });
    // A dry run or undo replaces an earlier dry run nobody started importing.
    const discardUnstarted = async (keep?: string) => {
      const pending = await repository.unstartedPending(key, name);
      if (!pending || pending.bundle_sha256 === keep) return;
      const headers = new Headers(c.req.raw.headers); headers.delete('Content-Length'); headers.set('Content-Type','application/json');
      const cancelled = await (await handler(null))(new Request(new URL(`${operatorPrefix}undo`, c.req.url), { method: 'POST', headers, body: JSON.stringify({ planId: pending.id }) }));
      if (!cancelled?.ok) throw new Error('An earlier dry run could not be discarded.');
    };
    let prepared: Promise<Prepared> | null = null, attempt = 0;
    if (action === 'plan' && typeof input?.uploadId === 'string') {
      const bytes = await repository.uploadBytes(key, name, input.uploadId);
      const bundle = bytes ? sha256(bytes) : null;
      if (bytes) attempt = Number((JSON.parse(new TextDecoder().decode(bytes)) as { attempt?: unknown }).attempt ?? 0);
      if (bundle && !await repository.planned(key, name, bundle)) {
        prepared = prepare(key, name, input.uploadId, principal, session.operator.id, authority, false);
        // Move in shows the owner why a source cannot be imported, as it always has.
        try { await prepared; } catch (cause) { return c.json({ error: refusal(cause) }, 400); }
        try { await discardUnstarted(bundle); } catch (cause) { return c.json({ error: refusal(cause) }, 409); }
      }
    }
    if (action === 'undo' && typeof input?.planId === 'string') {
      try { await discardUnstarted(); await repository.assertNewest(input.planId); }
      catch (cause) { return c.json({ error: refusal(cause) }, 409); }
    }
    const response = await (await handler(prepared))(c.req.raw);
    if (!response) return c.notFound();
    await settle(c.req.path, response, authority);
    if (action !== 'plan' || !response.ok) return response;
    const plan = await response.json() as { planId: string };
    const saved = await repository.planSnapshot(key, plan.planId);
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    // These bytes are a plan whose import was undone; importing the source again
    // is a new application of it, which Move in uploads afresh.
    if (saved?.jobId && await repository.reversed(saved.jobId)) return c.json({ error: 'import_undone_upload_again', details: { attempt: attempt + 1 } }, 409, headers);
    return c.json(saved ? { ...plan, ...await service.planReport(saved.plan, saved.jobId, session) } : plan, 200, headers);
  });
}
