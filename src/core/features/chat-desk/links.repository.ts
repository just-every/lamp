import { createUlid, nowIso } from '../../shared/ids';
export type ChatIdentity = { transport: 'slack' | 'teams'; tenant: string; subject: string };
export function createChatLinksRepository(db: D1Database) {
  return {
    async mint(operator: string, hash: string, expires: number) {
      await db.batch([
        db.prepare('DELETE FROM chat_link_codes WHERE operator_id=? OR expires_at<=?').bind(operator, Date.now()),
        db.prepare('INSERT INTO chat_link_codes(hash,operator_id,expires_at) VALUES(?,?,?)').bind(hash, operator, expires),
      ]);
    },
    async redeem(hash: string, identity: ChatIdentity, now: number) {
      const id = createUlid(), at = nowIso();
      const results = await db.batch([
        db.prepare(`INSERT INTO chat_links(id,operator_id,transport,tenant,subject,created_at)
          SELECT ?,c.operator_id,?,?,?,? FROM chat_link_codes c JOIN oa_operators o ON o.id=c.operator_id
          WHERE c.hash=? AND c.expires_at>? AND o.status='active'
          AND NOT EXISTS(SELECT 1 FROM chat_links WHERE transport=? AND tenant=? AND subject=?)`)
          .bind(id, identity.transport, identity.tenant, identity.subject, at, hash, now, identity.transport, identity.tenant, identity.subject),
        db.prepare('DELETE FROM chat_link_codes WHERE hash=?').bind(hash),
      ]);
      return results[0].meta.changes ? this.resolve(identity) : null;
    },
    async resolve(identity: ChatIdentity): Promise<string | null> {
      const row = await db.prepare(`SELECT l.operator_id AS operator FROM chat_links l JOIN oa_operators o ON o.id=l.operator_id
        WHERE l.transport=? AND l.tenant=? AND l.subject=? AND o.status='active'`)
        .bind(identity.transport, identity.tenant, identity.subject).first<{ operator: string }>();
      return row?.operator ?? null;
    },
    async list(operator: string) {
      return (await db.prepare('SELECT id,transport,tenant,subject,created_at AS createdAt FROM chat_links WHERE operator_id=? ORDER BY created_at,id').bind(operator).all<{ id: string; transport: string; tenant: string; subject: string; createdAt: string }>()).results;
    },
    async remove(id: string, operator: string) {
      return Boolean((await db.prepare("DELETE FROM chat_links WHERE id=? AND operator_id=? AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role='owner')").bind(id, operator, operator).run()).meta.changes);
    },
    async claimRequest(hash: string, now: number) {
      await db.prepare('DELETE FROM chat_requests WHERE expires_at<=?').bind(now).run();
      return Boolean((await db.prepare('INSERT OR IGNORE INTO chat_requests(hash,expires_at) VALUES(?,?)').bind(hash, now + 600_000).run()).meta.changes);
    },
    async preview(operator: string, incident: string, version: string, hash: string, expires: number) {
      await db.batch([
        db.prepare('DELETE FROM chat_previews WHERE operator_id=? AND incident_id=? OR expires_at<=?').bind(operator, incident, Date.now()),
        db.prepare('INSERT INTO chat_previews(hash,operator_id,incident_id,version,expires_at) VALUES(?,?,?,?,?)').bind(hash, operator, incident, version, expires),
      ]);
    },
    async consumePreview(operator: string, incident: string, version: string, hash: string, now: number) {
      return Boolean((await db.prepare('DELETE FROM chat_previews WHERE hash=? AND operator_id=? AND incident_id=? AND version=? AND expires_at>? RETURNING hash').bind(hash, operator, incident, version, now).first()));
    },
  };
}
export type ChatLinksRepository = ReturnType<typeof createChatLinksRepository>;
