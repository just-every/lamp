import { automationPublicationStatements } from "../intake/rule-repository";
import { componentNotificationStatements } from "../deliveries/component-notifications.repository";
import { COMPONENT_STATE_SEVERITY } from "../../shared/domain";
import { createUlid } from "../../shared/ids";
import { currentStateHistoryStatement } from "../components/state-history-repository";
import { publicationComponentsGuard } from "./component-claims";
import { recoverySnapshotGuard } from "./recovery-repository";
import type { IncidentPublishRecord } from "./repository";

/** Update, claims, aggregate history and recipient selection share one D1 commit. */
export async function publishIncidentDraft(binding: D1Database, input: IncidentPublishRecord, recipients: D1PreparedStatement[]) {
  const statements = [publicationComponentsGuard(binding, input.incidentId, input.baselineComponents)];
  const automation = input.automation ? automationPublicationStatements(binding,input.automation,input.id,input.createdAt) : null;
  if(automation)statements.unshift(...automation.before);
  const notificationHistoryIds: string[] = [];
  if (input.recovery) statements.push(recoverySnapshotGuard(binding, input.incidentId, input.recovery.snapshot));
  for (const change of input.stagedChanges) {
    statements.push(change.attachmentId === null
      ? binding.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM components WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM incident_components WHERE incident_id = ? AND component_id = ?) THEN 1 ELSE json('Staged component changed') END`).bind(change.componentId, input.incidentId, change.componentId)
      : binding.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM incident_components WHERE id = ? AND incident_id = ? AND component_id = ? AND state = ? AND updated_at = ?) THEN 1 ELSE json('Staged attachment changed') END`).bind(change.attachmentId, input.incidentId, change.componentId, change.expectedState, change.expectedUpdatedAt));
  }
  for (const [componentId, count] of Object.entries(input.claimEventCounts ?? {})) statements.push(
    binding.prepare(`SELECT CASE WHEN (SELECT count(*) FROM component_claim_events WHERE component_id = ?) = ? THEN 1 ELSE json('Historical evidence changed') END`).bind(componentId, count),
  );
  statements.push(binding.prepare(`INSERT INTO incident_updates
    (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,is_retroactive,author_operator_id,corrects_update_id,created_at,updated_at,component_changes_json,component_snapshot_json,automation_attribution,automation_receipt_id)
    VALUES ((SELECT id FROM incident_drafts WHERE id = ? AND incident_id = ?),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(input.id,input.incidentId,input.incidentId,input.lifecycle,input.affectedAudience,input.customerImpact,input.whatStillWorks,input.details,input.nextUpdateAt,input.publishedAt,input.isRetroactive ? 1 : 0,input.authorOperatorId,input.correctsUpdateId,input.createdAt,input.updatedAt,JSON.stringify(input.componentChanges),JSON.stringify(input.componentSnapshot),input.automation?.attribution ?? null,input.automation?.receiptId ?? null));
  for (const component of input.components.filter(row => !input.baselineComponents.some(baseline => baseline.id === row.id))) statements.push(
    binding.prepare(`INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at) VALUES (?,?,?,?,?,?,NULL,?,?)`)
      .bind(component.id,input.incidentId,component.componentId,component.componentName,component.state,component.relationship,input.createdAt,input.updatedAt),
  );
  for (const event of input.claimEvents) statements.push(
    binding.prepare(`INSERT INTO component_claim_events (id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(event.id,event.componentId,event.causeType,event.causeId,event.state,event.changedAt,event.createdAt,event.updatedAt),
  );
  // A backdated publication cannot replace a newer claim in the live attachment.
  for (const component of input.components) statements.push(
    binding.prepare(`UPDATE incident_components SET
      state = CASE WHEN (SELECT lifecycle FROM incident_updates WHERE incident_id = incident_components.incident_id ORDER BY published_at DESC,created_at DESC,id DESC LIMIT 1) = 'Resolved' THEN state ELSE COALESCE((SELECT state FROM component_claim_events WHERE component_id = incident_components.component_id AND cause_type = 'incident' AND cause_id = incident_components.incident_id ORDER BY changed_at DESC,created_at DESC,id DESC LIMIT 1), 'Operational') END,
      relationship = ?, published_at = CASE WHEN published_at IS NULL OR published_at > ? THEN ? ELSE published_at END, updated_at = ? WHERE id = ?`)
      .bind(component.relationship,input.publishedAt,input.publishedAt,input.updatedAt,component.id),
  );
  statements.push(binding.prepare(`UPDATE incidents SET
    lifecycle = (SELECT lifecycle FROM incident_updates WHERE incident_id = ? ORDER BY published_at DESC,created_at DESC,id DESC LIMIT 1),
    resolved_at = (SELECT CASE WHEN lifecycle = 'Resolved' THEN published_at ELSE NULL END FROM incident_updates WHERE incident_id = ? ORDER BY published_at DESC,created_at DESC,id DESC LIMIT 1),
    peak_impact = (SELECT value FROM json_each(?) WHERE value = incidents.peak_impact OR value = ? ORDER BY key LIMIT 1), updated_at = ? WHERE id = ?`)
    .bind(input.incidentId,input.incidentId,JSON.stringify(COMPONENT_STATE_SEVERITY),input.peakImpact,input.updatedAt,input.incidentId));
  if (input.isRetroactive) {
    for (const entry of input.historyEntries) statements.push(binding.prepare(`INSERT INTO component_state_history (id,component_id,previous_state,new_state,cause_type,cause_id,operator_id,changed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(entry.id,entry.componentId,entry.previousState,entry.newState,entry.cause.type,entry.cause.id,entry.cause.operatorId,entry.changedAt,entry.createdAt,entry.updatedAt));
  } else {
    for (const component of input.components) if (component.componentId) {
      const historyId = createUlid();
      notificationHistoryIds.push(historyId);
      statements.push(currentStateHistoryStatement(binding, {
        id: historyId, componentId: component.componentId, cause: { type: "incident", id: input.incidentId, operatorId: input.authorOperatorId },
        changedAt: input.publishedAt, createdAt: input.createdAt, updatedAt: input.updatedAt,
      }));
    }
  }
  if (input.recovery?.overrideReason) statements.push(
    binding.prepare(`INSERT INTO incident_internal_notes (id,incident_id,body,author_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .bind(createUlid(),input.incidentId,`Recovery check overridden: ${input.recovery.overrideReason}`,input.authorOperatorId,input.createdAt,input.updatedAt),
  );
  statements.push(
    binding.prepare(`DELETE FROM incident_drafts WHERE id = ?`).bind(input.id),
    binding.prepare(`INSERT INTO audit_entries (id,entity_type,entity_id,action,operator_id,reason,payload_json,created_at,updated_at) VALUES (?,'incident-update',?,'published',?,?,?,?,?)`)
      .bind(`${input.id}-audit`,input.id,input.authorOperatorId,input.recovery?.overrideReason ?? null,JSON.stringify({ incidentId: input.incidentId, publishedAt: input.publishedAt, correctsUpdateId: input.correctsUpdateId, componentChanges: input.componentChanges, recovery: input.recovery?.result }),input.createdAt,input.updatedAt),
    ...recipients,
    ...notificationHistoryIds.flatMap(historyId => componentNotificationStatements(binding, historyId, input.createdAt)),
  );
  if(automation)statements.push(...automation.after);
  await binding.batch(statements);
}
