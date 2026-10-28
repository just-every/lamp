import { planSubscriberCapacity } from "./limits";
import { createOpaqueToken, hashOpaqueToken } from "../../platform/security/opaque-tokens";
import { createUlid } from "../../shared/ids";
import { parseSubscriberCsv, subscriberCsvCell } from "./csv";
import { SubscriberIntakeError, type IntakeApply, type IntakeCounts, type IntakePreview, type SubscriberAddInput } from "./intake-schema";
import type { SubscriberRepository } from "./repository";
import type { SubscriberPreferences } from "./preferences";
import type { SubscriberView } from "./service";

export interface SmsIntake {
  validatePhone(phone:string):Promise<void>;
  subscribe(input:{phone:string;componentIds:string[];preferences?:SubscriberPreferences},origin:string,operatorId?:string):Promise<{subscriberId:string;created:boolean;confirmationSent:boolean}>;
  invite(subscriberId:string,origin:string,actor:string|null,ownerOnly:boolean):Promise<boolean>;
}

export function createSubscriberIntakeService(repository:SubscriberRepository,hooks:{
  sms?:SmsIntake;
  checkLimits:()=>Promise<void>;
  view:(id:string)=>Promise<SubscriberView>;
  ensureConfigured:()=>Promise<void>;
  sendConfirmation:(id:string,origin:string,actor:string|null,ownerOnly:boolean)=>Promise<boolean>;
}) {
  async function plan(csv:string) {
    const parsed=parseSubscriberCsv(csv);
    const [destinations,components]=await Promise.all([repository.intake.destinations(),repository.listVisibleComponents()]);
    const visible=new Set(components.map(row=>row.id));
    const accepted=[] as typeof parsed.valid;
    for(const item of parsed.valid) {
      const decision=parsed.decisions.find(row=>row.row===item.row)!;
      if(item.channel==="sms") {
        try {if(!hooks.sms)throw new Error("SMS is not configured.");await hooks.sms.validatePhone(item.destination);}
        catch(cause){decision.outcome="refused";decision.reason=cause instanceof Error?cause.message:"This phone number is not accepted.";continue;}
      }
      if(item.componentIds.some(id=>!visible.has(id))){decision.outcome="refused";decision.reason="A selected component is unknown or internal.";}
      else if(destinations.has(item.destination)){decision.outcome="skipped";decision.reason="This destination already has a subscription.";}
      else accepted.push(item);
    }
    const capacity=planSubscriberCapacity(await repository.limits.counts(),accepted);
    for(const row of capacity.refused){const decision=parsed.decisions.find(item=>item.row===row.row)!;decision.outcome="refused";decision.reason="over the subscriber limit";}
    const counts:IntakeCounts={created:0,skipped:0,refused:0};
    for(const decision of parsed.decisions)counts[decision.outcome]++;
    const fingerprint=await hashOpaqueToken(JSON.stringify({csv,decisions:parsed.decisions,components:[...visible].sort(),limits:capacity.summaries}));
    return {accepted:accepted.filter(row=>!capacity.refused.has(row)),preview:{fingerprint,counts,rows:parsed.decisions,limits:capacity.summaries} satisfies IntakePreview};
  }
  return {
    async batches(operatorId:string) {
      if(!await repository.intake.operatorAllowed(operatorId,true))throw new SubscriberIntakeError("Only the active owner can read import invitation batches.",403);
      return repository.intake.batches();
    },
    async preview(csv:string):Promise<IntakePreview> {return (await plan(csv)).preview;},
    async apply(csv:string,reviewedFingerprint:string,operatorId:string):Promise<IntakeApply> {
      const planned=await plan(csv);
      if(planned.preview.fingerprint!==reviewedFingerprint)throw new SubscriberIntakeError("The subscriber import changed. Run the preview again.",409);
      if(planned.preview.limits.length)throw new SubscriberIntakeError(planned.preview.limits.join("; "),409);
      const batchId=createUlid(),now=new Date().toISOString();
      const rows=await Promise.all(planned.accepted.map(async row=>({...row,id:createUlid(),tokenHash:await hashOpaqueToken(createOpaqueToken())})));
      let subscriberIds:string[];
      try{subscriberIds=await repository.intake.insert(rows,operatorId,"csv",batchId,planned.preview.counts,now);}
      catch(cause){if(cause instanceof Error&&cause.message.includes("over the subscriber limit"))throw new SubscriberIntakeError("The import is over the subscriber limit. Run the preview again.",409);if(cause instanceof Error&&cause.message.includes("malformed JSON"))throw new SubscriberIntakeError("The actor or selected components changed. Preview again.",409);throw cause;}
      await hooks.checkLimits();
      return {batchId,counts:{...planned.preview.counts,created:subscriberIds.length,skipped:planned.preview.counts.skipped+rows.length-subscriberIds.length},subscriberIds};
    },
    async sendInvitations(batchId:string,operatorId:string,origin:string,_actorLabel?:string,selectedSubscriberIds?:readonly string[]):Promise<{sent:number;remaining:number}> {
      if(!await repository.intake.operatorAllowed(operatorId,true))throw new SubscriberIntakeError("Only the active owner can send import invitations.",403);
      if(!await repository.intake.batchExists(batchId))throw new SubscriberIntakeError("This subscriber import does not exist.",409);
      let sent=0;
      const eligible=await repository.intake.pending(batchId);
      const selected=selectedSubscriberIds===undefined?eligible:eligible.filter(id=>selectedSubscriberIds.includes(id));
      for(const id of selected) {
        const row=await repository.findSubscriber(id);
        if(row?.channel==="sms" ? await hooks.sms?.invite(id,origin,operatorId,true) : await hooks.sendConfirmation(id,origin,operatorId,true))sent++;
      }
      return {sent,remaining:await repository.intake.remaining(batchId)};
    },
    async add(input:SubscriberAddInput,operatorId:string,origin:string):Promise<{subscriber:SubscriberView;created:boolean;confirmationSent:boolean}> {
      if(!await repository.intake.operatorAllowed(operatorId))throw new SubscriberIntakeError("The operator no longer has access.",403);
      if(input.channel==="sms") {
        if(!hooks.sms)throw new SubscriberIntakeError("SMS is not configured.",503);
        const result=await hooks.sms.subscribe({phone:input.phone,componentIds:input.componentIds,preferences:input.eventKinds===undefined&&input.minimumImpact===undefined?undefined:{eventKinds:input.eventKinds??["incidents","maintenance"],minimumImpact:input.minimumImpact??null}},origin,operatorId);
        return {...result,subscriber:await hooks.view(result.subscriberId)};
      }
      const destination=input.channel==="email"?input.email:input.destination;
      const visible=new Set((await repository.listVisibleComponents()).map(row=>row.id));
      if(input.componentIds.some(id=>!visible.has(id)))throw new SubscriberIntakeError("A selected component is unknown or internal.");
      await repository.limits.assertAvailable(input.channel);
      const existing=await repository.findSubscriberByDestination(destination);
      if(existing)return {subscriber:await hooks.view(existing.id),created:false,confirmationSent:false};
      await hooks.ensureConfigured();
      const id=createUlid(),now=new Date().toISOString();
      const inserted=await repository.intake.insert([{row:1,id,channel:input.channel,destination,contactEmail:input.channel==="webhook"?input.contactEmail:null,componentIds:input.componentIds,eventKinds:input.eventKinds,minimumImpact:input.minimumImpact,...(input.channel==="webhook"?{webhookFormat:input.webhookFormat}:{}),tokenHash:await hashOpaqueToken(createOpaqueToken())}],operatorId,"operator",null,{created:1,skipped:0,refused:0},now);
      if(!inserted.length){const winner=await repository.findSubscriberByDestination(destination);if(!winner)throw new SubscriberIntakeError("The subscriber changed. Try again.",409);return {subscriber:await hooks.view(winner.id),created:false,confirmationSent:false};}
      await hooks.checkLimits();
      const confirmationSent=await hooks.sendConfirmation(id,origin,operatorId,false);
      return {subscriber:await hooks.view(id),created:true,confirmationSent};
    },
    async exportCsv():Promise<string> {
      const headers=["channel","destination","contact_email","state","components","consent_at"];
      const rows=await repository.intake.exportRows();
      return [headers.map(subscriberCsvCell).join(","),...rows.map(row=>[row.channel,row.destination,row.contactEmail,row.state,row.components,row.consentAt].map(subscriberCsvCell).join(","))].join("\r\n")+"\r\n";
    },
  };
}
