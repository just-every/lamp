import { createUlid } from "../../shared/ids";
import { allocateReference } from "../../shared/references/repository";
import { currentStateHistoryStatement } from "../components/state-history-repository";
import type { RuleView, RuleRun, AlertRuleInput, RuleAutomationPublication } from "./rule-schema";

const fields = `r.id,r.source_id AS sourceId,r.component_id AS componentId,r.name,r.mode,r.state,r.template_id AS templateId,r.approved_by_operator_id AS approvedByOperatorId,
  COALESCE((SELECT display_name FROM oa_operators WHERE id=r.approved_by_operator_id),'Erased operator') AS approvedByName,r.degradation_reason AS degradationReason,r.created_at AS createdAt,r.updated_at AS updatedAt`;
const runFields = `id,rule_id AS ruleId,source_incident_id AS sourceIncidentId,incident_id AS incidentId,mode,firing_update_id AS firingUpdateId,recovery_update_id AS recoveryUpdateId,released_at AS releasedAt,created_at AS createdAt,updated_at AS updatedAt`;
export function createAlertRuleRepository(db: D1Database) {
  const findRun = (ruleId: string, sourceIncidentId: string) => db.prepare(`SELECT ${runFields} FROM alert_rule_runs WHERE rule_id=? AND source_incident_id=? ORDER BY created_at DESC,id DESC LIMIT 1`).bind(ruleId,sourceIncidentId).first<RuleRun>();
  return {
    list: async () => (await db.prepare(`SELECT ${fields} FROM alert_rules r ORDER BY r.name,r.id`).all<RuleView>()).results,
    runs: async () => (await db.prepare(`SELECT ${runFields} FROM alert_rule_runs ORDER BY created_at,id`).all<RuleRun>()).results,
    findRun,
    async save(sourceId: string, componentId: string, input: AlertRuleInput, actor: string, at: string, templateVersion: string | null) {
      const existing = await db.prepare(`SELECT ${fields} FROM alert_rules r WHERE source_id=? AND component_id=?`).bind(sourceId,componentId).first<RuleView>();
      const id=existing?.id ?? createUlid();
      // A changed approval ends the previous rule's standing actions. It cannot
      // grant a newly selected rule authority over an already running alert.
      const previousRuns=existing ? (await db.prepare(`SELECT ${runFields} FROM alert_rule_runs WHERE rule_id=? AND released_at IS NULL`).bind(existing.id).all<RuleRun>()).results : [];
      await db.batch([
        ...previousRuns.flatMap(run=>[
          db.prepare(`UPDATE incident_components SET state='Operational',updated_at=? WHERE incident_id=?`).bind(at,run.incidentId),
          db.prepare(`UPDATE incidents SET lifecycle=CASE WHEN EXISTS(SELECT 1 FROM incident_updates WHERE incident_id=incidents.id) THEN lifecycle ELSE 'Resolved' END,updated_at=? WHERE id=?`).bind(at,run.incidentId),
          db.prepare(`UPDATE alert_rule_runs SET released_at=?,updated_at=? WHERE id=?`).bind(at,at,run.id),
          db.prepare(`INSERT INTO component_claim_events(id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at) VALUES(?,?,'incident',?,NULL,?,?,?)`).bind(createUlid(),componentId,run.incidentId,at,at,at),
          currentStateHistoryStatement(db,{id:createUlid(),componentId,cause:{type:'incident',id:run.incidentId,operatorId:actor},changedAt:at,createdAt:at,updatedAt:at}),
        ]),
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM alert_sources WHERE id=?) AND EXISTS(SELECT 1 FROM components WHERE id=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM incident_templates WHERE id=? AND updated_at=?)) THEN 1 ELSE json('Rule inputs changed') END`).bind(sourceId,componentId,templateVersion,input.templateId ?? null,templateVersion),
        db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES(?,'alert-rule',?,?,?,?,?,?)`).bind(createUlid(),id,existing ? 'updated':'created',actor,JSON.stringify({sourceId,componentId,name:input.name,mode:input.mode,state:input.state,templateId:input.templateId ?? null}),at,at),
        db.prepare(`INSERT INTO alert_rules(id,source_id,component_id,name,mode,state,template_id,approved_by_operator_id,degradation_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,NULL,?,?) ON CONFLICT(source_id,component_id) DO UPDATE SET name=excluded.name,mode=excluded.mode,state=excluded.state,template_id=excluded.template_id,approved_by_operator_id=excluded.approved_by_operator_id,degradation_reason=NULL,updated_at=excluded.updated_at`).bind(id,sourceId,componentId,input.name,input.mode,input.state,input.templateId ?? null,actor,at,at),
      ]);
      return (await db.prepare(`SELECT ${fields} FROM alert_rules r WHERE source_id=? AND component_id=?`).bind(sourceId,componentId).first<RuleView>())!;
    },
    async remove(sourceId:string,componentId:string,actor:string,at:string) {
      const rule=await db.prepare(`SELECT ${fields} FROM alert_rules r WHERE source_id=? AND component_id=?`).bind(sourceId,componentId).first<RuleView>();
      if(!rule)return false;
      const runs=(await db.prepare(`SELECT ${runFields} FROM alert_rule_runs WHERE rule_id=? AND released_at IS NULL`).bind(rule.id).all<RuleRun>()).results;
      await db.batch([
        // The trigger records cascaded deletions too. This explicit entry carries the deleting actor.
        db.prepare(`UPDATE alert_rules SET approved_by_operator_id=? WHERE id=?`).bind(actor,rule.id),
        db.prepare(`DELETE FROM alert_rules WHERE id=?`).bind(rule.id),
        ...runs.map(run=>currentStateHistoryStatement(db,{id:createUlid(),componentId:rule.componentId,cause:{type:'incident',id:run.incidentId,operatorId:actor},changedAt:at,createdAt:at,updatedAt:at})),
      ]);
      return true;
    },
    async degrade(rule:RuleView,reason:string,receiptId:string,_at:string) {
      await db.batch([
        db.prepare(`UPDATE alert_rules SET degradation_reason=? WHERE id=? AND updated_at=?`).bind(reason,rule.id,rule.updatedAt),
        db.prepare(`UPDATE alert_receipts SET error=? WHERE id=?`).bind(`Rule ${rule.name}: ${reason} Draft only; nothing was published.`,receiptId),
      ]);
    },
    async recordEvidence(rule:RuleView,sourceIncidentId:string,receiptId:string,at:string,members:Array<{fingerprint:string;firing:boolean}>) {
      await db.batch(members.map(member=>db.prepare(`INSERT INTO alert_rule_evidence(rule_id,source_incident_id,fingerprint,firing,receipt_id,received_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM alert_rules WHERE id=? AND updated_at=?)
        ON CONFLICT(rule_id,source_incident_id,fingerprint) DO UPDATE SET firing=excluded.firing,receipt_id=excluded.receipt_id,received_at=excluded.received_at
        WHERE (SELECT rowid FROM alert_receipts WHERE id=excluded.receipt_id)>=(SELECT rowid FROM alert_receipts WHERE id=alert_rule_evidence.receipt_id)`)
        .bind(rule.id,sourceIncidentId,member.fingerprint,member.firing?1:0,receiptId,at,rule.id,rule.updatedAt)));
    },
    async active(ruleId:string,sourceIncidentId:string) {
      const row=await db.prepare(`SELECT count(*) AS total,COALESCE(sum(firing),0) AS active FROM alert_rule_evidence WHERE rule_id=? AND source_incident_id=?`).bind(ruleId,sourceIncidentId).first<{total:number;active:number}>();
      return {total:row?.total ?? 0,active:row?.active ?? 0};
    },
    async ensureRun(rule:RuleView,sourceIncidentId:string,receiptId:string,at:string,title:string):Promise<RuleRun> {
      const current=await findRun(rule.id,sourceIncidentId);if(current && !current.releasedAt)return current;
      const id=createUlid(),incidentId=createUlid(),reference=await allocateReference(db,'INC');
      try { await db.batch([
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM alert_rules WHERE id=? AND updated_at=?) THEN 1 ELSE json('Rule changed') END`).bind(rule.id,rule.updatedAt),
        db.prepare(`INSERT INTO incidents(id,reference,title,lifecycle,opened_at,created_by_operator_id,created_at,updated_at) VALUES(?,?,?,'Investigating',?,?,?,?)`).bind(incidentId,reference,title,at,rule.approvedByOperatorId,at,at),
        db.prepare(`INSERT INTO alert_rule_runs(id,rule_id,source_incident_id,incident_id,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(id,rule.id,sourceIncidentId,incidentId,rule.mode,at,at),
        db.prepare(`INSERT INTO incident_components(id,incident_id,component_id,component_name,state,relationship,created_at,updated_at) SELECT ?,?,id,name,?,'Primary',?,? FROM components WHERE id=?`).bind(createUlid(),incidentId,rule.state,at,at,rule.componentId),
        db.prepare(`INSERT INTO incident_drafts(id,incident_id,lifecycle,author_operator_id,created_at,updated_at) VALUES(?,?,'Investigating',?,?,?)`).bind(createUlid(),incidentId,rule.approvedByOperatorId,at,at),
        db.prepare(`INSERT INTO incident_internal_notes(id,incident_id,body,author_operator_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`).bind(createUlid(),sourceIncidentId,`Rule ${rule.name} opened automation incident ${reference} (${incidentId}) from alert ${receiptId}.`,rule.approvedByOperatorId,at,at),
        db.prepare(`INSERT INTO incident_internal_notes(id,incident_id,body,author_operator_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`).bind(createUlid(),incidentId,`rule ${rule.name}, approved by ${rule.approvedByName}; caused by alert ${receiptId} on source incident ${sourceIncidentId}.`,rule.approvedByOperatorId,at,at),
      ]); } catch(cause) {const raced=await findRun(rule.id,sourceIncidentId);if(raced && !raced.releasedAt)return raced;throw cause;}
      return (await findRun(rule.id,sourceIncidentId))!;
    },
    async claim(rule:RuleView,run:RuleRun,receiptId:string,at:string,release:boolean) {
      const active=await db.prepare(`SELECT published_at AS publishedAt FROM incident_components WHERE incident_id=? AND component_id=?`).bind(run.incidentId,rule.componentId).first<{publishedAt:string|null}>();
      if(release ? Boolean(run.releasedAt) : Boolean(active?.publishedAt))return;
      await db.batch([
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM alert_rules WHERE id=? AND updated_at=? AND (?=1 OR mode='claim')) THEN 1 ELSE json('Rule changed') END`).bind(rule.id,rule.updatedAt,release?1:0),
        db.prepare(`UPDATE incident_components SET published_at=COALESCE(published_at,?),state=?,updated_at=? WHERE incident_id=?`).bind(at,release?"Operational":rule.state,at,run.incidentId),
        db.prepare(`UPDATE incidents SET lifecycle=CASE WHEN ?=1 AND EXISTS(SELECT 1 FROM incident_updates WHERE incident_id=incidents.id) THEN lifecycle ELSE ? END,resolved_at=CASE WHEN ?=1 AND EXISTS(SELECT 1 FROM incident_updates WHERE incident_id=incidents.id) THEN resolved_at ELSE ? END,updated_at=? WHERE id=?`).bind(release?1:0,release?"Resolved":"Investigating",release?1:0,release?at:null,at,run.incidentId),
        db.prepare(`UPDATE alert_rule_runs SET released_at=?,updated_at=? WHERE id=?`).bind(release?at:null,at,run.id),
        db.prepare(`INSERT INTO component_claim_events(id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at) VALUES(?,?,'incident',?,?,?,?,?)`).bind(createUlid(),rule.componentId,run.incidentId,release?null:rule.state,at,at,at),
        currentStateHistoryStatement(db,{id:createUlid(),componentId:rule.componentId,cause:{type:'incident',id:run.incidentId,operatorId:rule.approvedByOperatorId},changedAt:at,createdAt:at,updatedAt:at}),
        db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES(?,'alert-rule',?,'acted',?,?,?,?)`).bind(createUlid(),rule.id,rule.approvedByOperatorId,JSON.stringify({receiptId,incidentId:run.incidentId,action:release?'released':'claimed'}),at,at),
      ]);
    },
  };
}

