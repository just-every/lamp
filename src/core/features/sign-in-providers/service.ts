import type { createLampAuth } from "../../platform/auth";
import { build, composeRegistration } from "./compose";
import { createSignInRepository } from "./repository";
import { openSecret, sealSecret } from "./sealing";
import { SignInError, type ComposedProvider, type PersonInput, type SignInProviderId, type SignInProviderView, type SignInStatus, type SignInStatusView, type StoredPerson, type StoredRegistration } from "./types";
import { checkPeople, domainOf, oktaIssuer, validClientId, validSecret } from "./validate";

type LampAuth = ReturnType<typeof createLampAuth>;
/** A provider the deploy file already configures; it wins over a stored registration with the same id. */
export interface DeployProvider { id: string; clientId?: string; issuer?: string }
export interface SignInOptions {
  webhookSecret: string | undefined;
  origin: string;
  unavailable: string | null;
  deploy: DeployProvider[];
  /** The auth composed from the stored registrations as they are now. */
  auth: (request: Request) => Promise<LampAuth>;
  /** An auth that would also compose these providers, to test a registration before it is written. */
  authWith: (stored: ComposedProvider[]) => LampAuth;
}

// Base's owner actions are POSTs. Lamp's own door is a PUT or DELETE (its body already read), so Base gets the same
// request, headers and all, as the POST it requires.
const asPost = (request: Request) => new Request(request.url, { method: "POST", headers: request.headers });

const IDS: SignInProviderId[] = ["google", "okta"];
// Okta's pins are the Okta org's issuer; Google's is fixed by Base.
const UNREACHABLE: Record<string, string> = { oidc_provider_unavailable: "provider_unreachable", oidc_issuer_mismatch: "issuer_mismatch", oidc_provider_unsupported: "provider_unsupported", oidc_untrusted_endpoint: "provider_unsupported" };
const failureOf = (error: unknown) => {
  const mapped = UNREACHABLE[(error as { code?: string })?.code ?? ""];
  return mapped ? new SignInError(mapped, 502) : error;
};

