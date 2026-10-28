/** Match public-snapshot's incident projection: at least one publication and a
 * published attachment that is public now, including retained detached names. */
export function publicIncidentSubscriptionSql(incident = "i") {
  return `${incident}.deleted_at IS NULL
    AND EXISTS(SELECT 1 FROM incident_updates public_update WHERE public_update.incident_id=${incident}.id)
    AND EXISTS(SELECT 1 FROM incident_components public_attachment
      LEFT JOIN components public_component ON public_component.id=public_attachment.component_id
      WHERE public_attachment.incident_id=${incident}.id AND public_attachment.published_at IS NOT NULL
        AND ((public_attachment.component_id IS NULL AND public_attachment.detached_internal=0) OR public_component.internal=0))`;
}
