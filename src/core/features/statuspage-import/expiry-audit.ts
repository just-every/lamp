import type { D1Sql } from "../../../../modules/import-kit/src/d1/index.ts";
import { createUlid } from "../../shared/ids";

/** The scheduler is the actor for expiry. No address is copied into the log.
 * Put this selection immediately before its matching deletion in one batch. */
export function subscriberExpiryAudit(predicate: D1Sql, at: string): D1Sql {
  return {
    sql: `INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) SELECT ? || '/' || id,'subscriber',id,'expired',NULL,'{}',?,? FROM subscribers WHERE ${predicate.sql}`,
    params: [createUlid(), at, at, ...predicate.params ?? []],
  };
}
