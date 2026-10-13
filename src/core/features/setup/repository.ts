export function createSetupRepository(db: D1Database) {
  return {
    async initialized() {return Boolean(await db.prepare('SELECT 1 FROM oa_bootstrap').first());},
    // Deployment or installer setup stores the page before the owner claims it;
    // managed readiness may publish that configured page from then on.
    async pageConfigured() {return Boolean(await db.prepare("SELECT 1 FROM page_settings WHERE id='default' UNION ALL SELECT 1 FROM oa_bootstrap LIMIT 1").first());},
  };
}
