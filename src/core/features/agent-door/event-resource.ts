const resources: Record<string, [string, string, string?]> = {
  component_groups: ['group','groups'], oa_operators: ['access','access'],
  component_claim_events: ['component','components','component_id'],
  component_state_history: ['component','components','component_id'],
  metric_points: ['metric','metrics','metric_id'],
  components: ['component','components'], incidents: ['incident','incidents'],
  incident_drafts: ['incident','incidents','incident_id'], incident_updates: ['incident','incidents','incident_id'],
  incident_internal_notes: ['incident','incidents','incident_id'], maintenance: ['maintenance','maintenance'],
  maintenance_notices: ['maintenance','maintenance','maintenance_id'], subscribers: ['subscriber','subscribers'],
  deliveries: ['delivery','deliveries'], incident_reports: ['report','reports'], public_metrics: ['metric','metrics'],
};
export function nativeEventResource(table: string, row: Record<string, unknown>) {
  if (table === 'page_settings') return {uri:'lamp://page/default',type:'page.changed'};
  if (table === 'ik_jobs' && row.destination === 'lamp' && typeof row.id === 'string') {
    return {uri:`lamp://imports/${encodeURIComponent(row.id)}/report`,type:'import.changed'};
  }
  const spec = resources[table], id = spec && row[spec[2] ?? 'id'];
  return spec && typeof id === 'string' ? {uri: `lamp://${spec[1]}/${encodeURIComponent(id)}`, type: `${spec[0]}.changed`} : null;
}
