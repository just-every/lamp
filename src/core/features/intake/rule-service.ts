import { nowIso } from "../../shared/ids";
import type { IncidentsService } from "../incidents/service";
import type { IncidentTemplate } from "../incidents/template-repository";
import { templateChannelsSchema, templateResolvedUpdateSchema } from "../incidents/template-schema";
import { assertTemplateWordingLimits } from "../incidents/template-fields";
import type { createAlertRuleRepository } from "./rule-repository";
import type { AlertSourceRow } from "./repository";
import { alertRuleSchema, type AlertRuleInput } from "./rule-schema";
import { ruleEvidence } from "./rule-evidence";
import type { createRuleWorkRepository } from "./rule-work.repository";

function assertAutomationTemplate(template:IncidentTemplate|null):asserts template is IncidentTemplate {
  if(!template)throw new Error('The saved template no longer exists.');
  assertTemplateWordingLimits(template);
  if(!template.components.length || template.components.some(component=>!component.componentId))throw new Error('A saved template component no longer exists.');
  if(!template.affectedAudience.trim() || !template.customerImpact.trim())throw new Error('The template needs who is affected and customer impact.');
  if(template.lifecycle==='Resolved' || !template.nextUpdateOffsetMinutes || !Number.isInteger(template.nextUpdateOffsetMinutes) || template.nextUpdateOffsetMinutes<1 || template.nextUpdateOffsetMinutes>10_080)throw new Error('The template needs an active lifecycle and a next-update offset.');
  templateChannelsSchema.parse(template.channels);
  if(!templateResolvedUpdateSchema.safeParse(template.resolvedUpdate).success)throw new Error('The template needs a saved Resolved update.');
}

