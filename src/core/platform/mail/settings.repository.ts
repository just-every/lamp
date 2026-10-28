import type { sessionAuthority } from '../auth/authority';
export function createMailSettingsRepository(db:D1Database){
  return {
    async selected(){return (await db.prepare("SELECT secondary_provider FROM mail_provider_settings WHERE id='default'").first<{secondary_provider:string|null}>())?.secondary_provider??null;},
    async select(provider:string|null,authority:ReturnType<typeof sessionAuthority>){
      const result=await db.prepare(`INSERT INTO mail_provider_settings(id,secondary_provider,updated_at)
        SELECT 'default',?,? WHERE ${authority.sql}
        ON CONFLICT(id) DO UPDATE SET secondary_provider=excluded.secondary_provider,updated_at=excluded.updated_at WHERE ${authority.sql}`)
        .bind(provider,new Date().toISOString(),...authority.params,...authority.params).run();
      return result.meta.changes===1;
    },
  };
}
