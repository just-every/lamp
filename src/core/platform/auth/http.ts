import { createOperatorRolesRepository } from '../../features/operators/roles.repository';
import { AuthError, createAuthHandler, createSignInHandler, securityHeaders } from '@runeditrun/rer/modules/operator-auth';
import { createDependencies } from '@runeditrun/rer/modules/dependencies';
import { createIdpOwnerClaimHandler, createOwnerClaimHandler } from '@runeditrun/rer/modules/owner-claim';
import { authConfig } from './config';
import { identitySettingsPage } from './identity-settings-page';
import { ownerClaimConfig } from './claim';
import { openDoorAtFirstClaim } from '../../features/statuspage-import/door-claim';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
export async function authResponse(request:Request,env:AppBindings,services:AppServices):Promise<Response> {
  const response = await authResponseInternal(request,env,services);
  if (response.status === 403) {
    const session = await services.auth().getSession(request);
    if (session) await createOperatorRolesRepository(env.DB).denied(session.operator.id,request.method,new URL(request.url).pathname);
  }
  return response;
}
async function authResponseInternal(request:Request,env:AppBindings,services:AppServices):Promise<Response> {
  try {
    const auth=services.auth(),config=authConfig(env),url=new URL(request.url);
    const signedIn = await signedInOwnerRedirect(request, auth);
    if (signedIn) return signedIn;
    // A host-configured key set selects native signed claims. Claims never choose their own authority.
    const trust = ownerClaimConfig(env);
    let response = trust ? await createOwnerClaimHandler({ db: env.DB, authConfig: config,
      clientIp: () => config.local ? 'loopback' : request.headers.get('CF-Connecting-IP') ?? '',
      ...trust,
    })(request) : null;
    if (!response) {
      const claim=createIdpOwnerClaimHandler({db:env.DB,authConfig:config,clientIp:()=>config.local?'loopback':request.headers.get('CF-Connecting-IP')??''});
      const dependency=await createDependencies({db:env.DB,origin:config.origin,name:'Lamp',provider:env.IDENTITY_PROVIDER,local:config.local,auth,
        claimOwner:token=>claim(new Request(config.origin+'/auth/owner-claim',{method:'POST',headers:{Host:new URL(config.origin).host,Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({token})}))}).handle(request);
      response = dependency ?? await claim(request) ?? await createSignInHandler(auth,{
        setup:async()=> env.SETUP_TOKEN&&!await services.operators.initialized()?{instructions:'Use the setup token from your installation to claim the first owner.'}:null,
      })(request) ?? await createAuthHandler(auth)(request) ?? new Response('Not found',{status:404});
    }
    // A claim's answer (the first claim, or already claimed) and every sign-in
    // that starts a session open a Business-provisioned install's door when no
    // owner choice is recorded yet. The claim already committed, so a failure
    // here is healed by the owner's next claim answer or sign-in.
    if (env.RER_IMPORT_DOOR === 'on' && (['/auth/bootstrap', '/auth/owner-claim'].includes(url.pathname) || response.headers.has('Set-Cookie'))) {
      await openDoorAtFirstClaim(env).catch(error => console.error('Lamp could not open the Business import door at the owner claim.', error));
    }
    if (url.pathname === '/auth/settings/identity' && request.method === 'POST'
      && (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === 'application/x-www-form-urlencoded'
      && response.status === 303 && response.headers.get('location') === '/auth/settings/identity') {
      const headers = new Headers(response.headers);
      headers.set('Location', '/auth/settings/identity?saved=1');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    if (url.pathname === '/auth/owner-signin' && response.status >= 400) return ownerSignInRefused(response);
    return request.method === 'GET' && url.pathname === '/auth/settings/identity'
      ? await identitySettingsPage(response, { origin: config.origin, providers: config.providers, identityProvider: env.IDENTITY_PROVIDER || undefined, local: Boolean(import.meta.env?.DEV), saved: url.searchParams.get('saved') === '1' })
      : response;
  } catch(error) {
    const response=Response.json({error:error instanceof AuthError?error.code:'auth_unavailable'},{status:error instanceof AuthError?error.status:503,headers:securityHeaders()});
    return new URL(request.url).pathname === '/auth/owner-signin' ? ownerSignInRefused(response) : response;
  }
}

// A missing, used or expired owner grant sends the person to /signin; the grant route never shows them raw JSON.
async function ownerSignInRefused(response:Response):Promise<Response> {
  const body=(response.headers.get('content-type')??'').includes('json')?await response.json().catch(()=>null) as {error?:unknown}|null:null;
  const notice=typeof body?.error==='string'&&/^[a-z_]+$/.test(body.error)?body.error:'invalid_or_expired';
  return new Response(null,{status:303,headers:{...securityHeaders(),Location:`/signin?notice=${notice}`}});
}

export async function signedInOwnerRedirect(request: Request, auth: ReturnType<AppServices['auth']>): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/signin' || !['GET', 'HEAD'].includes(request.method)) return null;
  const session = await auth.getSession(request);
  return session
    ? new Response(null, { status: 303, headers: { ...securityHeaders(), Location: '/app' } })
    : null;
}
