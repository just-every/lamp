import { z } from 'zod';
import type { Hono } from 'hono';
import type { OperatorAuth } from '@runeditrun/rer/modules/operator-auth';
import { createImportDoorHandler, DoorError, type ImportDoorSource } from '../../../../modules/import-kit/src/door';
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
import { openDoorAtFirstClaim } from './door-claim';
import { importLimits } from './source';
import { isImportSource } from './adapters';
import { refusal } from './routes';
import { reviewedPage } from './door-plan';

/** The whole upload is one JSON value, so one record may be the whole bundle.
 * It carries each saved response as JSON text, so it may take twice the 8 MiB
 * of responses the source readers accept, as Move in's request always could. */
const doorLimits = { maxBytes: importLimits.maxBytes * 2, maxRecords: importLimits.maxRecords, maxRecordBytes: importLimits.maxBytes * 2 };
const operatorPrefix = '/api/operator/import/';
/** A dry run imports within 30 minutes of its review instant, as Move in always
 * allowed, and one dated in the future never does. */
const REVIEW_WINDOW_MS = 30 * 60 * 1000;
function expired(asOf: string | undefined) {
  const instant = Date.parse(asOf ?? '');
  return !Number.isFinite(instant) || instant > Date.now() + 60_000 || instant < Date.now() - REVIEW_WINDOW_MS;
}
const EXPIRED = 'This dry run has expired. Run the dry run again.';
const CHANGED = 'The source or this page changed since the dry run. Review a fresh dry run.';
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

/** The door's own request bound: a larger body never reaches it. */
const MAX_DOOR_BODY = 100_000;
/** A door request Lamp reads first (a plan or undo): its JSON input, and the
 * same bytes as a fresh request for the door, which reads its body again.
 * Null when the body exceeds the door's bound. */
async function readFirst(request: Request) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) for (const reader = request.body.getReader(); ;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DOOR_BODY) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  chunks.reduce((offset, chunk) => { bytes.set(chunk, offset); return offset + chunk.byteLength; }, 0);
  let input: { uploadId?: unknown; planId?: unknown } | null;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { input = null; }
  return { input, request: new Request(request.url, { method: request.method, headers: request.headers, body: request.body ? bytes : null }) };
}

/** The `attempt` an upload of a source imported and undone before carries; a
 * bundle that is not a JSON object is refused by its preparation instead. */
function uploadAttempt(bytes: Uint8Array) {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as { attempt?: unknown } | null;
    return typeof value?.attempt === 'number' ? value.attempt : 0;
  } catch { return 0; }
}

