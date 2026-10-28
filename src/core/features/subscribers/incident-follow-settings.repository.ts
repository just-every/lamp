import { createUlid } from "../../shared/ids";

export interface IncidentFollowSettings { includeReport: boolean }

/** Owner/admin configuration; the subscription records keep their own choice. */
export function createIncidentFollowSettingsRepository(binding: D1Database) {
  return {
    async get(): Promise<IncidentFollowSettings> {
      const row = await binding.prepare("SELECT include_report FROM incident_follow_settings WHERE id=1").first<{ include_report: number }>();
      if (!row) throw new Error("Incident follow settings are unavailable.");
      return { includeReport: Boolean(row.include_report) };
    },
    async set(includeReport: boolean, operatorId: string, now: string): Promise<boolean> {
      try {
        await binding.batch([
          binding.prepare("SELECT CASE WHEN EXISTS (SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin')) THEN 1 ELSE json('Incident follow settings authority changed.') END").bind(operatorId),
          binding.prepare("UPDATE incident_follow_settings SET include_report=? WHERE id=1").bind(Number(includeReport)),
          binding.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES(?,'settings','incident-follow','incident-follow-settings-updated',?,?,?,?)").bind(createUlid(), operatorId, JSON.stringify({ includeReport }), now, now),
        ]);
        return true;
      } catch (cause) {
        if (cause instanceof Error && cause.message.includes("malformed JSON")) return false;
        throw cause;
      }
    },
  };
}
