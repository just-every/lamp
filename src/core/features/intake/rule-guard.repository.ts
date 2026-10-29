import { createUlid } from "../../shared/ids";
import { currentStateHistoryStatement } from "../components/state-history-repository";
import type { RuleView } from "./rule-schema";

/** Durable clocks share the accepted receipt's evidence; Cron never invents an alert. */
export function createRuleGuardRepository(db: D1Database) {
  return {
    async heldIncident(ruleId: string, sourceIncidentId: string | null) {
      const row = await db.prepare(`SELECT window.source_incident_id AS id FROM alert_rule_windows window
        JOIN alert_receipts receipt ON receipt.id=window.receipt_id
        JOIN alert_rule_runs run ON run.rule_id=window.rule_id AND run.source_incident_id=window.source_incident_id
        WHERE window.rule_id=? AND (window.firing=0 OR receipt.incident_id=?) AND run.released_at IS NULL
        ORDER BY run.created_at DESC LIMIT 1`).bind(ruleId,sourceIncidentId).first<{id:string}>();
      return row?.id ?? null;
    },
    async observe(rule: RuleView, incidentId: string, receiptId: string, firing: boolean, at: string, now: number, hasRun: boolean) {
      const previous = await db.prepare(`SELECT firing,changed_at AS changedAt,due_at AS dueAt,completed FROM alert_rule_windows WHERE rule_id=? AND source_incident_id=?`)
        .bind(rule.id,incidentId).first<{firing:number;changedAt:string;dueAt:number;completed:number}>();
      const changed = !previous || Boolean(previous.firing) !== firing;
      const changedAt = changed ? at : previous.changedAt;
      const dueAt = changed ? Date.parse(at) + (firing ? (hasRun ? 0 : rule.firingDelaySeconds) : rule.recoveryHoldSeconds)*1000 : previous.dueAt;
      await db.prepare(`INSERT INTO alert_rule_windows(rule_id,source_incident_id,receipt_id,firing,changed_at,due_at,completed) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(rule_id,source_incident_id) DO UPDATE SET receipt_id=excluded.receipt_id,firing=excluded.firing,changed_at=excluded.changed_at,due_at=excluded.due_at,completed=excluded.completed`)
        .bind(rule.id,incidentId,receiptId,firing?1:0,changedAt,dueAt,!firing && !hasRun ? 1 : 0).run();
      return (firing || hasRun) && dueAt <= now;
    },
    async complete(ruleId: string, incidentId: string, receiptId: string) {
      await db.prepare("UPDATE alert_rule_windows SET completed=1 WHERE rule_id=? AND source_incident_id=? AND receipt_id=?").bind(ruleId,incidentId,receiptId).run();
    },
    async due(now: number) {
      return (await db.prepare(`SELECT window.rule_id AS ruleId,window.source_incident_id AS incidentId,receipt.id AS receiptId,receipt.source_id AS sourceId,
        receipt.payload_json AS payloadJson,receipt.received_at AS receivedAt,work.source_version AS sourceVersion
        FROM alert_rule_windows window JOIN alert_receipts receipt ON receipt.id=window.receipt_id JOIN alert_rule_work work ON work.receipt_id=receipt.id
        WHERE window.completed=0 AND window.due_at<=? ORDER BY window.due_at LIMIT 100`).bind(now)
        .all<{ruleId:string;incidentId:string;receiptId:string;sourceId:string;payloadJson:string;receivedAt:string;sourceVersion:string}>()).results;
    },
    async undo(runId: string, actor: string, at: string) {
      const run = await db.prepare(`SELECT run.incident_id AS incidentId,run.rule_id AS ruleId,rule.component_id AS componentId,run.source_incident_id AS sourceIncidentId,run.undone_at AS undoneAt
        FROM alert_rule_runs run JOIN alert_rules rule ON rule.id=run.rule_id WHERE run.id=? AND run.released_at IS NULL`)
        .bind(runId).first<{incidentId:string;ruleId:string;componentId:string;sourceIncidentId:string;undoneAt:string|null}>();
      if (!run) return false;
      await db.batch([
        db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM alert_rule_runs WHERE id=? AND released_at IS NULL AND undone_at IS NULL) THEN 1 ELSE json('Automatic change already ended') END").bind(runId),
        db.prepare("UPDATE incident_components SET state='Operational',updated_at=? WHERE incident_id=?").bind(at,run.incidentId),
        db.prepare("UPDATE incidents SET lifecycle='Resolved',resolved_at=?,updated_at=? WHERE id=?").bind(at,at,run.incidentId),
        db.prepare("UPDATE alert_rule_runs SET released_at=?,undone_at=?,undone_by_operator_id=?,updated_at=? WHERE id=?").bind(at,at,actor,at,runId),
        db.prepare("UPDATE alert_rule_windows SET completed=1 WHERE rule_id=? AND source_incident_id=?").bind(run.ruleId,run.sourceIncidentId),
        db.prepare(`INSERT INTO component_claim_events(id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at) VALUES(?,?,'incident',?,NULL,?,?,?)`).bind(createUlid(),run.componentId,run.incidentId,at,at,at),
        currentStateHistoryStatement(db,{id:createUlid(),componentId:run.componentId,cause:{type:'incident',id:run.incidentId,operatorId:actor},changedAt:at,createdAt:at,updatedAt:at}),
        db.prepare("INSERT INTO incident_internal_notes(id,incident_id,body,author_operator_id,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(createUlid(),run.incidentId,"Automatic change undone. The rule claim was released; all earlier publications and history are retained.",actor,at,at),
        db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES(?,'alert-rule',?,'undone',?,?,?,?)").bind(createUlid(),run.ruleId,actor,JSON.stringify({runId,incidentId:run.incidentId}),at,at),
      ]);
      return true;
    },
  };
}
