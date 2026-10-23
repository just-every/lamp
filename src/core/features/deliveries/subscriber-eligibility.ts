/** Eligibility belongs to the committed recipient set, before any provider call. */
export function eventPreferenceSql(kind: "incidents" | "maintenance" | "components", subscriber = "s") {
  return `EXISTS (SELECT 1 FROM json_each(${subscriber}.event_kinds_json) preference WHERE preference.value = '${kind}')`;
}

export function incidentThresholdSql(incident: string, subscriber = "s") {
  return `(${subscriber}.minimum_impact IS NULL OR EXISTS (SELECT 1 FROM incidents threshold_incident WHERE threshold_incident.id = ${incident} AND COALESCE(threshold_incident.impact_override, CASE threshold_incident.peak_impact WHEN 'Major outage' THEN 'critical' WHEN 'Partially unavailable' THEN 'major' WHEN 'Degraded performance' THEN 'minor' ELSE 'none' END) IN ('major','critical')))`;
}
