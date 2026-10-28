import type { AgentAction } from "../incidents/agent-action";
import { isMailPreparationError, type MailMessage, type MailSender } from "../../platform/mail";
import { hashOpaqueToken } from "../../platform/security/opaque-tokens";
import type { SubscriberRepository } from "./repository";
import type { SubscriberTokenScope } from "./tokens";

/** Native CSV/operator intake shares public confirmation tokens and one durable
 * address allowance. Preparation precedes the claim; transport follows it. */
export function createIntakeConfirmationSender(repository:SubscriberRepository,options:{
  mail:()=>MailSender;
  from:()=>Promise<string>;
  pageName:()=>Promise<string>;
  issue:(subscriberId:string,scope:SubscriberTokenScope,expiresAt:string|null)=>Promise<{token:string}>;
  send:(mail:MailSender,subscriberId:string,message:MailMessage)=>Promise<void>;
}) {
  return async (subscriberId:string,origin:string,actor:string|null,ownerOnly:boolean,action?:AgentAction):Promise<boolean>=>{
    const subscriber=await repository.findSubscriber(subscriberId);
    if(!subscriber||subscriber.state!=="pending"||!await repository.intake.has(subscriberId))return false;
    const deadline=new Date(Date.parse(subscriber.createdAt)+72*60*60_000).toISOString();
    if(Date.parse(deadline)<=Date.now())return false;
    const recipient=subscriber.channel==="email"?subscriber.destination:subscriber.contactEmail;
    if(!recipient)return false;
    const mail=options.mail(),from=await options.from(),pageName=await options.pageName();
    const confirm=await options.issue(subscriberId,"confirm",deadline);
    const unsubscribe=await options.issue(subscriberId,"unsubscribe",null);
    const manage=await options.issue(subscriberId,"manage",null);
    const emailHash=await hashOpaqueToken(`confirmation-address:${recipient.trim().toLowerCase()}`);
    const now=new Date().toISOString();
    if(!await repository.intake.claimInvitation(subscriberId,emailHash,now,actor,ownerOnly,action))return false;
    try {
      await options.send(mail,subscriberId,{
        from,to:recipient,subject:`Confirm your ${pageName} subscription`,
        text:`${pageName}${action ? `\nRequested by ${action.label}.${action.approvers.length ? ` Approved by ${action.approvers.map(person=>person.name).join(", ")}.` : ""}` : ""}\n\nConfirm this subscription before ${deadline}: ${new URL(`/confirm-subscription/${encodeURIComponent(confirm.token)}`,origin).href}\n\nIf you do nothing, you will receive no status notifications. Manage this subscription after confirming: ${new URL(`/manage/${encodeURIComponent(manage.token)}`,origin).href}\nUnsubscribe: ${new URL(`/unsubscribe/${encodeURIComponent(unsubscribe.token)}`,origin).href}\nReturn to status: ${new URL("/",origin).href}`,
        headers:{"Auto-Submitted":"auto-generated"},idempotencyKey:`subscriber-confirmation/${subscriberId}/${subscriber.createdAt}`,
      });
    } catch(cause) {
      if(isMailPreparationError(cause))await repository.intake.releasePreparationClaim(subscriberId,emailHash,now);
      throw cause;
    }
    return true;
  };
}
