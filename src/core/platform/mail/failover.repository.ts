export interface MailRoute {
  message_key: string; envelope_hash: string; configuration_hash: string; primary_provider: string; secondary_provider: string; selected_provider: string;
  first_retryable_failure_at: string | null; ambiguous_failure: number; state: 'ready' | 'sending' | 'accepted';
  claimed_at: string | null; provider_message_id: string | null; accepting_provider: string | null;
}

export function createMailRouteRepository(db: D1Database) {
  return {
    async get(key:string){return db.prepare('SELECT * FROM mail_provider_routes WHERE message_key=?').bind(key).first<MailRoute>();},
    async ensure(input: { key: string; deliveryId: string | null; hash: string; configurationHash:string; primary: string; secondary: string; now: string }) {
      await db.prepare(`INSERT INTO mail_provider_routes(message_key,notification_delivery_id,envelope_hash,configuration_hash,primary_provider,secondary_provider,selected_provider,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(message_key) DO NOTHING`).bind(input.key,input.deliveryId,input.hash,input.configurationHash,input.primary,input.secondary,input.primary,input.now,input.now).run();
      return db.prepare('SELECT * FROM mail_provider_routes WHERE message_key=?').bind(input.key).first<MailRoute>();
    },
    async secondaryEnabled(provider: string) {
      const row=await db.prepare("SELECT secondary_provider FROM mail_provider_settings WHERE id='default'").first<{secondary_provider:string|null}>();
      return row?.secondary_provider===provider;
    },
    async claim(key: string, now: string, failoverBefore: string, reclaimBefore: string, allowSecondary: boolean) {
      // A stale caller may have submitted before dying. Its original provider
      // must reconcile that attempt; an ambiguous claim never enables failover.
      await db.prepare(`UPDATE mail_provider_routes SET state='ready',ambiguous_failure=1,claimed_at=NULL
        WHERE message_key=? AND state='sending' AND claimed_at<=?`).bind(key,reclaimBefore).run();
      if(allowSecondary)await db.prepare(`UPDATE mail_provider_routes SET selected_provider=secondary_provider
        WHERE message_key=? AND state='ready' AND selected_provider=primary_provider
          AND ambiguous_failure=0 AND first_retryable_failure_at<=?
          AND EXISTS(SELECT 1 FROM mail_provider_settings s WHERE s.id='default' AND s.secondary_provider=mail_provider_routes.secondary_provider)`).bind(key,failoverBefore).run();
      const result = await db.prepare("UPDATE mail_provider_routes SET state='sending',claimed_at=?,updated_at=? WHERE message_key=? AND state='ready' AND (selected_provider=primary_provider OR EXISTS(SELECT 1 FROM mail_provider_settings s WHERE s.id='default' AND s.secondary_provider=mail_provider_routes.secondary_provider))").bind(now,now,key).run();
      if (result.meta.changes !== 1) return null;
      return db.prepare('SELECT * FROM mail_provider_routes WHERE message_key=?').bind(key).first<MailRoute>();
    },
    async accepted(key: string, provider: string, providerMessageId: string, now: string) {
      await db.prepare("UPDATE mail_provider_routes SET state='accepted',claimed_at=NULL,accepting_provider=?,provider_message_id=?,updated_at=? WHERE message_key=? AND state='sending'").bind(provider,providerMessageId,now,key).run();
    },
    async failed(key: string, safe: boolean, now: string) {
      await db.prepare(`UPDATE mail_provider_routes SET state='ready',claimed_at=NULL,updated_at=?,
        first_retryable_failure_at=CASE WHEN ?=1 THEN COALESCE(first_retryable_failure_at,?) ELSE first_retryable_failure_at END,
        ambiguous_failure=CASE WHEN ?=1 THEN ambiguous_failure ELSE 1 END WHERE message_key=? AND state='sending'`)
        .bind(now,safe?1:0,now,safe?1:0,key).run();
    },
  };
}
export type MailRouteRepository = ReturnType<typeof createMailRouteRepository>;