export function registerImportDoor(app: Hono<AppEnv>, bindings: AppBindings, service: StatuspageImportService, changed: ()=>Promise<unknown>, auth: () => OperatorAuth) {
  const repository = createImportDoorRepository(bindings.DB);
  /** Plans an upload exactly as Move in plans a source, under the door's authority. */
  const prepareBytes = async (bytes: Uint8Array, namespace: string, principalId: string, operatorId: string, authority: D1Sql, business: boolean, asOf?: string): Promise<Prepared> => {
    const valueHash = sha256(canonicalJson(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Json));
    return { ...await service.prepareDoor(bytes, namespace, principalId, operatorId, authority, business, asOf), valueHash };
  };
  const prepare = async (key: string, namespace: string, uploadId: unknown, principalId: string, operatorId: string, authority: D1Sql, business: boolean): Promise<Prepared> => {
    const bytes = typeof uploadId === 'string' ? await repository.uploadBytes(key, namespace, uploadId) : null;
    if (!bytes) throw new Error('No complete upload to plan.');
    return prepareBytes(bytes, namespace, principalId, operatorId, authority, business);
  };
  /** What every successful apply or undo changes, whichever authority approved
   * it. The door's response is read once and answered with the same body. */
  const settle = async (path: string, response: Response, fence: D1Sql): Promise<Response> => {
    if (!response.ok || !['apply', 'undo'].includes(path.slice(path.lastIndexOf('/') + 1))) return response;
    const body = await response.text();
    const { job } = JSON.parse(body) as { job?: { id: string; state: string } };
    if (job) {
      if (path.endsWith('/undo')) await service.forgetUndoneInvites(job.id, fence);
      await changed();
    }
    return new Response(body, { status: response.status, headers: response.headers });
  };

  /** Business's dry run (an unstarted plan the door holds) imports within the same
   * 30 minutes: its apply is refused, and so is a plan of the same bytes, which
   * names the expired plan for Business to undo before it plans them afresh. */
  const refuseExpired = async (action: string, namespace: string, input: { uploadId?: unknown; planId?: unknown } | null | undefined) => {
    const key = await repository.key(bindings);
    let planId: string | undefined;
    if (action === 'apply' && typeof input?.planId === 'string') planId = (await repository.unstarted(key, namespace, input.planId))?.id;
    if (action === 'plan' && typeof input?.uploadId === 'string') {
      const bytes = await repository.uploadBytes(key, namespace, input.uploadId);
      const existing = bytes ? await repository.planOf(key, namespace, sha256(bytes)) : null;
      if (existing && !existing.started) planId = existing.id;
    }
    const saved = planId ? await repository.planSnapshot(key, planId) : null;
    const asOf = saved ? reviewedPage(saved.plan).asOf : undefined;
    if (asOf && expired(asOf)) throw new DoorError(EXPIRED, 409, action === 'plan' ? { planId } : undefined);
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
    const action = c.req.method === 'POST' ? c.req.path.slice('/api/rer/import/'.length) : '';
    const read = ['plan', 'apply'].includes(action) ? await readFirst(c.req.raw) : undefined;
    if (read === null) return c.json({error:'request_too_large'},413);
    const planning = action === 'plan' ? read?.input : undefined;
    const handle = createImportDoorHandler({database:bindings.DB,targets:statuspageTargets,claim,installationId:key,ownerPrincipalId:owner,destination:'lamp',
      format:'json',limits:doorLimits,reversalPolicy:'preserve-conflicts',
      // Resolved once the grant is verified and before it is recorded: a Business
      // plan or apply of a dry run past its review window is refused and writes nothing.
      source:async namespace=> {
        if (isImportSource(namespace)) await refuseExpired(action, namespace, read?.input);
        return importSource(namespace,planning === undefined || !isImportSource(namespace) ? null : prepare(key,namespace,planning?.uploadId,owner,owner,authority,true));
      },
    });
    const response = await handle(read?.request ?? c.req.raw);
    return response ? settle(c.req.path, response, authority) : c.notFound();
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
    // On a Business-provisioned install the owner's claim opens the door; Move in
    // never records it closed first.
    await openDoorAtFirstClaim(bindings);
    const key = await repository.key(bindings);
    await repository.ensureSettings(key, authority);
    const action = c.req.path.slice(operatorPrefix.length);
    // An apply that can start an import (the namespace holds a dry run nobody
    // started) is read first, to check that dry run; any other apply, a resume,
    // reaches the door as it arrives.
    const starting = c.req.method === 'POST' && action === 'apply' && Boolean(await repository.unstartedPending(key, name));
    const read = c.req.method === 'POST' && (['plan', 'undo'].includes(action) || starting) ? await readFirst(c.req.raw) : undefined;
    if (read === null) return c.json({error:'request_too_large'},413);
    const input = read?.input ?? null, request = read?.request ?? c.req.raw;
    const handler = async (prepared: Promise<Prepared> | null) => createImportOperatorHandler({database:bindings.DB,targets:statuspageTargets,installationId:key,appOrigin:authOrigin(bindings),
      ownerEmail:session.operator.email,ownerPrincipalId:principal,namespace:name,destination:'lamp',format:'json',limits:doorLimits,reversalPolicy:'preserve-conflicts',
      ...(await importSource(name,prepared))!,
      authorize:async()=>authority,
    });
    const cancel = async (planId: string) => {
      const headers = new Headers(request.headers); headers.delete('Content-Length'); headers.set('Content-Type','application/json');
      const cancelled = await (await handler(null))(new Request(new URL(`${operatorPrefix}undo`, c.req.url), { method: 'POST', headers, body: JSON.stringify({ planId }) }));
      if (!cancelled?.ok) throw new Error('An earlier dry run could not be discarded.');
    };
    // A dry run or undo replaces an earlier dry run nobody started importing.
    const discardUnstarted = async (keep: { bundle?: string; planId?: string }) => {
      const pending = await repository.unstartedPending(key, name);
      if (pending && pending.bundle_sha256 !== keep.bundle && pending.id !== keep.planId) await cancel(pending.id);
    };
    /** The review instant and page fingerprint of a saved dry run. */
    const reviewOf = async (planId: string) => {
      const saved = await repository.planSnapshot(key, planId);
      return saved ? reviewedPage(saved.plan) : {};
    };
    /** Whether an unstarted dry run still plans exactly as reviewed: within its
     * review window, its bytes prepared again at its review instant against the
     * page as it is now. With `now`, the same bytes prepared at the current time,
     * the clock since must also have changed nothing they import. */
    const stillPlans = async (reviewed: { asOf?: string; page?: string }, bytes: Uint8Array | null, now?: Prepared) => {
      if (!bytes || !reviewed.asOf || !reviewed.page || expired(reviewed.asOf)) return false;
      const again = await prepareBytes(bytes, name, principal, session.operator.id, authority, false, reviewed.asOf);
      return again.page === reviewed.page && (!now || again.shape === now.shape);
    };
    let prepared: Promise<Prepared> | null = null, attempt = 0;
    if (action === 'plan' && typeof input?.uploadId === 'string') {
      const bytes = await repository.uploadBytes(key, name, input.uploadId);
      const bundle = bytes ? sha256(bytes) : null;
      if (bytes) attempt = uploadAttempt(bytes);
      const existing = bundle ? await repository.planOf(key, name, bundle) : null;
      if (bytes && bundle && !existing?.started) {
        try {
          // Move in reports a source it imported before the door as already imported, as it always has.
          const before = await service.importedBefore(bytes, name, session);
          if (before) return c.json(before, 200, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          // A dry run is always of the page as it is now, at the current time: an
          // earlier one of these bytes stands only while it is within its review
          // window and still plans the same now, and is replaced otherwise.
          const now = await prepareBytes(bytes, name, principal, session.operator.id, authority, false);
          if (!existing || !await stillPlans(await reviewOf(existing.id), bytes, now)) prepared = Promise.resolve(now);
        } catch (cause) {
          // Move in shows the owner why a source cannot be imported, as it always has.
          return c.json({ error: refusal(cause) }, 400);
        }
        try { if (prepared && existing) await cancel(existing.id); await discardUnstarted({ bundle }); }
        catch (cause) { return c.json({ error: refusal(cause) }, 409); }
      }
    }
    // MOVE-001: an import starts only from a dry run reviewed within 30 minutes,
    // of the page as it still is; otherwise the owner reviews a fresh one.
    const starts = action === 'apply' && typeof input?.planId === 'string' ? await repository.unstarted(key, name, input.planId) : null;
    if (starts) {
      const reviewed = await reviewOf(starts.id);
      if (reviewed.asOf && expired(reviewed.asOf)) return c.json({ error: EXPIRED }, 409);
      let current: boolean;
      try { current = await stillPlans(reviewed, await repository.bundleBytes(key, name, starts.bundle_sha256)); }
      catch (cause) { return c.json({ error: refusal(cause) }, 409); }
      if (!current) return c.json({ error: CHANGED }, 409);
    }
    if (action === 'undo' && typeof input?.planId === 'string') {
      try { await discardUnstarted({ planId: input.planId }); await repository.assertNewest(input.planId); }
      catch (cause) { return c.json({ error: refusal(cause) }, 409); }
    }
    const answered = await (await handler(prepared))(request);
    if (!answered) return c.notFound();
    // Move in's refusal of an import whose source changed since its dry run: the
    // dry run another one replaced, or another dry run's reviewed fingerprint.
    if (action === 'apply' && [403, 404].includes(answered.status)) {
      const { error } = await answered.clone().json().catch(() => ({})) as { error?: string };
      if (error === 'plan_not_found' || (starts && error === 'review_fingerprint_mismatch')) return c.json({ error: CHANGED }, 409, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    }
    const response = await settle(c.req.path, answered, authority);
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
