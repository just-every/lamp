/** Incident suppression is checked only by scheduled work, never a public read. */
export function createTrafficIncidentRepository(db: D1Database) {
  return {
    async unresolved() {
      return Boolean(await db.prepare("SELECT 1 AS present FROM incidents WHERE resolved_at IS NULL AND deleted_at IS NULL LIMIT 1").first());
    },
  };
}
