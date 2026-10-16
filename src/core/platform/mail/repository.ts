export interface MailSendRecord { id: string; envelope_hash: string; provider_receipt: string | null; state: 'sending' | 'accepted' | 'uncertain' | 'rejected'; created_at: string; updated_at: string }
export function createMailSendRepository(database: D1Database) {
  return {
    async claim(id: string, hash: string, now: string, messageKey: string | null = null) {
      const result = await database.prepare("INSERT INTO mail_send_ledger (id,envelope_hash,state,created_at,updated_at,message_key) VALUES (?,?,'sending',?,?,?) ON CONFLICT(id) DO NOTHING").bind(id, hash, now, now, messageKey).run();
      return result.meta.changes === 1;
    },
    async get(id: string) { return database.prepare('SELECT * FROM mail_send_ledger WHERE id = ?').bind(id).first<MailSendRecord>(); },
    async receiptForMessageKey(messageKey: string) {
      return (await database.prepare("SELECT provider_receipt FROM mail_send_ledger WHERE message_key = ? AND state = 'accepted' AND provider_receipt IS NOT NULL LIMIT 1").bind(messageKey).first<{ provider_receipt: string }>())?.provider_receipt ?? null;
    },
    async finish(id: string, state: 'accepted' | 'uncertain' | 'rejected', providerReceipt: string | null = null) { await database.prepare('UPDATE mail_send_ledger SET state = ?, provider_receipt = COALESCE(?, provider_receipt), updated_at = ? WHERE id = ?').bind(state, providerReceipt, new Date().toISOString(), id).run(); },
    async releaseRejected(id: string) { await database.prepare("DELETE FROM mail_send_ledger WHERE id = ? AND state = 'sending'").bind(id).run(); },
  };
}
export type MailSendRepository = ReturnType<typeof createMailSendRepository>;
