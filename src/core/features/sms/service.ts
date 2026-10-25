import { createUlid,nowIso } from "../../shared/ids";
import { hashOpaqueToken } from "../../platform/security/opaque-tokens";
import { createSubscriberRepository } from "../subscribers/repository";
import { SubscriberTokenCodec } from "../subscribers/tokens";
import { defaultPreferences,type SubscriberPreferences } from "../subscribers/preferences";
import { createSmsRepository } from "./repository";
import { validateSmsPhone } from "./phone";
import { renderSmsMessage } from "./message";
import { sendTwilio,twilioConfigured,type TwilioConfig } from "./twilio";

export function createSmsService(db:D1Database,options:TwilioConfig & {tokenSecret?:string;effectsPaused?:boolean;unavailable?:string|null;pageName:()=>Promise<string>;supportContact:()=>Promise<string|undefined>;publicOrigin:()=>Promise<string>}) {
  const repository=createSmsRepository(db),subscribers=createSubscriberRepository(db);
  const tokens=options.tokenSecret?new SubscriberTokenCodec(options.tokenSecret):null;
  const configured=()=>twilioConfigured(options)&&Boolean(tokens)&&!options.effectsPaused&&!options.unavailable;
  function ensureConfigured() { if(!configured())throw new Error("SMS sending is not configured. Ask the owner to configure Twilio."); }
  async function settings() {
    const value=await repository.settings();
    return {...value,supportContact:value.supportContact || await options.supportContact() || "Contact the status page operator."};
  }
  async function validatePhone(phone:string) { validateSmsPhone(phone,(await settings()).countries); }
  async function send(to:string,body:string,statusCallback?:string) {
    ensureConfigured();
    return sendTwilio(options,{to,body,statusCallback});
  }
  async function manageToken(id:string) {
    if(!tokens)throw new Error("SMS management tokens are not configured.");
    const tokenId=createUlid(),candidate=await tokens.encode({id:tokenId,scope:'manage'});
    const stored=await subscribers.ensureToken(id,'manage',{id:tokenId,tokenHash:await tokens.hash(candidate),expiresAt:null},nowIso());
    return stored===tokenId?candidate:tokens.encode({id:stored,scope:'manage'});
  }
  async function invite(id:string,_origin:string,actor?:string|null,ownerOnly=false) {
    ensureConfigured();
    if(actor&&!await repository.operatorAllowed(actor,ownerOnly))throw new Error("Only the owner or an admin can invite SMS subscribers.");
    const pending=await repository.pending(id);
    if(!pending || Date.now()-Date.parse(pending.createdAt)>72*60*60*1000)return false;
    const pageName=await options.pageName();
    const wording=`${pageName}: Status updates vary with incidents and maintenance. Msg & data rates may apply. Reply YES to subscribe. HELP for help; STOP to cancel.`;
    const now=nowIso();
    const allowance=await hashOpaqueToken(`sms-confirmation:${pending.destination}`);
    const allowed=await subscribers.intake.has(id)
      ? await subscribers.intake.claimInvitation(id,allowance,now,actor??null,ownerOnly)
      : await subscribers.recordConfirmationSendIfAllowed(allowance,new Date(Date.now()-24*60*60*1000).toISOString(),now);
    if(!allowed)return false;
    // Keep the exact wording before submitting it to the provider. An uncertain
    // provider result must not reopen the per-number anti-bomb allowance.
    await repository.rememberOptIn(id,pageName,wording,now);
    await send(pending.destination,wording);
    return true;
  }
  return {
    configured,settings,validatePhone,invite,operatorAllowed:repository.operatorAllowed,
    updateSettings:repository.updateSettings,
    publicationStatements:repository.publicationStatements,
    deliveries:repository.deliveries,
    async subscribe(input:{phone:string;componentIds:string[];preferences?:SubscriberPreferences},origin:string,operatorId?:string) {
      await validatePhone(input.phone);ensureConfigured();
      if(operatorId&&!await repository.operatorAllowed(operatorId))throw new Error("Only the owner or an admin can add SMS subscribers.");
      await subscribers.limits.assertAvailable('sms');
      const existing=await subscribers.findSubscriberByDestination(input.phone);
      if(existing?.channel!=='sms'&&existing)throw new Error("This destination already has another subscription.");
      if(existing?.state==='active')return {subscriberId:existing.id,created:false,confirmationSent:false};
      const valid=new Set((await subscribers.listVisibleComponents()).map(component=>component.id));
      if(input.componentIds.some(id=>!valid.has(id)))throw new Error("A selected component is unknown or internal.");
      const id=existing?.id??createUlid();
      await repository.subscribe({id,phone:input.phone,componentIds:[...new Set(input.componentIds)],preferences:input.preferences??defaultPreferences('sms'),now:nowIso(),operatorId});
      const confirmationSent=await invite(id,origin,operatorId);
      return {subscriberId:id,created:!existing,confirmationSent};
    },
    async inbound(params:URLSearchParams,origin:string) {
      const number=params.get('From')??'',sid=params.get('MessageSid')??'',body=(params.get('Body')??'').trim().toUpperCase();
      if(!sid || !number)return;
      const id=await repository.inbound(sid,number,nowIso());
      if(!id)return;
      const name=await options.pageName();
      if(['STOP','UNSUBSCRIBE','CANCEL','END','QUIT'].includes(body)) {
        if(await repository.stop(id,nowIso()))await send(number,`${name}: You are unsubscribed. No more status messages will be sent. Reply YES only after subscribing again on the status page.`);
      } else if(body==='YES') {
        if(await repository.activate(id,nowIso())) {
          const token=await manageToken(id);
          await send(number,renderSmsMessage(`${name}: You are subscribed. Reply STOP to cancel or HELP for help. Manage preferences:`,new URL(`/manage/${encodeURIComponent(token)}`,origin).href));
        }
      } else if(body==='HELP') {
        await send(number,`${name}: Status updates vary with incidents and maintenance. Support: ${(await settings()).supportContact}. Reply STOP to cancel.`);
      }
    },
    async dispatchPending() {
      if(!configured())return;
      const pending=await repository.deliveries(undefined,100,true);
      if(!pending.length)return;
      const origin=await options.publicOrigin(),pageName=await options.pageName();
      for(const delivery of pending) {
        if(!await repository.claim(delivery.id,nowIso())||delivery.subscriberState!=='active')continue;
        const link=new URL(delivery.kind==='maintenance-notice'?`/maintenance/${delivery.maintenanceReference}`:`/incidents/${delivery.reference}`,origin).href;
        const text=delivery.kind==='maintenance-notice'?`${pageName}: ${delivery.body??''}`:delivery.kind==='incident-report'?`${pageName}: ${delivery.title??''}. ${delivery.reportSummary??''} ${delivery.reportTimeline??''} ${delivery.reportCause??''} ${delivery.reportRemediation??''}`:`${pageName}: ${delivery.title??''}. ${delivery.wording??''}`;
        try {
          const sid=await send(delivery.destination,renderSmsMessage(text,link),new URL('/api/public/sms/status',origin).href);
          await repository.accepted(delivery.id,sid,nowIso());
        } catch(cause) { await repository.failed(delivery.id,nowIso()); throw cause; }
      }
    },
    async status(params:URLSearchParams) {
      const sid=params.get('MessageSid'),status=params.get('MessageStatus');
      if(sid&&status&&['delivered','undelivered','failed'].includes(status))await repository.status(sid,status,nowIso());
    },
  };
}
export type SmsService=ReturnType<typeof createSmsService>;
