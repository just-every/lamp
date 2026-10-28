import type { AppBindings } from "../../app/types";
import type { AppServices } from "../../app/services";
import type { AgentDoor, Person } from "../../../base/modules/agent-door/types.ts";
import { createAgentResourceRepository } from "./resources/repository";

interface Mutation { family: string; id?: string; event: string; createdField?: string }
interface Input { request: Request; bindings: AppBindings; services: AppServices; person: Person; door: AgentDoor }

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

/** Called after native session/Origin admission and before the native route.
 * The completion callback observes successful committed changes. It never
 * interprets agent input as a person act and does not write native records. */
export async function preparePersonMutation(input: Input): Promise<(response: Response) => Promise<void>> {
  const { request, bindings, person, door } = input;
  const repository = createAgentResourceRepository(bindings.DB);
  const mutation = describe(request, person.id);
  if (!mutation) return async () => {};
  if (mutation.family === "access" && mutation.id?.startsWith("credential:")) {
    mutation.id = await repository.tokenIssuer(mutation.id.slice("credential:".length)) ?? undefined;
    if (!mutation.id) return async () => {};
  }
  const before = mutation.id ? canonical(await repository.eventState(mutation.family, mutation.id)) : null;
  return async response => {
    if (!response.ok) return;
    let id = mutation.id;
    if (!id) {
      // These native creation routes return 201 only after inserting a new
      // record. Existing/no-op subscriber intake returns 200 and emits no create.
      if (response.status !== 201 || !mutation.createdField || !response.headers.get("content-type")?.includes("application/json")) return;
      const body: unknown = await response.clone().json().catch(() => null);
      const record = body && typeof body === "object" ? (body as Record<string, unknown>)[mutation.createdField] : null;
      const candidate = record && typeof record === "object" ? (record as Record<string, unknown>).id : null;
      if (typeof candidate !== "string" || !candidate || candidate.length > 256) return;
      id = candidate;
    }
    const after = canonical(await repository.eventState(mutation.family, id));
    if (after === "null" || after === before) return;
    await door.emit({ type: mutation.event, uri: `lamp://${mutation.family}/${encodeURIComponent(id)}`, person });
  };
}

function describe(request: Request, personId: string): Mutation | null {
  const method = request.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return null;
  let parts: string[];
  try { parts = new URL(request.url).pathname.split("/").filter(Boolean).map(decodeURIComponent); } catch { return null; }
  if (parts[0] !== "api" || parts[1] !== "app") return null;
  const path = parts.slice(2), family = path[0], id = path[1];
  const created = (name: string, field: string): Mutation => ({ family: name, event: `${name === "maintenance" ? "maintenance" : name.replace(/s$/, "")}.created`, createdField: field });
  if (["components", "maintenance", "metrics", "incidents"].includes(family) && path.length === 1 && method === "POST") {
    return created(family, ({ components: "component", maintenance: "maintenance", metrics: "metric", incidents: "incident" } as Record<string, string>)[family]);
  }
  if (family === "incidents" && id && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) {
    if (path.includes("preview") || path.includes("ai-suggestion")) return null;
    if (path[2] === "report") return { family: "reports", id, event: path[3] === "publish" ? "report.published" : "report.changed" };
    return { family, id, event: path[2] === "publish" ? "incident.published" : method === "DELETE" && path.length === 2 ? "incident.deleted" : "incident.changed" };
  }
  if (["components", "maintenance", "metrics"].includes(family) && id && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) {
    return { family, id, event: `${family === "maintenance" ? "maintenance" : family.replace(/s$/, "")}.${method === "DELETE" ? "deleted" : "changed"}` };
  }
  if (family === "page-settings") return { family: "page", id: "default", event: "page.changed" };
  if (family === "intake" && path[1] === "sources") {
    return path.length === 2 && method === "POST" ? created("intake", "source")
      : path[2] ? { family: "intake", id: path[2], event: "intake.source_changed" } : null;
  }
  if (family === "channels") {
    if (path.length === 1 && method === "POST") return created("channels", "channel");
    // A test is an external attempt without changing saved channel consent.
    if (path[2] === "test") return null;
    return id ? { family: "channels", id, event: method === "DELETE" ? "channel.removed" : "channel.changed" } : null;
  }
  if (family === "social") {
    if (path.length === 1 && method === "POST") return created("social", "account");
    return { family: "social", id: id ?? "default", event: "social.connection_changed" };
  }
  if (family === "subscribers") {
    if (path.length === 1 && method === "POST") return created("subscribers", "subscriber");
    return id && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id) ? { family: "subscribers", id, event: "subscriber.changed" } : null;
  }
  if (family === "operators") return { family: "access", id: id === "invite" ? "default" : id ?? "default", event: "access.person_changed" };
  if (family === "management-tokens") return { family: "access", id: id ? `credential:${id}` : personId, event: "access.credential_changed" };
  if (family === "chat-links" && method === "DELETE") return { family: "access", id: personId, event: "access.chat-link_changed" };
  return null;
}
