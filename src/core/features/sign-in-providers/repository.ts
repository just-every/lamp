import { createUlid, nowIso } from "../../shared/ids";
import type { PersonInput, SignInProviderId, StoredPerson, StoredRegistration } from "./types";

export interface Candidate { id: string; displayName: string; email: string; status: string }
type Action = "saved" | "people-changed" | "disconnected";

/** All D1 access for the sign-in registrations. A change, the people it replaces and its audit row travel in one batch. */
export function createSignInRepository(db: D1Database) {
  const audit = (id: SignInProviderId, action: Action, actor: string, now: string) =>
    db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES(?,'sign-in',?,?,?,'{}',?,?)").bind(createUlid(), id, action, actor, now, now);
  const peopleStatements = (id: SignInProviderId, people: PersonInput[], now: string) => [
    db.prepare("DELETE FROM sign_in_people WHERE provider_id=?").bind(id),
    // Only a person who is still active or invited can be paired; an erased one is never matched.
    ...people.map(person => db.prepare("INSERT INTO sign_in_people(provider_id,subject,operator_id,created_at) SELECT ?,?,id,? FROM oa_operators WHERE id=? AND status IN ('active','invited')").bind(id, person.subject, now, person.operatorId)),
  ];
  return {
    async registrations() {
      return (await db.prepare("SELECT provider_id AS id,client_id AS clientId,issuer,sealed_secret AS sealedSecret,updated_at AS updatedAt FROM sign_in_providers ORDER BY provider_id").all<StoredRegistration>()).results;
    },
    /** Each pairing with the operator's current email, name and status: a pairing follows the person, never a copied address. */
    async people() {
      return (await db.prepare(`SELECT p.provider_id AS providerId,p.subject,p.operator_id AS operatorId,o.email,o.display_name AS displayName,o.status
        FROM sign_in_people p JOIN oa_operators o ON o.id=p.operator_id ORDER BY o.email,p.subject`).all<StoredPerson>()).results;
    },
    async candidates() {
      return (await db.prepare("SELECT id,display_name AS displayName,email,status FROM oa_operators WHERE status IN ('active','invited') ORDER BY email").all<Candidate>()).results;
    },
    /** Upsert the registration; a null `sealedSecret` keeps the stored one. `people` replaces the pairings when given. */
    async save(input: { id: SignInProviderId; clientId: string; issuer: string | null; sealedSecret: string | null }, people: PersonInput[] | null, actor: string) {
      const now = nowIso();
      await db.batch([
        db.prepare(`INSERT INTO sign_in_providers(provider_id,client_id,issuer,sealed_secret,created_at,updated_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(provider_id) DO UPDATE SET client_id=excluded.client_id,issuer=excluded.issuer,
          sealed_secret=COALESCE(excluded.sealed_secret,sign_in_providers.sealed_secret),updated_at=excluded.updated_at`).bind(input.id, input.clientId, input.issuer, input.sealedSecret, now, now),
        ...(people ? peopleStatements(input.id, people, now) : []),
        audit(input.id, "saved", actor, now),
      ]);
    },
    async replacePeople(id: SignInProviderId, people: PersonInput[], actor: string) {
      const now = nowIso();
      await db.batch([...peopleStatements(id, people, now), audit(id, "people-changed", actor, now)]);
    },
    async remove(id: SignInProviderId, actor: string) {
      const now = nowIso();
      await db.batch([
        db.prepare("DELETE FROM sign_in_people WHERE provider_id=?").bind(id),
        db.prepare("DELETE FROM sign_in_providers WHERE provider_id=?").bind(id),
        audit(id, "disconnected", actor, now),
      ]);
    },
  };
}
export type SignInRepository = ReturnType<typeof createSignInRepository>;
