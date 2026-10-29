import { DeliveryService } from "../../../../modules/integrations/core/delivery.ts";
import { D1SqlDatabase } from "../../../../modules/integrations/core/database.ts";
import { IntegrationsRepository } from "../../../../modules/integrations/core/repository.ts";
import type { DeliveryProtocol, TrustedTransport } from "../../../../modules/integrations/core/types.ts";
import { createUlid, nowIso } from "../../shared/ids";
import { createSocialRepository, type SocialAccount, type SocialPost } from "./repository";
import { SocialAuthenticationError, socialOrigin, prepareSocialPost, prepareSocialRequest, extractSocialReceipt, classifySocialResponse, type SocialNetwork } from "./networks";
import { renderSocialPost } from "./messages";
import { createSocialTransport } from "./transport";
import { openCredential, sealCredential } from "./sealing";

import { agentEffectHandled, registerAgentEffectHandler } from '../agent-door/final-dispatch';
import { nativeAgentAttribution } from '../agent-door/provenance.repository';
import { hashOpaqueToken } from '../../platform/security/opaque-tokens';

const namespace="lamp-social";
const retryDelaysMs=[60_000,300_000,900_000,1_200_000,1_200_000];
const view=({sealedCredential:_sealed,identifier:_identifier,...account}:SocialAccount)=>account;
const pathFor=(network:SocialNetwork)=>network==='x'?'/2/tweets':network==='bluesky'?'/xrpc/com.atproto.repo.createRecord':'/api/v1/statuses';
export function createSocialService(db:D1Database,options:{webhookSecret?:string;effectsPaused?:boolean;developmentReceiver?:string;publicOrigin:()=>Promise<string>;unavailable?:string|null;operatorAlert:(input:{eventId:string;title:string;text:string})=>Promise<void>}) {
  const repository=createSocialRepository(db);
  const integrations=new IntegrationsRepository(new D1SqlDatabase(db as never),namespace);
  const provider=createSocialTransport({developmentReceiver:options.developmentReceiver});
  const accountFor=async (id:string)=>{
    const account=await repository.account(id);
    if(!account)throw new Error('Social account unavailable.');
    return account;
  };
  const protocols:DeliveryProtocol[]=(['x','bluesky','mastodon'] as const).map(network=>({
    id:`lamp-social-${network}`,
    async prepare(envelope) {
      const account=await accountFor(envelope.destinationId);
      if(account.network!==network)throw new Error('Social account unavailable.');
      // Authorization is resolved only at the transport boundary, never saved
      // in the immutable envelope or the shared delivery/attempt logs.
      return {url:`${socialOrigin(network,account.host)}${pathFor(network)}`,headers:{'x-lamp-post-id':envelope.id},body:envelope.body};
    },
    classify:response=>classifySocialResponse(network,response),
  }));
  const transport:TrustedTransport={async send(request){
    const post=await repository.post(request.headers['x-lamp-post-id']!);
    if(!post || post.postId)throw new Error('social_post_already_recorded');
    const account=await accountFor(post.accountId);
    const credential=await openCredential(account.sealedCredential,account.id,options.webhookSecret);
    let wire;
    try { wire=await prepareSocialRequest(account,credential,request.body,provider,post.id); }
    catch (cause) {
      if(cause instanceof SocialAuthenticationError)return {status:cause.status,headers:cause.headers,body:''};
      throw cause;
    }
    const response=await provider.send(wire);
    const receipt=extractSocialReceipt(account.network,response);
    // A misconfigured/custom edge must never turn a reflected bearer secret
    // into a receipt returned by the delivery-log API.
    if(receipt && (receipt.id.includes(credential) || receipt.cid?.includes(credential)))return {status:response.status,headers:{},body:''};
    if(receipt)await repository.receipt(post.id,receipt);
    return response;
  }};
  const delivery=new DeliveryService({repository:integrations,protocols,transport});
  async function textFor(post: SocialPost) {
    const account=await accountFor(post.accountId);
    const attribution=await nativeAgentAttribution(db,post.incidentId?'incident-update':'maintenance-notice',post.eventId);
    const prefix=attribution?`${post.prefix} Prepared by ${attribution.label}.`:post.prefix;
    return renderSocialPost(account.network,prefix,post.lifecycle,post.customerImpact,new URL(post.incidentId?`/incidents/${encodeURIComponent(post.reference)}`:`/maintenance/${encodeURIComponent(post.reference)}`,await options.publicOrigin()).href);
  }
  async function preparePost(pending: SocialPost) {
    const account=await accountFor(pending.accountId);
    let post=pending;
    if(!post.body) {
      const thread=await repository.thread(post);
      const text=await textFor(post);
      const credential=await openCredential(account.sealedCredential,account.id,options.webhookSecret);
      const wire=await prepareSocialPost(account,credential,{id:post.id,text,createdAt:post.queuedAt,parent:thread.at(-1),root:thread[0]},provider);
      post=(await repository.freeze(post.id,text,wire.body))!;
    }
    await delivery.enqueue({id:post.id,tenant:namespace,destinationId:post.accountId,event:post.incidentId?'incident.update':'maintenance.notice',protocol:`lamp-social-${account.network}`,body:post.body!},{maxAttempts:6,retryDelaysMs});
  }
  registerAgentEffectHandler(db,'social',{
    async describe(id) {
      const post=await repository.post(id);
      if(!post)return null;
      const account=await repository.account(post.accountId);
      // Disconnection removes the live effect. The retained envelope still
      // reaches native preflight, which records its rejection without sending.
      if(!account)return null;
      const content=post.text??await textFor(post);
      const envelope=await delivery.get(id);
      return {eventId:post.eventId,recipient:`${account.network}: ${account.name}`,content,counterparty:'public' as const,
        attempt:envelope?.attempts??0,
        revision:await hashOpaqueToken(JSON.stringify({event:post.eventId,account:account.id,host:account.host,credential:account.sealedCredential,content}))};
    },
    async dispatch(id) {
      if(options.effectsPaused||options.unavailable)throw new Error('Social delivery is unavailable.');
      let envelope=await delivery.get(id);
      if(!envelope){const post=(await repository.pending(100,id))[0];if(!post)throw new Error('Social post is not currently eligible.');await preparePost(post);envelope=await delivery.get(id);}
      if(!envelope)throw new Error('Social post is unavailable.');
      await delivery.dispatch(id);
    },
  });
  return {
    async list() {return {accounts:(await repository.accounts()).map(view),postByDefault:await repository.postByDefault(),posts:await repository.log(),unavailable:options.unavailable??null};},
    async add(input:{network:SocialNetwork;name:string;prefix:string;credential:string;host?:string;identifier?:string;scopes:string[]},operatorId:string) {
      if(options.unavailable)throw new Error(options.unavailable);
      if(input.network==='x'&&!input.scopes.includes('tweet.write'))throw new Error('X requires an OAuth 2.0 user token with tweet.write.');
      if(input.network==='mastodon'&&!input.scopes.includes('write:statuses'))throw new Error('Mastodon requires write:statuses.');
      if(input.network==='bluesky'&&!input.identifier?.trim())throw new Error('Enter the Bluesky account handle.');
      const id=createUlid();
      const account:SocialAccount={id,network:input.network,name:input.name,prefix:input.prefix,host:socialOrigin(input.network,input.host),identifier:input.identifier?.trim()??'',sealedCredential:await sealCredential(input.credential,id,options.webhookSecret),createdAt:nowIso()};
      await repository.add(account,operatorId);
      return view(account);
    },
    setDefault:repository.setDefault,
    remove:repository.remove,
    publicationStatements:repository.publicationStatements,
    maintenanceStatements:repository.maintenanceStatements,
    log:repository.log,
    async dispatchPending(limit=100) {
      if(options.effectsPaused||options.unavailable)return;
      for(const pending of await repository.pending(limit)) {
        if(await agentEffectHandled(db,'social',pending.id))continue;
        try { await preparePost(pending); }
        catch {
          // Provider and credential details stay outside retained failure text.
          await options.operatorAlert({eventId:`delivery-failed/${pending.id}`,title:'Lamp could not deliver a social post',text:'A social publication could not be prepared. Review the connected social accounts.'});
        }
      }
      await delivery.recoverExpired();
      for(const id of await integrations.due(Date.now(),limit)){
        if(await agentEffectHandled(db,'social',id))continue;
        await delivery.dispatch(id);
      }
      for(const failed of await repository.failed())await options.operatorAlert({eventId:`delivery-failed/${failed.id}`,title:'Lamp could not deliver a social post',text:'A social account failed to accept a published update. Review the social delivery log in Settings.'});
    },
  };
}
export type SocialService=ReturnType<typeof createSocialService>;
