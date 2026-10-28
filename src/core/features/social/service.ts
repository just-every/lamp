import { parseAgentAction, type AgentAction } from "../incidents/agent-action";
import { DeliveryService } from "../../../../modules/integrations/core/delivery.ts";
import { D1SqlDatabase } from "../../../../modules/integrations/core/database.ts";
import { IntegrationsRepository } from "../../../../modules/integrations/core/repository.ts";
import type { DeliveryProtocol, TrustedTransport } from "../../../../modules/integrations/core/types.ts";
import { createUlid, nowIso } from "../../shared/ids";
import { createSocialRepository, type SocialAccount } from "./repository";
import { SocialAuthenticationError, socialOrigin, prepareSocialPost, prepareSocialRequest, extractSocialReceipt, classifySocialResponse, type SocialNetwork } from "./networks";
import { renderSocialPost } from "./messages";
import { createSocialTransport } from "./transport";
import { openCredential, sealCredential } from "./sealing";

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
  let agentAdmission:((id:string,action:AgentAction,generation:string)=>Promise<boolean>)|undefined;
  async function dispatchPosts(limit:number,postId?:string,action?:AgentAction,admitted=false) {
      if(options.effectsPaused||options.unavailable)return;
      const origin=await options.publicOrigin();
      for(const pending of await repository.pending(limit,postId)) {
        const saved=action??parseAgentAction(pending.agentActionJson);
        if(saved&&!admitted){if(agentAdmission)await agentAdmission(pending.id,saved,String((await delivery.get(pending.id))?.attempts??0));continue;}
        try {
          const account=await accountFor(pending.accountId);
          let post=pending;
          if(!post.body) {
            const thread=await repository.thread(post);
            const text=renderSocialPost(account.network,[post.prefix,saved?.label,saved?.approvers.length?`Approved by ${saved.approvers.map(person=>person.name).join(", ")}`:null].filter(Boolean).join(" · "),post.lifecycle,post.customerImpact,new URL(post.incidentId?`/incidents/${encodeURIComponent(post.reference)}`:`/maintenance/${encodeURIComponent(post.reference)}`,origin).href);
            const credential=await openCredential(account.sealedCredential,account.id,options.webhookSecret);
            const wire=await prepareSocialPost(account,credential,{id:post.id,text,createdAt:post.queuedAt,parent:thread.at(-1),root:thread[0]},provider);
            post=(await repository.freeze(post.id,text,wire.body))!;
          }
          await delivery.enqueue({id:post.id,tenant:namespace,destinationId:post.accountId,event:post.incidentId?'incident.update':'maintenance.notice',protocol:`lamp-social-${account.network}`,body:post.body!},{maxAttempts:6,retryDelaysMs});
        } catch {
          // No provider or credential text enters a log. A malformed publication
          // remains in the durable outbox for recovery and raises an alert.
          await options.operatorAlert({eventId:`delivery-failed/${pending.id}`,title:'Lamp could not deliver a social post',text:'A social publication could not be prepared. Review the connected social accounts.'});
        }
      }
      for(const id of postId?[postId]:await integrations.due(Date.now(),limit)){
        const retained=await repository.post(id),saved=action??parseAgentAction(retained?.agentActionJson);
        if(saved&&!admitted){if(agentAdmission)await agentAdmission(id,saved,String((await delivery.get(id))?.attempts??0));continue;}
        await delivery.dispatch(id);
      }
      for(const failed of await repository.failed())if(!postId||failed.id===postId)await options.operatorAlert({eventId:`delivery-failed/${failed.id}`,title:'Lamp could not deliver a social post',text:'A social account failed to accept a published update. Review the social delivery log in Settings.'});
  }
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
    setAgentAdmission(admit:(id:string,action:AgentAction,generation:string)=>Promise<boolean>){agentAdmission=admit;},
    retainAgentAction:repository.retainAgentAction,
    dispatchPending:(limit=100,postId?:string)=>dispatchPosts(limit,postId),
    dispatchAdmittedPost:(id:string,action?:AgentAction)=>dispatchPosts(1,id,action,true),
  };
}
export type SocialService=ReturnType<typeof createSocialService>;
