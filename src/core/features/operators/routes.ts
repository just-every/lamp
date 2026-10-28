import type { Hono, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { AuthError, type OperatorAuth, type Session } from '@runeditrun/rer/modules/operator-auth';
import type { AppEnv } from '../../app/types';
import { createOperatorRepository, type StoredOperator } from './repository';
export type OperatorReadSession = { session: Session; operator: StoredOperator };
const idSchema = z.union([z.uuid(),z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)]);
const inviteSchema = z.object({email:z.email(),displayName:z.string().trim().min(1).max(120)}).strict();
export function requireOperator(auth: () => OperatorAuth, authorizedRead?: (request: Request) => OperatorReadSession | undefined): MiddlewareHandler<AppEnv> {
  return async (c,next) => {
    // A document's internal GETs share its just-validated authority. Only the
    // server can put the exact Request object in this request-local registry.
    const read = c.req.method === 'GET' ? authorizedRead?.(c.req.raw) : undefined;
    if (read) {
      c.set('operator', read.operator);
      c.set('operatorSession', read.session);
      await next();
      return;
    }
    const session = await auth().getSession(c.req.raw);
    if (!session) return c.json({error:'A valid operator session is required.'},401);
    if(!['GET','HEAD','OPTIONS'].includes(c.req.method)&&(c.req.header('Origin')!==new URL(c.req.url).origin||c.req.header('Sec-Fetch-Site')==='cross-site'))return c.json({error:'A same-origin request is required.'},403);
    c.set('operator',await createOperatorRepository(c.env.DB).view(session.operator));
    c.set('operatorSession',session);
    await next();
  };
}
export function registerOperatorRoutes(app:Hono<AppEnv>,auth:()=>OperatorAuth,publicPageHost:string,options:{localMail?:boolean;onErased?:()=>Promise<void>}={}) {
  app.onError((error,c) => c.json({error:error instanceof AuthError ? error.code : 'Operation unavailable.'},error instanceof AuthError ? error.status as 400 : 503));
  app.get('/api/app/session',c=>c.json({operator:c.get('operator'),publicPageHost}));
  app.post('/api/app/session/signout',async c=> {
    const result=await auth().signOut(c.req.raw);
    const form=c.req.header('Content-Type')?.startsWith('application/x-www-form-urlencoded');
    return new Response(null,{status:form?303:204,headers:{'Set-Cookie':result.cookie,...(form?{Location:'/signin'}:{})}});
  });
  app.get('/api/app/editor-config',async c=> {
    // Only the active setup operator opens the editor. Base's owner falls back to
    // another owner when the claim operator is inactive or the claim is closed.
    const session=await auth().requireEditorOwner(c.req.raw);
    if(!await createOperatorRepository(c.env.DB).isSetupOperator(session.operator.id))throw new AuthError('owner_required',403);
    c.header('Cache-Control','no-store');
    const managementOrigin=c.env.RER_MANAGEMENT_ORIGIN||'',installationId=c.env.RER_INSTALLATION_ID||'';
    return c.json({enabled:Boolean(managementOrigin&&installationId),managementOrigin,installationId});
  });
  app.get('/api/app/operators',async c=> {await auth().listOperators(c.req.raw);return c.json({operators:await createOperatorRepository(c.env.DB).listOperators()});});
  app.get('/api/app/operators/invited',async c=> {await auth().listOperators(c.req.raw);return c.json({operators:await createOperatorRepository(c.env.DB).listInvitedOperators()});});
  app.get('/api/app/operators/former',async c=> {await auth().listOperators(c.req.raw);return c.json({operators:await createOperatorRepository(c.env.DB).listFormerOperators()});});
  app.post('/api/app/operators/invite',async c=> {
    const parsed=inviteSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return c.json({error:'An email and display name are required.'},400);
    await auth().invite(c.req.raw,{...parsed.data,role:'owner'});await createOperatorRepository(c.env.DB).recordInvitation(parsed.data.email,c.get('operator').id);
    // Local development suppresses mail, so the panel must not say an email went out.
    return c.json({email:options.localMail?'suppressed':'sent'},202);
  });
  app.post('/api/app/operators/:operatorId/revoke-access',async c=> {
    const id=idSchema.safeParse(c.req.param('operatorId'));if(!id.success)return c.json({error:'Invalid operator ID.'},400);
    await auth().setOperatorStatus(c.req.raw,id.data,'inactive');await createOperatorRepository(c.env.DB).recordRevocation(id.data,c.get('operator').id);return c.body(null,204);
  });
  app.delete('/api/app/operators/:operatorId',async c=> {
    const id=idSchema.safeParse(c.req.param('operatorId'));if(!id.success)return c.json({error:'Invalid operator ID.'},400);
    // Base mutation requires POST even when the product's erasure door uses DELETE.
    const request=new Request(c.req.raw,{method:'POST'});
    const repository=createOperatorRepository(c.env.DB),before=await repository.version(id.data);
    const target=before?.status==='invited'
      ? await auth().cancelInvitation(request,id.data)
      : await auth().setOperatorStatus(request,id.data,'inactive');
    if(!before||target.status!=='inactive'||target.version!==before.version+(before.status==='inactive'?0:1))throw new AuthError('authority_changed',409);
    await repository.erase(target,c.get('operatorSession'));await options.onErased?.();return c.body(null,204);
  });
}
