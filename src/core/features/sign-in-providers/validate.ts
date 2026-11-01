import { SignInError, type PersonInput } from "./types";

const CONTROL = /[\x00-\x1f\x7f]/;

export const validClientId = (value: string) => value.length > 0 && value.length <= 512 && !CONTROL.test(value);
export const validSecret = (value: string) => value.length > 0 && value.length <= 4096;

/** The issuer an Okta domain names: a bare host becomes https://host, an https path such as /oauth2/default is kept,
 * and the trailing slash goes. Credentials, a query, a hash, whitespace and any scheme but https are refused. */
export function oktaIssuer(raw: string): string {
  const text = raw.trim();
  if (!text) throw new SignInError("domain_required", 400);
  if (/[\s\\?#@]/.test(text) || CONTROL.test(text) || text.length > 512) throw new SignInError("domain_invalid", 400);
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`); }
  catch { throw new SignInError("domain_invalid", 400); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.hostname.includes(".")) throw new SignInError("domain_invalid", 400);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** The text an owner sees in the Okta domain field: the issuer without its scheme. */
export const domainOf = (issuer: string | null) => issuer?.replace(/^https:\/\//, "") ?? "";

/** Each subject once (1-255 characters) and each operator once; the caller checks the operators exist. */
export function checkPeople(people: PersonInput[]): PersonInput[] {
  const subjects = new Set<string>(), operators = new Set<string>();
  const checked = people.map(person => {
    const subject = person.subject.trim();
    if (!person.operatorId || !subject || subject.length > 255 || CONTROL.test(subject)) throw new SignInError("person_invalid", 400);
    if (subjects.has(subject) || operators.has(person.operatorId)) throw new SignInError("duplicate_person", 400);
    subjects.add(subject); operators.add(person.operatorId);
    return { operatorId: person.operatorId, subject };
  });
  return checked;
}
