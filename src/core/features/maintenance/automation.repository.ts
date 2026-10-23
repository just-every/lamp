export interface MaintenanceAutomation { autoStart: boolean; autoComplete: boolean }
export const defaultMaintenanceAutomation: MaintenanceAutomation = { autoStart: true, autoComplete: true };

/** A sidecar keeps old imported maintenance records and their sealed journals
 * unchanged. An absent row has the original automatic behavior. */
export function createMaintenanceAutomationRepository(db: D1Database) {
  return {
    async getDefault(): Promise<MaintenanceAutomation> {
      const row = await db.prepare('SELECT auto_start AS autoStart,auto_complete AS autoComplete FROM maintenance_automation_defaults WHERE singleton=1').first<{ autoStart: number; autoComplete: number }>();
      return row ? { autoStart: Boolean(row.autoStart), autoComplete: Boolean(row.autoComplete) } : { ...defaultMaintenanceAutomation };
    },
    async saveDefault(value: MaintenanceAutomation): Promise<MaintenanceAutomation> {
      await db.prepare('INSERT INTO maintenance_automation_defaults(singleton,auto_start,auto_complete) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET auto_start=excluded.auto_start,auto_complete=excluded.auto_complete').bind(Number(value.autoStart),Number(value.autoComplete)).run();
      return { ...value };
    },
    async get(maintenanceId: string): Promise<MaintenanceAutomation> {
      const row = await db.prepare(`SELECT auto_start AS autoStart,auto_complete AS autoComplete FROM maintenance_automation WHERE maintenance_id=?`).bind(maintenanceId).first<{ autoStart: number; autoComplete: number }>();
      return row ? { autoStart: Boolean(row.autoStart), autoComplete: Boolean(row.autoComplete) } : { ...defaultMaintenanceAutomation };
    },
    async list(): Promise<Map<string, MaintenanceAutomation>> {
      const rows = (await db.prepare(`SELECT maintenance_id AS id,auto_start AS autoStart,auto_complete AS autoComplete FROM maintenance_automation`).all<{ id: string; autoStart: number; autoComplete: number }>()).results;
      return new Map(rows.map(row => [row.id, { autoStart: Boolean(row.autoStart), autoComplete: Boolean(row.autoComplete) }]));
    },
  };
}

/** Append after the guarded notice in the same write batch. Omitted switches
 * preserve an existing false value, including on a date-only reschedule. */
export function automationStatement(db: D1Database, maintenanceId: string, automation: Partial<MaintenanceAutomation>, noticeId: string) {
  return db.prepare(`INSERT INTO maintenance_automation(maintenance_id,auto_start,auto_complete)
    SELECT ?,COALESCE(?,1),COALESCE(?,1) WHERE EXISTS(SELECT 1 FROM maintenance_notices WHERE id=?)
    ON CONFLICT(maintenance_id) DO UPDATE SET auto_start=COALESCE(?,maintenance_automation.auto_start),auto_complete=COALESCE(?,maintenance_automation.auto_complete)`)
    .bind(maintenanceId,automation.autoStart === undefined ? null : Number(automation.autoStart),automation.autoComplete === undefined ? null : Number(automation.autoComplete),noticeId,automation.autoStart === undefined ? null : Number(automation.autoStart),automation.autoComplete === undefined ? null : Number(automation.autoComplete));
}
