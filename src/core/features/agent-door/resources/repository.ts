import { loadPlans } from "../../../../../modules/import-kit/src/d1/plans.ts";
import { reportFromPlan } from "../../statuspage-import/planning";
import type { ResourceContext } from "../../../../base/modules/agent-door/types.ts";

/** Resource admission is deliberately independent of an old token's person DTO.
 * A native management read credential grants only components and metrics. */
export function createAgentResourceRepository(db: D1Database) {
  async function admitted(ctx: Pick<ResourceContext, "person" | "clientId" | "scopes">, family: string) {
    if (!ctx.scopes.includes("lamp:read")) return false;
    const person = await db.prepare("SELECT 1 AS allowed FROM oa_operators WHERE id=? AND status='active' AND role='owner'")
      .bind(ctx.person.id).first();
    if (!person) return false;
    if (!ctx.clientId) return true;
    if (family !== "components") return false;
    return Boolean(await db.prepare(`SELECT 1 FROM management_tokens t
      JOIN oa_credentials c ON c.id=t.id JOIN oa_operators o ON o.id=c.operator_id
      WHERE t.id=? AND t.issuer_id=? AND t.read_scope=1 AND t.revoked_at IS NULL
      AND c.operator_id=t.issuer_id AND c.revoked_at IS NULL AND c.expires_at>unixepoch('subsec')*1000
      AND o.id=? AND o.version=c.operator_version AND o.status='active' AND o.role='owner'`)
      .bind(ctx.clientId, ctx.person.id, ctx.person.id).first());
  }

  return {
    admitted,
    async subscriber(id: string) {
      const row = await db.prepare(`SELECT id,channel,state,selection_mode AS selectionMode,
        deactivation_reason AS deactivationReason,deactivated_at AS deactivatedAt,
        event_kinds_json AS eventKindsJson,minimum_impact AS minimumImpact,
        created_at AS createdAt,updated_at AS updatedAt FROM subscriber_directory WHERE id=?`)
        .bind(id).first<Record<string, unknown>>();
      if (!row) return null;
      const components = (await db.prepare("SELECT component_id AS componentId FROM subscriber_components WHERE subscriber_id=? ORDER BY component_id")
        .bind(id).all<{ componentId: string }>()).results;
      const { eventKindsJson, ...fields } = row;
      return { ...fields, eventKinds: JSON.parse(String(eventKindsJson)), componentIds: components.map(item => item.componentId) };
    },
    async delivery(id: string) {
      // Outcome is a native provider fact. An accepted attempt is kept separate
      // from a delivered receipt; neither means that a person read a notice.
      const row = await db.prepare(`SELECT id,subscriber_id AS subscriberId,incident_update_id AS incidentUpdateId,
        incident_report_id AS incidentReportId,maintenance_id AS maintenanceId,notification_event_id AS notificationEventId,
        channel,outcome,queued_at AS queuedAt,outcome_at AS outcomeAt,updated_at AS updatedAt
        FROM notification_delivery_records WHERE id=?`).bind(id).first<Record<string, unknown>>();
      if (!row) {
        const sms = await db.prepare(`SELECT id,subscriber_id AS subscriberId,incident_update_id AS incidentUpdateId,
          incident_report_id AS incidentReportId,maintenance_id AS maintenanceId,event_id AS notificationEventId,
          'sms' AS channel,outcome,queued_at AS queuedAt,outcome_at AS outcomeAt,
          provider_message_id IS NOT NULL AS providerAccepted FROM sms_deliveries WHERE id=?`)
          .bind(id).first<Record<string, unknown>>();
        if (sms) return sms;
        const chat = await db.prepare(`SELECT p.id,p.incident_update_id AS incidentUpdateId,p.destination_id AS destinationId,
          d.kind AS channel,COALESCE(x.state,'queued') AS outcome,p.queued_at AS queuedAt,x.attempts
          FROM delivery_channel_posts p JOIN delivery_channel_destinations d ON d.id=p.destination_id
          LEFT JOIN integration_deliveries x ON x.namespace='lamp-channels' AND x.id=p.id WHERE p.id=?`)
          .bind(id).first<Record<string, unknown>>();
        if (chat) return chat;
        return db.prepare(`SELECT p.id,p.event_id AS notificationEventId,p.incident_id AS incidentId,
          p.maintenance_id AS maintenanceId,a.network AS channel,COALESCE(x.state,'queued') AS outcome,
          p.queued_at AS queuedAt,p.delivered_at AS providerAcceptedAt,x.attempts
          FROM social_posts p JOIN social_accounts a ON a.id=p.account_id
          LEFT JOIN integration_deliveries x ON x.namespace='lamp-social' AND x.id=p.id WHERE p.id=?`)
          .bind(id).first<Record<string, unknown>>();
      }
      const attempts = (await db.prepare(`SELECT id,attempt_number AS attemptNumber,attempted_at AS attemptedAt,
        provider_message_id IS NOT NULL AS providerAccepted,local_capture_id IS NOT NULL AS locallyCaptured,
        error IS NOT NULL AS failed FROM notification_attempt_records WHERE delivery_id=? ORDER BY attempt_number,id`)
        .bind(id).all<Record<string, unknown>>()).results;
      return { ...row, attempts };
    },
    async reportIncident(id: string) {
      return db.prepare(`SELECT r.incident_id AS incidentId FROM incident_reports r JOIN incidents i ON i.id=r.incident_id
        WHERE r.id=? AND i.deleted_at IS NULL`).bind(id).first<{ incidentId: string }>();
    },
    async importReport(id: string, personId: string) {
      // Legacy move-in jobs remain restricted to their native principal. A
      // Business door plan is shared with equal native operators, as Move in is.
      const job = await db.prepare(`SELECT j.id,j.plan_json,j.state,j.checkpoint,j.total,
        EXISTS(SELECT 1 FROM ik_door_plans d WHERE d.job_id=j.id) AS businessDoor
        FROM ik_jobs j WHERE j.id=? AND j.destination='lamp' AND
        (j.principal_id=? OR EXISTS(SELECT 1 FROM ik_door_plans d WHERE d.job_id=j.id))`)
        .bind(id, personId).first<{ id: string; plan_json: string; state: string; checkpoint: number; total: number; businessDoor: number }>();
      if (!job) return null;
      const plans = await loadPlans([job], db as never);
      const plan = plans.get(job.id);
      if (!plan) return null;
      const report = reportFromPlan(plan, job.state);
      // Source names, subscriber addresses, uploaded bytes and raw plan entries
      // stay in their native import door. This is the actual saved job report.
      return { id: job.id, state: job.state, checkpoint: job.checkpoint, total: job.total,
        fingerprint: report.fingerprint, asOf: report.asOf, counts: report.counts, limits: report.limits,
        invitationsAreSeparate: true, businessDoor: Boolean(job.businessDoor) };
    },
    async nativeRows() {
      const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all<{ name: string }>()).results
        .map(row => row.name).filter(witnessTable);
      const tables: Record<string, Array<Record<string, unknown>>> = {};
      // Table identifiers originate in sqlite_master, are additionally checked
      // against a closed identifier grammar, and never come from tool input.
      for (const name of names) {
        const rows = (await db.prepare(`SELECT * FROM "${name}"`).all<Record<string, unknown>>()).results;
        tables[name] = rows.map(row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, secretColumn(key) ? value === null ? null : "[present]" : value])));
      }
      return tables;
    },
  };
}

// Door policy/transport audit is intentionally absent from a native-effect
// witness: refusing a call must append that audit without changing product data.
// Session and rate-limit bookkeeping also changes independently of native work.
function witnessTable(name: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return false;
  if (/^(sqlite_|agent_door_|bs_)/.test(name)) return false;
  if (/^(sessions|rate_limits|oa_sessions|oa_provider_sessions|oa_provider_session_pins|oa_limits|oa_oidc_limits|oa_oidc_transactions|oa_tokens|oa_owner_signins|oa_step_up_challenges|oa_dev_credentials|subscriber_oauth_states|chat_requests|chat_link_codes|chat_previews)$/.test(name)) return false;
  return true;
}

function secretColumn(name: string) {
  return /(^|_)(secret|password|credential|token|key|sealed|authorization|cookie|destination|contact_email)(_|$)/i.test(name)
    || /^(private_key|public_keys|mail_payload_json|payload_json|body|plan_json|settings_json|document|value)$/.test(name);
}
