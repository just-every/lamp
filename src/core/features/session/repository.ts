import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import { operators, sessions } from "../../shared/schema";
import { operatorMagicLinks } from "./schema";

export interface StoredOperator {
  id: string;
  email: string;
  displayName: string;
  isSetupOperator: boolean;
}

export interface StoredFormerOperator extends StoredOperator {
  deactivatedAt: string;
}

export type StoredMagicLink = typeof operatorMagicLinks.$inferSelect;

export interface SessionRepository {
  findActiveOperator(sessionId: string, now: string): Promise<StoredOperator | null>;
  touchSession(sessionId: string, expiresAt: string, updatedAt: string): Promise<void>;
  findOperatorByEmail(email: string): Promise<StoredOperator | null>;
  findOperator(operatorId: string): Promise<StoredOperator | null>;
  findOperatorIncludingDeactivated(operatorId: string): Promise<StoredOperator | null>;
  listOperators(): Promise<StoredOperator[]>;
  listFormerOperators(): Promise<StoredFormerOperator[]>;
  insertOperator(operator: StoredOperator & { createdAt: string; updatedAt: string }): Promise<void>;
  revokeOperatorAccess(input: { operatorId: string; requestedByOperatorId: string; revokedAt: string; auditId: string }): Promise<boolean>;
  eraseOperator(input: { operatorId: string; originalEmail: string; erasedEmail: string; erasedAt: string; auditId: string; requestedByOperatorId: string }): Promise<boolean>;
  insertSession(session: { id: string; operatorId: string; expiresAt: string; createdAt: string; updatedAt: string }): Promise<void>;
  revokeSession(sessionId: string): Promise<void>;
  insertMagicLink(input: typeof operatorMagicLinks.$inferInsert): Promise<void>;
  findUsableMagicLink(tokenHash: string, now: string): Promise<StoredMagicLink | null>;
  consumeMagicLink(id: string, now: string): Promise<boolean>;
  revokeMagicLink(id: string, now: string): Promise<void>;
}

const erasedOperatorDisplayName = "Erased operator";

export function erasedOperatorEmail(operatorId: string) {
  return `deleted-${operatorId.toLowerCase()}@operator.invalid`;
}

export function createSessionRepository(binding: D1Database): SessionRepository {
  const database = createDatabase(binding);
  const storedOperator = { id: operators.id, email: operators.email, displayName: operators.displayName, isSetupOperator: operators.isSetupOperator };

  return {
    async findActiveOperator(sessionId, now) {
      const result = await database.select(storedOperator).from(sessions).innerJoin(operators, eq(sessions.operatorId, operators.id)).where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now), isNull(operators.deactivatedAt))).get();
      return result ?? null;
    },
    async touchSession(sessionId, expiresAt, updatedAt) {
      await database.update(sessions).set({ expiresAt, updatedAt }).where(eq(sessions.id, sessionId));
    },
    async findOperatorByEmail(email) {
      const operator = await database.select(storedOperator).from(operators).where(and(eq(operators.email, email), isNull(operators.deactivatedAt))).get();
      return operator ?? null;
    },
    async findOperator(operatorId) {
      const operator = await database.select(storedOperator).from(operators).where(and(eq(operators.id, operatorId), isNull(operators.deactivatedAt))).get();
      return operator ?? null;
    },
    async findOperatorIncludingDeactivated(operatorId) {
      const operator = await database.select(storedOperator).from(operators).where(eq(operators.id, operatorId)).get();
      return operator ?? null;
    },
    async listOperators() {
      return database.select(storedOperator).from(operators).where(isNull(operators.deactivatedAt)).orderBy(asc(operators.email)).all();
    },
    async listFormerOperators() {
      const erasedEmail = sql<string>`'deleted-' || lower(${operators.id}) || '@operator.invalid'`;
      return database.select({ ...storedOperator, deactivatedAt: operators.deactivatedAt }).from(operators).where(and(isNotNull(operators.deactivatedAt), sql`${operators.email} <> ${erasedEmail}`)).orderBy(asc(operators.email)).all() as Promise<StoredFormerOperator[]>;
    },
    async insertOperator(operator) {
      await database.insert(operators).values(operator).onConflictDoUpdate({ target: operators.email, set: { displayName: operator.displayName, deactivatedAt: null, updatedAt: operator.updatedAt } });
    },
    async revokeOperatorAccess({ operatorId, requestedByOperatorId, revokedAt, auditId }) {
      const results = await binding.batch([
        binding.prepare("UPDATE operators SET deactivated_at = ?, updated_at = ? WHERE id = ? AND deactivated_at IS NULL").bind(revokedAt, revokedAt, operatorId),
        binding.prepare("INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at) SELECT ?, 'operator', ?, 'access-revoked', ?, '{}', ?, ? WHERE changes() = 1").bind(auditId, operatorId, requestedByOperatorId, revokedAt, revokedAt),
        binding.prepare("DELETE FROM sessions WHERE operator_id = ?").bind(operatorId),
        binding.prepare("UPDATE operator_magic_links SET revoked_at = ?, updated_at = ? WHERE operator_id = ? AND revoked_at IS NULL").bind(revokedAt, revokedAt, operatorId),
      ]);
      return results[0]?.meta.changes === 1;
    },
    async eraseOperator({ operatorId, originalEmail, erasedEmail, erasedAt, auditId, requestedByOperatorId }) {
      const results = await binding.batch([
        binding.prepare("UPDATE operators SET email = ?, display_name = ?, deactivated_at = COALESCE(deactivated_at, ?), updated_at = ? WHERE id = ? AND email <> ?").bind(erasedEmail, erasedOperatorDisplayName, erasedAt, erasedAt, operatorId, erasedEmail),
        binding.prepare("INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at) SELECT ?, 'operator', ?, 'deleted', ?, '{}', ?, ? WHERE changes() = 1").bind(auditId, operatorId, requestedByOperatorId, erasedAt, erasedAt),
        binding.prepare("UPDATE audit_entries SET reason = NULL, payload_json = '{}', updated_at = ? WHERE entity_type = 'operator' AND entity_id = ?").bind(erasedAt, operatorId),
        binding.prepare("DELETE FROM sessions WHERE operator_id = ?").bind(operatorId),
        binding.prepare("DELETE FROM operator_magic_links WHERE operator_id = ? OR email = ?").bind(operatorId, originalEmail),
      ]);
      return results[0]?.meta.changes === 1;
    },
    async insertSession(session) {
      await database.insert(sessions).values(session).onConflictDoNothing();
    },
    async revokeSession(sessionId) {
      await database.delete(sessions).where(eq(sessions.id, sessionId));
    },
    async insertMagicLink(input) {
      await database.insert(operatorMagicLinks).values(input);
    },
    async findUsableMagicLink(tokenHash, now) {
      const link = await database.select().from(operatorMagicLinks).where(and(eq(operatorMagicLinks.tokenHash, tokenHash), gt(operatorMagicLinks.expiresAt, now), isNull(operatorMagicLinks.consumedAt), isNull(operatorMagicLinks.revokedAt))).get();
      return link ?? null;
    },
    async consumeMagicLink(id, now) {
      const result = await database.update(operatorMagicLinks).set({ consumedAt: now, updatedAt: now }).where(and(eq(operatorMagicLinks.id, id), isNull(operatorMagicLinks.consumedAt), isNull(operatorMagicLinks.revokedAt)));
      return result.meta.changes === 1;
    },
    async revokeMagicLink(id, now) {
      await database.update(operatorMagicLinks).set({ revokedAt: now, updatedAt: now }).where(eq(operatorMagicLinks.id, id));
    },
  };
}
