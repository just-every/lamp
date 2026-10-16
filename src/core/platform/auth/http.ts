import { AuthError, createAuthHandler, createSignInHandler, securityHeaders } from '@runeditrun/rer/modules/operator-auth';
import { createDependencies } from '@runeditrun/rer/modules/dependencies';
import { createIdpOwnerClaimHandler, createOwnerClaimHandler } from '@runeditrun/rer/modules/owner-claim';
import { authConfig } from './config';
import { identitySettingsPage } from './identity-settings-page';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
export async function authResponse(request:Request,env:AppBindings,services:AppServices):Promise<Response> {
  try {
    const auth=services.auth(),config=authConfig(env);
    // A host-configured key set selects native signed claims. Claims never choose their own authority.
    if (env.RER_OWNER_CLAIM_PUBLIC_KEYS) {
      const signed = await createOwnerClaimHandler({ db: env.DB, authConfig: config,
        clientIp: () => config.local ? 'loopback' : request.headers.get('CF-Connecting-IP') ?? '',
        issuer: env.RER_OWNER_CLAIM_ISSUER ?? '', installationId: env.RER_OWNER_CLAIM_INSTALLATION_ID ?? '',
        appOrigin: config.origin, expectedEmail: config.OWNER_EMAIL,
        publicKeys: JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS),
      })(request);
      if (signed) return signed;
    }
    const claim=createIdpOwnerClaimHandler({db:env.DB,authConfig:config,clientIp:()=>config.local?'loopback':request.headers.get('CF-Connecting-IP')??''});
    const dependency=await createDependencies({db:env.DB,origin:config.origin,name:'Lamp',provider:env.IDENTITY_PROVIDER,local:config.local,auth,
      claimOwner:token=>claim(new Request(config.origin+'/auth/owner-claim',{method:'POST',headers:{Host:new URL(config.origin).host,Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({token})}))}).handle(request);
    const response = dependency ?? await claim(request) ?? await createSignInHandler(auth,{
      setup:async()=> env.SETUP_TOKEN&&!await services.operators.initialized()?{instructions:'Use the setup token from your installation to claim the first owner.'}:null,
    })(request) ?? await createAuthHandler(auth)(request) ?? new Response('Not found',{status:404});
    const url = new URL(request.url);
    if (url.pathname === '/auth/settings/identity' && request.method === 'POST'
      && (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === 'application/x-www-form-urlencoded'
      && response.status === 303 && response.headers.get('location') === '/auth/settings/identity') {
      const headers = new Headers(response.headers);
      headers.set('Location', '/auth/settings/identity?saved=1');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return request.method === 'GET' && url.pathname === '/auth/settings/identity'
      ? await identitySettingsPage(response, { origin: config.origin, providers: config.providers, identityProvider: env.IDENTITY_PROVIDER || undefined, local: Boolean(import.meta.env?.DEV), saved: url.searchParams.get('saved') === '1' })
      : response;
  } catch(error) {return Response.json({error:error instanceof AuthError?error.code:'auth_unavailable'},{status:error instanceof AuthError?error.status:503,headers:securityHeaders()});}
}