export function createSignInService(db: D1Database, options: SignInOptions) {
  const repository = createSignInRepository(db);
  const redirectUri = (id: SignInProviderId) => `${options.origin}/auth/oidc/${id}/callback`;
  const deployed = (id: string) => options.deploy.find(provider => provider.id === id);

  /** Base's providers for every stored registration that can be used. It never throws: an unusable row, or a
   * database that cannot be read, composes nothing, so /signin and email links keep working. */
  async function composed(): Promise<ComposedProvider[]> {
    try {
      const [rows, people] = await Promise.all([repository.registrations(), repository.people()]);
      const entries = await Promise.all(rows.map(row => composeRegistration(row, people, options.webhookSecret)));
      return entries.filter((entry): entry is ComposedProvider => entry !== null);
    } catch { return []; }
  }

  /** The current owner, or throws owner_required. */
  async function owner(request: Request, auth: LampAuth) { await auth.identitySettings(request); }

  async function guardWrite(request: Request, id: SignInProviderId) {
    const auth = await options.auth(request);
    await owner(request, auth);
    if (options.unavailable) throw new SignInError("outbound_unavailable", 409);
    if (deployed(id)) throw new SignInError("deploy_configured", 409);
    return auth;
  }

  async function operatorsFor(people: PersonInput[]) {
    const known = new Map((await repository.candidates()).map(candidate => [candidate.id, candidate]));
    return people.map(person => {
      const operator = known.get(person.operatorId);
      if (!operator) throw new SignInError("person_invalid", 400);
      return { subject: person.subject, email: operator.email, status: operator.status };
    });
  }

  const samePeople = (stored: StoredPerson[], next: PersonInput[]) =>
    stored.length === next.length && stored.every(person => next.some(candidate => candidate.operatorId === person.operatorId && candidate.subject === person.subject));

  async function storedSecret(row: StoredRegistration | undefined): Promise<string | null> {
    if (!row?.sealedSecret) return null;
    try { return await openSecret(row.sealedSecret, row.id, options.webhookSecret); } catch { return null; }
  }

  /** Save a registration: refuse before touching anything, test it against the provider through Base's own re-link
   * (fresh email proof, discovery and a new pin), and only then write it. */
  async function save(request: Request, actor: string, id: SignInProviderId, input: { clientId: string; clientSecret?: string; domain?: string; people?: PersonInput[] }) {
    await guardWrite(request, id);
    const issuer = id === "okta" ? oktaIssuer(input.domain ?? "") : null;
    const clientId = input.clientId.trim();
    if (!validClientId(clientId)) throw new SignInError("client_id_required", 400);
    const secret = input.clientSecret?.trim() || undefined;
    if (secret !== undefined && !validSecret(secret)) throw new SignInError("client_secret_required", 400);
    const people = id === "okta" ? checkPeople(input.people ?? []) : null;
    const known = people ? await operatorsFor(people) : [];
    const [rows, allPeople] = await Promise.all([repository.registrations(), repository.people()]);
    const row = rows.find(candidate => candidate.id === id);
    const kept = await storedSecret(row);
    const registrationChanged = !row || row.clientId !== clientId || row.issuer !== issuer;
    if ((registrationChanged || kept === null) && secret === undefined) throw new SignInError("client_secret_required", 400);
    const peopleChanged = people ? !samePeople(allPeople.filter(person => person.providerId === id), people) : false;
    if (!registrationChanged && secret === undefined && !peopleChanged) return;
    if (registrationChanged || secret !== undefined) {
      const entry = build(id, clientId, issuer, secret ?? kept!, known.map(person => ({ ...person })));
      if (!entry) throw new SignInError(id === "okta" ? "domain_invalid" : "client_id_required", 400);
      const others = (await composed()).filter(provider => provider.id !== id);
      try { await options.authWith([...others, entry]).relinkProvider(asPost(request), { provider: id }); }
      catch (error) { throw failureOf(error); }
      await repository.save({ id, clientId, issuer, sealedSecret: secret === undefined ? null : await seal(secret, id) }, people, actor);
      return;
    }
    // Only the people changed: the pin stays, but the change still needs fresh email proof.
    await (await options.auth(request)).requireStepUp(request, "providers:relink");
    await repository.replacePeople(id, people!, actor);
  }

  async function seal(secret: string, id: SignInProviderId) {
    try { return await sealSecret(secret, id, options.webhookSecret); }
    catch { throw new SignInError("sealing_unavailable", 503); }
  }

  async function savePeople(request: Request, actor: string, id: SignInProviderId, input: PersonInput[]) {
    const auth = await guardWrite(request, id);
    if (id !== "okta") throw new SignInError("not_found", 404);
    const row = (await repository.registrations()).find(candidate => candidate.id === id);
    if (!row) throw new SignInError("not_set_up", 404);
    const people = checkPeople(input);
    await operatorsFor(people);
    const stored = (await repository.people()).filter(person => person.providerId === id);
    if (samePeople(stored, people)) return;
    await auth.requireStepUp(request, "providers:relink");
    await repository.replacePeople(id, people, actor);
  }

  /** End the registration: unlink the pin (which signs its people out and lifts domain rules naming it), then delete. */
  async function disconnect(request: Request, actor: string, id: SignInProviderId) {
    const auth = await options.auth(request);
    await owner(request, auth);
    if (deployed(id)) throw new SignInError("deploy_configured", 409);
    const [rows, people] = await Promise.all([repository.registrations(), repository.people()]);
    const row = rows.find(candidate => candidate.id === id);
    if (!row) throw new SignInError("not_set_up", 404);
    // Base unlinks only a provider it can name. A row it cannot use (no secret after a restore) is named with a
    // stand-in secret that is never sent anywhere, so its pin and domain rules are still ended.
    const entry = await composeRegistration(row, people, options.webhookSecret) ?? build(id, row.clientId, row.issuer, "unlinking", people.filter(person => person.providerId === id));
    try { await (entry ? options.authWith([entry]) : auth).unlinkProvider(asPost(request), { provider: id }); }
    catch (error) { if ((error as { code?: string })?.code !== "oidc_not_linked") throw error; }
    await repository.remove(id, actor);
  }

  async function status(request: Request): Promise<SignInStatusView> {
    const auth = await options.auth(request);
    const canEdit = await auth.identitySettings(request).then(() => true, () => false);
    const [rows, people, links, usable, candidates, signInEnabled] = await Promise.all([
      repository.registrations(), repository.people(), auth.listProviders(request), composed(),
      canEdit ? repository.candidates() : Promise.resolve([]), Promise.resolve(auth.accounts.identityEnabled?.()).then(Boolean),
    ]);
    const confirmed = canEdit && !options.unavailable && await auth.requireStepUp(request, "providers:relink").then(() => true, () => false);
    const providers = IDS.map<SignInProviderView>(id => {
      const link = links.find(candidate => candidate.id === id);
      const healthy = (clientId: string | undefined, issuer: string | null | undefined) =>
        Boolean(link && link.status === "linked" && link.healthy && link.clientId === clientId && (issuer == null || link.issuer === issuer));
      const deploy = deployed(id);
      if (deploy) {
        return { id, source: "deploy", status: healthy(deploy.clientId, deploy.issuer) ? "working" : "not-tested", clientId: "", domain: "", secretSaved: true, redirectUri: redirectUri(id) };
      }
      const row = rows.find(candidate => candidate.id === id);
      if (!row) return { id, source: "none", status: "not-set-up", clientId: "", domain: "", secretSaved: false, redirectUri: redirectUri(id) };
      const entry = usable.find(candidate => candidate.id === id);
      const state: SignInStatus = !entry ? "needs-secret" : healthy(row.clientId, row.issuer) ? "working" : "not-tested";
      const paired = id === "okta" ? people.filter(person => person.providerId === id).map(person => ({ operatorId: person.operatorId, subject: person.subject, displayName: person.displayName, email: person.email })) : undefined;
      return { id, source: "app", status: state, clientId: row.clientId, domain: domainOf(row.issuer), secretSaved: Boolean(entry), redirectUri: redirectUri(id), ...(paired ? { people: paired } : {}) };
    });
    return { canEdit, confirmed, signInEnabled, unavailable: options.unavailable, providers, operators: candidates.map(({ id, displayName, email }) => ({ id, displayName, email })) };
  }

  return { composed, status, save, savePeople, disconnect };
}
export type SignInService = ReturnType<typeof createSignInService>;
