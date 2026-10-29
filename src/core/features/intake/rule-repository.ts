import { createUlid } from "../../shared/ids";
import { allocateReference } from "../../shared/references/repository";
import { currentStateHistoryStatement } from "../components/state-history-repository";
import { alertRuleSchema, type RuleView, type RuleRun, type AlertRuleInput, type RuleAutomationPublication } from "./rule-schema";

const fields = `r.id,r.source_id AS sourceId,r.component_id AS componentId,r.name,r.mode,r.state,r.template_id AS templateId,r.approved_by_operator_id AS approvedByOperatorId,
  COALESCE((SELECT display_name FROM oa_operators WHERE id=r.approved_by_operator_id),'Erased operator') AS approvedByName,r.degradation_reason AS degradationReason,r.firing_delay_seconds AS firingDelaySeconds,r.recovery_hold_seconds AS recoveryHoldSeconds,r.created_at AS createdAt,r.updated_at AS updatedAt`;
const runFields = `id,rule_id AS ruleId,source_incident_id AS sourceIncidentId,incident_id AS incidentId,mode,firing_update_id AS firingUpdateId,recovery_update_id AS recoveryUpdateId,released_at AS releasedAt,undone_at AS undoneAt,undone_by_operator_id AS undoneByOperatorId,created_at AS createdAt,updated_at AS updatedAt`;
export function createAlertRuleRepository(db: D1Database) {
  const findRun = (ruleId: string, sourceIncidentId: string) => db.prepare(`SELECT ${runFields} FROM alert_rule_runs WHERE rule_id=? AND source_incident_id=? ORDER BY created_at DESC,id DESC LIMIT 1`).bind(ruleId,sourceIncidentId).first<RuleRun>();
  return {
    list: async () => (await db.prepare(`SELECT ${fields} FROM alert_rules r ORDER BY r.name,r.id`).all<RuleView>()).results,
    runs: async () => (await db.prepare(`SELECT ${runFields} FROM alert_rule_runs ORDER BY created_at,id`).all<RuleRun>()).results,
    findRun,
    async approvalActive(operatorId:string) {
      return Boolean(await db.prepare("SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin')").bind(operatorId).first());
    },
    async publicationApproval(ruleId:string,firingUpdateId:string) {
      const row=await db.prepare(`SELECT audit.payload_json AS payloadJson,update_row.author_operator_id AS operatorId,update_row.automation_attribution AS attribution
        FROM incident_updates update_row JOIN audit_entries audit ON audit.entity_type='alert-rule' AND audit.entity_id=?
        AND audit.action IN ('created','updated') AND audit.created_at<=update_row.created_at AND audit.operator_id=update_row.author_operator_id
        WHERE update_row.id=? ORDER BY audit.created_at DESC,audit.rowid DESC LIMIT 1`).bind(ruleId,firingUpdateId).first<{payloadJson:string;operatorId:string;attribution:string|null}>();
      if(!row?.attribution)throw new Error('The published rule approval no longer exists.');
      const payload=JSON.parse(row.payloadJson) as Record<string,unknown>;
      const input=alertRuleSchema.parse({name:payload.name,mode:payload.mode,state:payload.state,templateId:payload.templateId,firingDelaySeconds:payload.firingDelaySeconds,recoveryHoldSeconds:payload.recoveryHoldSeconds});
      return {input,operatorId:row.operatorId,attribution:row.attribution};
    },
    async intakeContext(incidentId:string) {
      const receipt=await db.prepare("SELECT source_id AS sourceId,error FROM alert_receipts WHERE incident_id=? ORDER BY rowid DESC LIMIT 1").bind(incidentId).first<{sourceId:string;error:string|null}>();
      const components=(await db.prepare("SELECT component_id AS componentId FROM incident_components WHERE incident_id=? AND component_id IS NOT NULL").bind(incidentId).all<{componentId:string}>()).results;
      return receipt ? {...receipt,componentIds:components.map(row=>row.componentId)} : null;
    },
    async findActiveEvidenceIncident(ruleId:string,fingerprints:string[]) {
      const row=await db.prepare(`SELECT e.source_incident_id AS incidentId FROM alert_rule_evidence e
        JOIN alert_rule_runs run ON run.rule_id=e.rule_id AND run.source_incident_id=e.source_incident_id
        JOIN alert_receipts receipt ON receipt.id=e.receipt_id
        WHERE e.rule_id=? AND run.released_at IS NULL AND e.fingerprint IN(SELECT value FROM json_each(?))
        ORDER BY receipt.rowid DESC LIMIT 1`).bind(ruleId,JSON.stringify(fingerprints)).first<{incidentId:string}>();
      return row?.incidentId ?? null;
    },
    async save(sourceId: string, componentId: string, input: AlertRuleInput, actor: string, at: string, templateVersion: string | null) {
      const existing = await db.prepare(`SELECT ${fields} FROM alert_rules r WHERE source_id=? AND component_id=?`).bind(sourceId,componentId).first<RuleView>();
      const id=existing?.id ?? createUlid();
      // An edit may release an unpublished claim. A committed publication keeps
      // its claim and execution until recovery under the original approval.
      const previousRuns=existing ? (await db.prepare(`SELECT ${runFields} FROM alert_rule_runs WHERE rule_id=? AND released_at IS NULL`).bind(existing.id).all<RuleRun>()).results : [];
      const releasedRuns=previousRuns.filter(run=>!run.firingUpdateId);
      await db.batch([
        db.prepare(`SELECT CASE WHEN ? IS NULL AND NOT EXISTS(SELECT 1 FROM alert_rules WHERE source_id=? AND component_id=?) OR EXISTS(SELECT 1 FROM alert_rules WHERE id=? AND updated_at=?) THEN 1 ELSE json('Rule approval changed') END`).bind(existing?.id ?? null,sourceId,componentId,existing?.id ?? null,existing?.updatedAt ?? null),
        activeRuleRunsGuard(db,'rule',id,previousRuns.map(run=>run.incidentId)),
        db.prepare('UPDATE alert_rule_windows SET completed=1 WHERE rule_id=?').bind(id),
        ...releasedRuns.flatMap(run=>[
          db.prepare(`UPDATE incident_components SET state='Operational',updated_at=? WHERE incident_id=?`).bind(at,run.incidentId),
          db.prepare(`UPDATE incidents SET lifecycle=CASE WHEN EXISTS(SELECT 1 FROM incident_updates WHERE incident_id=incidents.id) THEN lifecycle ELSE 'Resolved' END,updated_at=? WHERE id=?`).bind(at,run.incidentId),
          db.prepare(`UPDATE alert_rule_runs SET released_at=?,updated_at=? WHERE id=?`).bind(at,at,run.id),
          db.prepare(`INSERT INTO component_claim_events(id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at) VALUES(?,?,'incident',?,NULL,?,?,?)`).bind(createUlid(),componentId,run.incidentId,at,at,at),
          currentStateHistoryStatement(db,{id:createUlid(),componentId,cause:{type:'incident',id:run.incidentId,operatorId:actor},changedAt:at,createdAt:at,updatedAt:at}),
        ]),
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM alert_sources WHERE id=?) AND EXISTS(SELECT 1 FROM components WHERE id=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM incident_templates WHERE id=? AND updated_at=?)) THEN 1 ELSE json('Rule inputs changed') END`).bind(sourceId,componentId,templateVersion,input.templateId ?? null,templateVersion),
        db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES(?,'alert-rule',?,?,?,?,?,?)`).bind(createUlid(),id,existing ? 'updated':'created',actor,JSON.stringify({sourceId,componentId,name:input.name,mode:input.mode,state:input.state,templateId:input.templateId ?? null,firingDelaySeconds:input.firingDelaySeconds,recoveryHoldSeconds:input.recoveryHoldSeconds}),at,at),
        db.prepare(`INSERT INTO alert_rules(id,source_id,component_id,name,mode,state,template_id,approved_by_operator_id,degradation_reason,firing_delay_seconds,recovery_hold_seconds,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?,?) ON CONFLICT(source_id,component_id) DO UPDATE SET name=excluded.name,mode=excluded.mode,state=excluded.state,template_id=excluded.template_id,approved_by_operator_id=excluded.approved_by_operator_id,degradation_reason=NULL,firing_delay_seconds=excluded.firing_delay_seconds,recovery_hold_seconds=excluded.recovery_hold_seconds,updated_at=excluded.updated_at`).bind(id,sourceId,componentId,input.name,input.mode,input.state,input.templateId ?? null,actor,input.firingDelaySeconds,input.recoveryHoldSeconds,at,at),
      ]);
      return { rule: (await db.prepare(`SELECT ${fields} FROM alert_rules r WHERE source_id=? AND component_id=?`).bind(sourceId,componentId).first<RuleView>())!, publicChanged: releasedRuns.length > 0 };
    },
    async remove(sourceId:string,componentId:string,actor:string,at:string) {
      const rule=await db.prepare(`SELECT ${fields} FROM alert_rules r WHERE source_id=? AND component_id=?`).bind(sourceId,componentId).first<RuleView>();
      if(!rule)return { deleted:false,publicChanged:false };
      const runs=(await db.prepare(`SELECT ${runFields} FROM alert_rule_runs WHERE rule_id=? AND released_at IS NULL`).bind(rule.id).all<RuleRun>()).results;
      await db.batch([
        activeRuleRunsGuard(db,'rule',rule.id,runs.map(run=>run.incidentId)),
        // The trigger records cascaded deletions too. This explicit entry carries the deleting actor.
        db.prepare(`UPDATE alert_rules SET approved_by_operator_id=? WHERE id=?`).bind(actor,rule.id),
        db.prepare(`DELETE FROM alert_rules WHERE id=?`).bind(rule.id),
        ...runs.map(run=>currentStateHistoryStatement(db,{id:createUlid(),componentId:rule.componentId,cause:{type:'incident',id:run.incidentId,operatorId:actor},changedAt:at,createdAt:at,updatedAt:at})),
      ]);
      return { deleted:true,publicChanged:runs.length>0 };
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
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM alert_rules WHERE id=? AND updated_at=? AND EXISTS(SELECT 1 FROM oa_operators WHERE id=alert_rules.approved_by_operator_id AND status='active' AND role IN ('owner','admin'))) THEN 1 ELSE json('Rule changed') END`).bind(rule.id,rule.updatedAt),
        db.prepare(`INSERT INTO incidents(id,reference,title,lifecycle,opened_at,created_by_operator_id,created_at,updated_at) VALUES(?,?,?,'Investigating',?,?,?,?)`).bind(incidentId,reference,title,at,rule.approvedByOperatorId,at,at),
        db.prepare(`INSERT INTO alert_rule_runs(id,rule_id,source_incident_id,incident_id,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(id,rule.id,sourceIncidentId,incidentId,rule.mode,at,at),
        db.prepare(`INSERT INTO incident_components(id,incident_id,component_id,component_name,state,relationship,created_at,updated_at) SELECT ?,?,id,name,?,'Primary',?,? FROM components WHERE id=?`).bind(createUlid(),incidentId,rule.state,at,at,rule.componentId),
        db.prepare(`INSERT INTO incident_drafts(id,incident_id,lifecycle,author_operator_id,created_at,updated_at) VALUES(?,?,'Investigating',?,?,?)`).bind(createUlid(),incidentId,rule.approvedByOperatorId,at,at),
        db.prepare(`INSERT INTO incident_internal_notes(id,incident_id,body,author_operator_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`).bind(createUlid(),sourceIncidentId,`Rule ${rule.name} opened automation incident ${reference} (${incidentId}) from alert ${receiptId}.`,rule.approvedByOperatorId,at,at),
        db.prepare(`INSERT INTO incident_internal_notes(id,incident_id,body,author_operator_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`).bind(createUlid(),incidentId,`rule ${rule.name}, approved by ${rule.approvedByName}; caused by alert ${receiptId} on source incident ${sourceIncidentId}.`,rule.approvedByOperatorId,at,at),
      ]); } catch(cause) {const raced=await findRun(rule.id,sourceIncidentId);if(raced && !raced.releasedAt)return raced;throw cause;}
      return (await findRun(rule.id,sourceIncidentId))!;
    },
    async claim(rule:RuleView,run:RuleRun,receiptId:string,at:string,release:boolean,sourceVersion:string) {
      const active=await db.prepare(`SELECT published_at AS publishedAt FROM incident_components WHERE incident_id=? AND component_id=?`).bind(run.incidentId,rule.componentId).first<{publishedAt:string|null}>();
      if(release ? Boolean(run.releasedAt) : Boolean(active?.publishedAt))return false;
      try { await db.batch([
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM alert_rules WHERE id=? AND updated_at=? AND (?=1 OR (mode='claim' AND EXISTS(SELECT 1 FROM oa_operators WHERE id=alert_rules.approved_by_operator_id AND status='active' AND role IN ('owner','admin')))) AND EXISTS(SELECT 1 FROM alert_sources WHERE id=alert_rules.source_id AND updated_at=?)) THEN 1 ELSE json('Rule changed') END`).bind(rule.id,rule.updatedAt,release?1:0,sourceVersion),
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM alert_rule_runs WHERE id=? AND rule_id=? AND released_at IS NULL)
          AND CASE WHEN ?=1 THEN NOT EXISTS(SELECT 1 FROM alert_rule_evidence WHERE rule_id=? AND source_incident_id=? AND firing=1)
            ELSE EXISTS(SELECT 1 FROM alert_rule_evidence WHERE rule_id=? AND source_incident_id=? AND firing=1)
              AND NOT EXISTS(SELECT 1 FROM incident_components WHERE incident_id=? AND published_at IS NOT NULL) END
          THEN 1 ELSE json('Rule phase changed') END`).bind(run.id,rule.id,release?1:0,rule.id,run.sourceIncidentId,rule.id,run.sourceIncidentId,run.incidentId),
        db.prepare(`UPDATE incident_components SET published_at=COALESCE(published_at,?),state=?,updated_at=? WHERE incident_id=?`).bind(at,release?"Operational":rule.state,at,run.incidentId),
        db.prepare(`UPDATE incidents SET lifecycle=CASE WHEN ?=1 AND EXISTS(SELECT 1 FROM incident_updates WHERE incident_id=incidents.id) THEN lifecycle ELSE ? END,resolved_at=CASE WHEN ?=1 AND EXISTS(SELECT 1 FROM incident_updates WHERE incident_id=incidents.id) THEN resolved_at ELSE ? END,updated_at=? WHERE id=?`).bind(release?1:0,release?"Resolved":"Investigating",release?1:0,release?at:null,at,run.incidentId),
        db.prepare(`UPDATE alert_rule_runs SET released_at=?,updated_at=? WHERE id=?`).bind(release?at:null,at,run.id),
        db.prepare(`INSERT INTO component_claim_events(id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at) VALUES(?,?,'incident',?,?,?,?,?)`).bind(createUlid(),rule.componentId,run.incidentId,release?null:rule.state,at,at,at),
        currentStateHistoryStatement(db,{id:createUlid(),componentId:rule.componentId,cause:{type:'incident',id:run.incidentId,operatorId:rule.approvedByOperatorId},changedAt:at,createdAt:at,updatedAt:at}),
        db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES(?,'alert-rule',?,'acted',?,?,?,?)`).bind(createUlid(),rule.id,rule.approvedByOperatorId,JSON.stringify({receiptId,incidentId:run.incidentId,action:release?'released':'claimed'}),at,at),
      ]); } catch(cause) {
        if (!(cause instanceof Error) || !cause.message.includes('malformed JSON')) throw cause;
        const latest=await db.prepare(`SELECT released_at AS releasedAt FROM alert_rule_runs WHERE id=?`).bind(run.id).first<{releasedAt:string|null}>();
        const evidence=await db.prepare(`SELECT count(*) AS active FROM alert_rule_evidence WHERE rule_id=? AND source_incident_id=? AND firing=1`).bind(rule.id,run.sourceIncidentId).first<{active:number}>();
        const claimed=await db.prepare(`SELECT 1 FROM incident_components WHERE incident_id=? AND published_at IS NOT NULL`).bind(run.incidentId).first();
        // A newer committed phase supersedes this request; no stale claim or
        // recovery may undo it. Other transaction failures remain failures.
        if (latest?.releasedAt || Boolean(evidence?.active) === release || (!release && claimed)) return false;
        throw cause;
      }
      return true;
    },
  };
}

/** Fence the complete active set before an edit or erasure releases claims.
 * A concurrently accepted alert either commits first and makes this operation
 * refresh, or observes the new rule version after this transaction commits. */
export function activeRuleRunsGuard(db:D1Database,kind:'source'|'rule',id:string,incidentIds:string[]) {
  const scope=kind==='source'?'rule.source_id=?':'run.rule_id=?';
  return db.prepare(`SELECT CASE WHEN
    (SELECT count(*) FROM alert_rule_runs run JOIN alert_rules rule ON rule.id=run.rule_id WHERE ${scope} AND run.released_at IS NULL)=?
    AND NOT EXISTS(SELECT 1 FROM alert_rule_runs run JOIN alert_rules rule ON rule.id=run.rule_id WHERE ${scope} AND run.released_at IS NULL AND run.incident_id NOT IN(SELECT value FROM json_each(?)))
    THEN 1 ELSE json('Active rule claims changed') END`).bind(id,incidentIds.length,id,JSON.stringify(incidentIds));
}

/** These fences and markers share UPDATE-008's transaction with update and recipient writes. */
export function automationPublicationStatements(db:D1Database,input:RuleAutomationPublication,updateId:string,at:string):{before:D1PreparedStatement[];after:D1PreparedStatement[]} {
  const column=input.phase==='firing'?'firing_update_id':'recovery_update_id';
  const condition=input.phase==='firing'?`EXISTS(SELECT 1 FROM alert_rule_evidence WHERE rule_id=? AND source_incident_id=run.source_incident_id AND firing=1)`:`NOT EXISTS(SELECT 1 FROM alert_rule_evidence WHERE rule_id=? AND source_incident_id=run.source_incident_id AND firing=1)`;
  const approval=input.phase==='firing'
    ? `rule.mode='claim-and-publish' AND template.id=rule.template_id AND ? = 'rule ' || rule.name || ', approved by ' || COALESCE((SELECT display_name FROM oa_operators WHERE id=rule.approved_by_operator_id),'Erased operator')`
    : `run.mode='claim-and-publish' AND EXISTS(SELECT 1 FROM incident_updates firing WHERE firing.id=run.firing_update_id AND firing.automation_attribution=?)`;
  return {
    before:[db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM alert_rule_runs run JOIN alert_rules rule ON rule.id=run.rule_id JOIN incident_templates template ON template.id=? WHERE run.id=? AND run.${column} IS NULL AND run.released_at IS NULL AND rule.id=? AND rule.updated_at=? AND ${approval} AND template.updated_at=? AND EXISTS(SELECT 1 FROM alert_sources WHERE id=? AND updated_at=?) AND ${condition}) THEN 1 ELSE json('Automation inputs changed') END`).bind(input.templateId,input.runId,input.ruleId,input.ruleVersion,input.attribution,input.templateVersion,input.sourceId,input.sourceVersion,input.ruleId)],
    after:[
      db.prepare(`UPDATE alert_rule_runs SET ${column}=?,released_at=?,updated_at=? WHERE id=?`).bind(updateId,input.phase==='recovery'?at:null,at,input.runId),
      db.prepare(`INSERT INTO incident_internal_notes(id,incident_id,body,author_operator_id,created_at,updated_at) SELECT ?,run.incident_id,?,CASE WHEN ?='recovery' THEN (SELECT author_operator_id FROM incident_updates WHERE id=run.firing_update_id) ELSE rule.approved_by_operator_id END,?,? FROM alert_rule_runs run JOIN alert_rules rule ON rule.id=run.rule_id WHERE run.id=?`).bind(createUlid(),`${input.attribution}; ${input.phase} publication caused by alert ${input.receiptId}.`,input.phase,at,at,input.runId),
    ],
  };
}
