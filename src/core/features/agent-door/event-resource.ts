const resources: Record<string, [string, string, string?]> = {
  components: ['component','components'], incidents: ['incident','incidents'],
  incident_drafts: ['incident','incidents','incident_id'], incident_updates: ['incident','incidents','incident_id'],
  incident_internal_notes: ['incident','incidents','incident_id'], maintenance: ['maintenance','maintenance'],
  maintenance_notices: ['maintenance','maintenance','maintenance_id'], subscribers: ['subscriber','subscribers'],
  deliveries: ['delivery','deliveries'], incident_reports: ['report','reports'], public_metrics: ['metric','metrics'],
};
export function nativeEventResource(table: string, row: Record<string, unknown>) {
  const spec = resources[table], id = spec && row[spec[2] ?? 'id'];
  return spec && typeof id === 'string' ? {uri: `lamp://${spec[1]}/${encodeURIComponent(id)}`, type: `${spec[0]}.changed`} : null;
}
