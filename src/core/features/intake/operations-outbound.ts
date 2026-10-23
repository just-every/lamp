import { operationsCredentialsSchema, validateOperationsCredentials } from "./operations-credentials";

/** Fixed provider hosts; tenant discovery never carries the account credential. */
export async function operationsDestination(preset: "jsm" | "opsgenie", sealed: unknown, externalId: string) {
  const credentials = validateOperationsCredentials(preset, operationsCredentialsSchema.parse(sealed));
  if ("site" in credentials) {
    const tenant = await fetch(`${credentials.site}/_edge/tenant_info`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (!tenant.ok) { await tenant.body?.cancel(); throw new Error("Tenant discovery failed."); }
    const data = await tenant.json() as { cloudId?: unknown };
    if (typeof data.cloudId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(data.cloudId)) throw new Error("Tenant discovery returned no cloud ID.");
    const basic = btoa(String.fromCharCode(...new TextEncoder().encode(`${credentials.email}:${credentials.apiToken}`)));
    return { base: `https://api.atlassian.com/jsm/ops/api/${encodeURIComponent(data.cloudId)}/v1/alerts/${encodeURIComponent(externalId)}`,
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" } };
  }
  return { base: `${credentials.host}/v2/alerts/${encodeURIComponent(externalId)}`,
    headers: { Authorization: `GenieKey ${credentials.apiKey}`, "Content-Type": "application/json" } };
}
