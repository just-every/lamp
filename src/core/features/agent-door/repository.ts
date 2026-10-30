/** Native evidence for no-effect checks; transport and policy tables are separate. */
export function agentNativeRepository(db: D1Database) {
  const tables = ['page_settings', 'components', 'component_groups', 'component_standing_claims', 'component_claim_events',
    'component_state_history', 'incidents', 'incident_components', 'incident_drafts',
    'incident_updates', 'incident_internal_notes', 'maintenance', 'maintenance_components',
    'notification_outbox', 'notification_deliveries', 'notification_delivery_attempts',
    'component_notification_deliveries', 'component_delivery_attempts',
    'report_notification_deliveries', 'report_delivery_attempts', 'follow_up_dismissals'];
  return {
    async witness() {
      const results = await db.batch(tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`)));
      return Object.fromEntries(await Promise.all(tables.map(async (table, index) => {
        const rows = results[index]!.results;
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)));
        const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        return [table, { count: rows.length, sha256 }];
      })));
    },
    async draftVersion(incidentId: string) {
      const row = await db.prepare("SELECT COALESCE((SELECT id FROM incident_drafts WHERE incident_id=?), '-') AS id, (SELECT count(*) FROM incident_updates WHERE incident_id=?) AS updates").bind(incidentId, incidentId).first<{ id: string; updates: number }>();
      return `${row!.id}:${row!.updates}`;
    },
  };
}
