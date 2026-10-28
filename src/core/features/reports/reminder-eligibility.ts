/** MOVE-002 imports remain silent, including after archive restore. Product
 * target markers travel with the records; transient import custody does not.
 * A live operator publication makes subsequent report reminders ordinary work. */
export function reportReminderEligibleSql(alias: "incidents" | "i") {
  return `(NOT EXISTS(SELECT 1 FROM statuspage_import_targets imported
    WHERE imported.kind='incident' AND imported.id=${alias}.id)
    OR EXISTS(SELECT 1 FROM incident_updates live
      WHERE live.incident_id=${alias}.id AND live.is_retroactive=0))`;
}
