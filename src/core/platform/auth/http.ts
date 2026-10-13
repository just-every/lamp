import { AuthError, createAuthHandler, createSignInHandler, securityHeaders } from '@runeditrun/rer/modules/operator-auth';
import { createDependencies } from '@runeditrun/rer/modules/dependencies';
import { createIdpOwnerClaimHandler } from '@runeditrun/rer/modules/owner-claim';
import { authConfig } from './config';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
export async function authResponse(request:Request,env:AppBindings,services:AppServices):Promise<Response> {
  try {
    const auth=services.auth(),config=authConfig(env);
    const claim=createIdpOwnerClaimHandler({db:env.DB,authConfig:config,clientIp:()=>config.local?'loopback':request.headers.get('CF-Connecting-IP')??''});
    const dependency=await createDependencies({db:env.DB,origin:config.origin,name:'Lamp',provider:env.IDENTITY_PROVIDER,local:config.local,auth,
      claimOwner:token=>claim(new Request(config.origin+'/auth/owner-claim',{method:'POST',headers:{Host:new URL(config.origin).host,Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({token})}))}).handle(request);
    return dependency ?? await claim(request) ?? await createSignInHandler(auth,{
      setup:async()=> env.SETUP_TOKEN&&!await services.operators.initialized()?{instructions:'Use the setup token from your installation to claim the first owner.'}:null,
      links:()=>import.meta.env.DEV&&services.capturesMailLocally?[{href:'/__dev/outbox',label:'Open the local development outbox'}]:[],
    })(request) ?? await createAuthHandler(auth)(request) ?? new Response('Not found',{status:404});
  } catch(error) {return Response.json({error:error instanceof AuthError?error.code:'auth_unavailable'},{status:error instanceof AuthError?error.status:503,headers:securityHeaders()});}
}
