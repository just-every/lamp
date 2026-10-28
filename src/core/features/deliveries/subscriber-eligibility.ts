/** Eligibility belongs to the committed recipient set, before any provider call. */
export function eventPreferenceSql(kind: "incidents" | "maintenance" | "components", subscriber = "s") {
  return `EXISTS (SELECT 1 FROM json_each(${subscriber}.event_kinds_json) preference WHERE preference.value = '${kind}')`;
}

export function incidentThresholdSql(incident: string, subscriber = "s") {
  return `(${subscriber}.minimum_impact IS NULL OR EXISTS (SELECT 1 FROM incidents threshold_incident WHERE threshold_incident.id = ${incident} AND COALESCE(threshold_incident.impact_override, CASE threshold_incident.peak_impact WHEN 'Major outage' THEN 'critical' WHEN 'Partially unavailable' THEN 'major' WHEN 'Degraded performance' THEN 'minor' ELSE 'none' END) IN ('major','critical')))`;
}

/** Incident follows do not inherit page-wide component, threshold or event
 * preferences. Their only audience is the one incident selected at opt-in. */
export function ordinarySubscriptionSql(subscriber = "s") {
  return `NOT EXISTS(SELECT 1 FROM incident_subscriptions incident_follow WHERE incident_follow.subscriber_id=${subscriber}.id)`;
}

export function incidentFollowRecipientSql(incident: string, at: string, report: boolean, subscriber = "s") {
  return `EXISTS(SELECT 1 FROM incident_subscriptions incident_follow WHERE incident_follow.subscriber_id=${subscriber}.id
    AND incident_follow.incident_id=${incident} AND incident_follow.ended_at IS NULL
    AND incident_follow.created_at<=${at}${report?" AND incident_follow.include_report=1":""}
    AND (incident_follow.resolution_at IS NULL OR incident_follow.resolution_at>strftime('%Y-%m-%dT%H:%M:%fZ',${at},'-30 days')))`;
}

/** A report is captured before ending the subscription. Only that final event
 * may still dispatch, and explicit unsubscribe/erasure always overrides it. */
export function incidentFinalDeliverySql(event: string, subscriber="s") {
  return `EXISTS(SELECT 1 FROM incident_subscriptions incident_follow WHERE incident_follow.subscriber_id=${subscriber}.id
    AND incident_follow.ended_at IS NOT NULL AND incident_follow.final_event_id=${event}
    AND ${subscriber}.deactivation_reason='incident-follow-ended'
    AND incident_follow.ended_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')
    AND ${subscriber}.destination NOT LIKE 'deleted:%')`;
}

export function incidentDispatchAllowedSql(event: string, incident: string, subscriber="s") {
  return `(${ordinarySubscriptionSql(subscriber)} OR EXISTS(SELECT 1 FROM incident_subscriptions incident_follow
    WHERE incident_follow.subscriber_id=${subscriber}.id AND incident_follow.incident_id=${incident}
      AND incident_follow.ended_at IS NULL
      AND (incident_follow.resolution_at IS NULL OR incident_follow.resolution_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')))
    OR ${incidentFinalDeliverySql(event,subscriber)})`;
}
