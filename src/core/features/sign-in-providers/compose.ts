import { normalizeEmail } from "@runeditrun/rer/modules/operator-auth";
import { openSecret } from "./sealing";
import type { ComposedProvider, StoredPerson, StoredRegistration } from "./types";
import { oktaIssuer, validClientId, validSecret } from "./validate";

/** Base's provider entry for one stored registration, or null when it cannot be used: no secret, a ciphertext the
 * current key cannot open, or values Base would refuse (a refused entry makes every /auth request fail). */
export async function composeRegistration(row: StoredRegistration, people: StoredPerson[], webhookSecret: string | undefined): Promise<ComposedProvider | null> {
  if (!row.sealedSecret) return null;
  let clientSecret: string;
  try { clientSecret = await openSecret(row.sealedSecret, row.id, webhookSecret); } catch { return null; }
  return build(row.id, row.clientId, row.issuer, clientSecret, people.filter(person => person.providerId === row.id));
}

/** The entry for values already in hand: a registration about to be saved. Null when they fail validation. */
export function build(id: ComposedProvider["id"], clientId: string, issuer: string | null, clientSecret: string, people: Array<Pick<StoredPerson, "subject" | "email" | "status">>): ComposedProvider | null {
  if (!validClientId(clientId) || !validSecret(clientSecret)) return null;
  const base = { id, preset: id, clientId, tokenAuthMethod: "client_secret_basic" as const, clientSecret };
  if (id === "google") return base;
  try {
    if (!issuer || oktaIssuer(issuer) !== issuer) return null;
  } catch { return null; }
  // Okta admits only the people paired here, each at their current email, while they are active or invited.
  const subjectEmails: Record<string, string> = {};
  for (const person of people) {
    if (!["active", "invited"].includes(person.status)) continue;
    try { subjectEmails[person.subject] = normalizeEmail(person.email); } catch { /* an unusable email pairs nobody */ }
  }
  return { ...base, issuer, subjectEmails };
}
