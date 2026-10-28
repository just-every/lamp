import type { SubscriberWriteAuthority } from "./incident-authority";
import { createOpaqueToken, hashOpaqueToken } from "../../platform/security/opaque-tokens";
import { createUlid, nowIso } from "../../shared/ids";
import type { MailSender, MailMessage } from "../../platform/mail";
import type { SubscriberRepository } from "./repository";
import type { SubscriberConfirmationPolicy } from "./policies";
import type { SubscriberTokenScope } from "./tokens";
import { hasSafeWebhookDestination, normalizeEmail } from "./destination";
import { IncidentSubscriptionUnavailableError } from "./incident.repository";

export type IncidentFollowInput = {includeReport?:boolean} & (
  | {incidentId:string;channel:"email";email:string}
  | {incidentId:string;channel:"webhook";destination:string;contactEmail:string}
  | {incidentId:string;channel:"sms";phone:string});

/** The same address allowance and tokens as page subscriptions; only the
 * recipient scope and lifetime differ. No incident publication is replayed. */
export function createIncidentSubscriptionService(repository:SubscriberRepository, options:{
  policy:SubscriberConfirmationPolicy;
  mail:()=>MailSender;
  from:()=>Promise<string>;
  pageName:()=>Promise<string>;
  issue:(id:string,scope:SubscriberTokenScope,expiresAt:string|null)=>Promise<{token:string}>;
  send:(mail:MailSender,id:string,kind:"confirmation"|"already-subscribed"|"subscribed",message:MailMessage)=>Promise<void>;
  sms?:{subscribeIncident:(input:{incidentId:string;phone:string;includeReport?:boolean},origin:string,authority?:SubscriberWriteAuthority,operatorId?:string)=>Promise<{subscriberId:string;created:boolean}>};
  checkLimits:()=>Promise<void>;
}) {
  return {
    async request(input:IncidentFollowInput, origin:string, authority?:SubscriberWriteAuthority,operatorId?:string) {
      if(authority&&!await repository.incidents.assertAuthority(authority))throw new Error("Incident subscription authority changed.");
      const incident=await repository.incidents.available(input.incidentId);
      if(!incident)throw new IncidentSubscriptionUnavailableError();
      if(input.channel==="sms") {
        if(!options.sms)throw new Error("SMS sending is not configured.");
        const result=await options.sms.subscribeIncident(input,origin,authority,operatorId);
        return {...incident,...result};
      }
      if(input.channel==="webhook"&&!hasSafeWebhookDestination(input.destination))throw new Error("Webhook destinations must be public HTTPS URLs without credentials or a port.");
      await repository.limits.assertAvailable(input.channel);
      const mail=options.mail(),from=await options.from(),name=await options.pageName();
      const destination=input.channel==="email"?normalizeEmail(input.email):input.destination;
      const requestedRecipient=input.channel==="email"?destination:normalizeEmail(input.contactEmail);
      await repository.deleteExpiredPending(new Date(Date.now()-72*60*60*1000).toISOString(),0);
      let row=await repository.incidents.find(input.incidentId,input.channel,destination);
      const wasActive=row?.state==="active";
      const created=!row;
      if(!row || row.state==="deactivated") {
        row=await repository.incidents.create({id:row?.id??createUlid(),incidentId:input.incidentId,
          destination,channel:input.channel,contactEmail:input.channel==="webhook"?requestedRecipient:null,
          includeReport:input.includeReport,operatorId,requiresConfirmation:options.policy.requiresConfirmation(),tokenHash:await hashOpaqueToken(createOpaqueToken()),now:nowIso()},authority);
      }
      const followed={...incident,subscriberId:row.id,created};
      await options.checkLimits();
      const subscriber=await repository.findSubscriber(row.id);
      if(!subscriber)throw new Error("Incident subscriber was not stored.");
      const recipient=subscriber.channel==="email"?subscriber.destination:subscriber.contactEmail;
      if(!recipient)throw new Error("Incident subscriber contact is unavailable.");
      // Imported pending recipients can be invited only by the owner's explicit
      // import action, just like the native shared intake.
      if(subscriber.state==="pending" && (await repository.intake.has(subscriber.id) || await repository.incidents.awaitsImportInvitation(subscriber.id)))return followed;
      const now=nowIso();
      const key=wasActive
        ? `management-subscription:${subscriber.id}:${subscriber.createdAt}`
        : `confirmation-address:${recipient}`;
      if(!await repository.recordConfirmationSendIfAllowed(await hashOpaqueToken(key),new Date(Date.now()-24*60*60*1000).toISOString(),now))return followed;
      const manage=await options.issue(row.id,"manage",null);
      const unsubscribe=await options.issue(row.id,"unsubscribe",null);
      const manageUrl=new URL(`/manage/${encodeURIComponent(manage.token)}`,origin).href;
      const unsubscribeUrl=new URL(`/unsubscribe/${encodeURIComponent(unsubscribe.token)}`,origin).href;
      if(subscriber.state==="active") {
        await options.send(mail,row.id,wasActive?"already-subscribed":"subscribed",{
          from,to:recipient,subject:wasActive?`You are already subscribed to ${name}`:`${name}: Following ${incident.reference}`,
          text:wasActive?`You are already subscribed to ${name}. Manage this subscription: ${manageUrl}`:`Following ${incident.reference} only. Manage this subscription: ${manageUrl}\nUnsubscribe: ${unsubscribeUrl}`,
          headers:{"Auto-Submitted":"auto-generated"},idempotencyKey:`incident-subscribed/${row.id}/${now}`,
        });
        return followed;
      }
      const confirm=await options.issue(row.id,"confirm",new Date(Date.parse(subscriber.createdAt)+72*60*60*1000).toISOString());
      await options.send(mail,row.id,"confirmation",{
        from,to:recipient,subject:`Confirm your ${name} subscription to ${incident.reference}`,
        text:`${name}\n\nConfirm this subscription to ${incident.reference}: ${new URL(`/confirm-subscription/${encodeURIComponent(confirm.token)}`,origin).href}\n\nIf this was not you, ignore this email. Manage this subscription after confirming: ${manageUrl}\nUnsubscribe: ${unsubscribeUrl}\nReturn to status: ${new URL(`/incidents/${incident.reference}`,origin).href}`,
        headers:{"Auto-Submitted":"auto-generated"},idempotencyKey:`subscriber-confirmation/${row.id}/${subscriber.createdAt}`,
      });
      return followed;
    },
  };
}