export function createAlertRuleService(repository:ReturnType<typeof createAlertRuleRepository>,incidents:IncidentsService,onPublicDataChanged:()=>Promise<void>, work: { repository: ReturnType<typeof createRuleWorkRepository>; findSource:(sourceId:string)=>Promise<AlertSourceRow|null> }) {
  async function apply(source:AlertSourceRow,receiptId:string,sourceIncidentId:string|null,payload:unknown,receivedAt:string) {
      const rules=(await repository.list()).filter(rule=>rule.sourceId===source.id && rule.mode!=='draft');
      for(const rule of rules) {
        const members=ruleEvidence(source,rule.componentId,payload);if(!members.length)continue;
        // A concurrent recovery can close the private intake draft before a
        // later firing is processed. Its next recovery still releases the
        // matching active rule execution, even without an open intake draft.
        const episodeIncidentId=sourceIncidentId ?? await repository.findActiveEvidenceIncident(rule.id,members.map(member=>member.fingerprint));
        if(!episodeIncidentId)continue;
        await repository.recordEvidence(rule,episodeIncidentId,receiptId,receivedAt,members);
        const evidence=await repository.active(rule.id,episodeIncidentId);
        let run=await repository.findRun(rule.id,episodeIncidentId);
        if(!evidence.active && !run)continue;
        if (run?.releasedAt) {
          // A ruled component may fire again while another component keeps its
          // intake group open. A later receipt starts a new episode; redelivery
          // of an earlier receipt never reopens a released claim or publication.
          if (!evidence.active || receivedAt <= run.releasedAt) continue;
          run = null;
        }
        if (rule.degradationReason) {
          if (run && !evidence.active && await repository.claim(rule,run,receiptId,nowIso(),true,source.updatedAt)) await onPublicDataChanged();
          continue;
        }
        let template:IncidentTemplate|null=null;
        if(rule.mode==='claim-and-publish') {
          template=rule.templateId?(await incidents.listTemplates()).find(row=>row.id===rule.templateId) ?? null:null;
          try {assertAutomationTemplate(template);} catch(cause) {await repository.degrade(rule,`${cause instanceof Error?cause.message:'The template is invalid.'} Review the template and save this rule again to resume.`,receiptId,nowIso());if(run && !evidence.active){if(await repository.claim(rule,run,receiptId,nowIso(),true,source.updatedAt))await onPublicDataChanged();}continue;}
        }
        run ??= await repository.ensureRun(rule,episodeIncidentId,receiptId,nowIso(),template?.title.trim() || template?.name || rule.name);
        if(run.releasedAt)continue;
        if(rule.mode==='claim') {
          if(await repository.claim(rule,run,receiptId,nowIso(),!evidence.active,source.updatedAt))await onPublicDataChanged();
          continue;
        }
        if(!template)throw new Error('Automation template was not loaded.');
        const phase=evidence.active?'firing':'recovery';
        const publishedId=phase==='firing'?run.firingUpdateId:run.recoveryUpdateId;
        if(publishedId) {
          const committed=(await incidents.get(run.incidentId))?.updates.find(update=>update.id===publishedId);
          if(committed)await incidents.finishPublication(committed);
          continue;
        }
        // Recovery is permitted only after this run's first update committed.
        if(phase==='recovery' && !run.firingUpdateId) {
          if(await repository.claim(rule,run,receiptId,nowIso(),true,source.updatedAt))await onPublicDataChanged();
          continue;
        }
        const incident=await incidents.get(run.incidentId);if(!incident)throw new Error('The rule incident no longer exists.');
        const wording=phase==='recovery'?template.resolvedUpdate!:template;
        const draft=await incidents.saveDraft(run.incidentId,{
          lifecycle:phase==='recovery'?'Resolved':template.lifecycle,
          affectedAudience:wording.affectedAudience,customerImpact:wording.customerImpact,whatStillWorks:wording.whatStillWorks,details:wording.details,
          nextUpdateAt:phase==='recovery'?null:new Date(Date.now()+template.nextUpdateOffsetMinutes!*60_000).toISOString(),
        },rule.approvedByOperatorId,`${incident.draft?.id ?? '-'}:${incident.updates.length}`);
        if(!draft)throw new Error('The rule draft could not be saved.');
        const update=await incidents.publish(run.incidentId,rule.approvedByOperatorId,{
          channels:template.channels,expectedVersion:`${draft.id}:${incident.updates.length}`,
          automation:{sourceId:source.id,sourceVersion:source.updatedAt,runId:run.id,ruleId:rule.id,phase,receiptId,ruleVersion:rule.updatedAt,templateId:template.id,templateVersion:template.updatedAt,attribution:`rule ${rule.name}, approved by ${rule.approvedByName}`},
        });
        if(!update)throw new Error('The rule update could not be published.');
        await incidents.finishPublication(update);
      }
  }
  async function accept(source:AlertSourceRow,receiptId:string,sourceIncidentId:string|null,payload:unknown,receivedAt:string) {
    const item=await work.repository.get(receiptId);
    if(!item || item.completedAt)return;
    if(item.sourceVersion!==source.updatedAt) {
      await work.repository.complete(receiptId,nowIso(),'Automatic rule action held as a private draft: this alert source changed after acceptance. Review the source and rule.');
      return;
    }
    try {
      await apply(source,receiptId,sourceIncidentId,payload,receivedAt);
      await work.repository.complete(receiptId,nowIso());
    } catch(cause) {
      await work.repository.failed(receiptId,Date.now());
      throw cause;
    }
  }
  return {
    list:repository.list,runs:repository.runs,
    async requiresOperatorReview(incidentId:string) {
      const context=await repository.intakeContext(incidentId);
      if(!context || context.error)return true;
      const rules=(await repository.list()).filter(rule=>rule.sourceId===context.sourceId);
      const selected=context.componentIds.length ? context.componentIds.map(id=>rules.find(rule=>rule.componentId===id)) : rules;
      if(!selected.length || selected.some(rule=>!rule || rule.mode==='draft' || rule.degradationReason))return true;
      for(const rule of selected)if(rule?.mode==='claim-and-publish') {
        const template=(await incidents.listTemplates()).find(row=>row.id===rule.templateId) ?? null;
        try {assertAutomationTemplate(template);} catch {return true;}
      }
      return false;
    },
    async save(sourceId:string,componentId:string,input:AlertRuleInput,actor:string) {
      const parsed=alertRuleSchema.parse(input);
      let version:string|null=null;
      if(parsed.mode==='claim-and-publish') {
        const template=parsed.templateId?(await incidents.listTemplates()).find(row=>row.id===parsed.templateId) ?? null:null;
        assertAutomationTemplate(template);version=template.updatedAt;
      }
      const previous=(await repository.list()).find(rule=>rule.sourceId===sourceId && rule.componentId===componentId);
      const at=new Date(Math.max(Date.now(),previous ? Date.parse(previous.updatedAt)+1:0)).toISOString();
      const saved=await repository.save(sourceId,componentId,parsed,actor,at,version);
      if (saved.publicChanged) await onPublicDataChanged();
      return saved.rule;
    },
    async remove(sourceId:string,componentId:string,actor:string) {
      const result=await repository.remove(sourceId,componentId,actor,nowIso());
      if(result.deleted && result.publicChanged)await onPublicDataChanged();
      return result.deleted;
    },
    accept,
    async processPending(now=Date.now()) {
      const failures: Error[]=[];
      for(const item of await work.repository.pending(now)) {
        const source=await work.findSource(item.sourceId);
        if(!source)continue;
        try {await accept(source,item.receiptId,item.incidentId,JSON.parse(item.payloadJson) as unknown,item.receivedAt);}
        catch {failures.push(new Error(`Automatic rule work for receipt ${item.receiptId} remains pending; see its receipt error.`));}
      }
      if(failures.length)throw new AggregateError(failures,'Automatic rule work needs retry.');
    },
  };
}
export type AlertRuleService=ReturnType<typeof createAlertRuleService>;