/** These fences and markers share UPDATE-008's transaction with update and recipient writes. */
export function automationPublicationStatements(db:D1Database,input:RuleAutomationPublication,updateId:string,at:string):{before:D1PreparedStatement[];after:D1PreparedStatement[]} {
  const column=input.phase==='firing'?'firing_update_id':'recovery_update_id';
  const condition=input.phase==='firing'?`EXISTS(SELECT 1 FROM alert_rule_evidence WHERE rule_id=? AND source_incident_id=run.source_incident_id AND firing=1)`:`NOT EXISTS(SELECT 1 FROM alert_rule_evidence WHERE rule_id=? AND source_incident_id=run.source_incident_id AND firing=1)`;
  return {
    before:[db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM alert_rule_runs run JOIN alert_rules rule ON rule.id=run.rule_id JOIN incident_templates template ON template.id=rule.template_id WHERE run.id=? AND run.${column} IS NULL AND run.released_at IS NULL AND rule.id=? AND rule.updated_at=? AND rule.mode='claim-and-publish' AND template.id=? AND template.updated_at=? AND ? = 'rule ' || rule.name || ', approved by ' || COALESCE((SELECT display_name FROM oa_operators WHERE id=rule.approved_by_operator_id),'Erased operator') AND ${condition}) THEN 1 ELSE json('Automation inputs changed') END`).bind(input.runId,input.ruleId,input.ruleVersion,input.templateId,input.templateVersion,input.attribution,input.ruleId)],
    after:[
      db.prepare(`UPDATE alert_rule_runs SET ${column}=?,released_at=?,updated_at=? WHERE id=?`).bind(updateId,input.phase==='recovery'?at:null,at,input.runId),
      db.prepare(`INSERT INTO incident_internal_notes(id,incident_id,body,author_operator_id,created_at,updated_at) SELECT ?,run.incident_id,?,rule.approved_by_operator_id,?,? FROM alert_rule_runs run JOIN alert_rules rule ON rule.id=run.rule_id WHERE run.id=?`).bind(createUlid(),`${input.attribution}; ${input.phase} publication caused by alert ${input.receiptId}.`,at,at,input.runId),
    ],
  };
}
