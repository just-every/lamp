import { z } from "zod";

export const operationsCredentialsSchema = z.union([
  z.object({ site: z.string().url().max(300), email: z.string().email().max(320), apiToken: z.string().min(1).max(2000) }).strict(),
  z.object({ host: z.enum(["https://api.opsgenie.com", "https://api.eu.opsgenie.com"]), apiKey: z.string().min(1).max(2000) }).strict(),
]);
export type OperationsCredentials = z.infer<typeof operationsCredentialsSchema>;

export function validateOperationsCredentials(preset: unknown, credentials: OperationsCredentials) {
  if (preset === "jsm" && "site" in credentials) {
    const site = new URL(credentials.site);
    if (site.protocol !== "https:" || site.username || site.password || site.port || site.search || site.hash || site.pathname !== "/"
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.atlassian\.net$/.test(site.hostname)) throw new Error("Use your HTTPS Atlassian site at name.atlassian.net, without a path.");
    return { ...credentials, site: site.origin };
  }
  if (preset === "opsgenie" && "host" in credentials) return credentials;
  throw new Error("The responder credentials must match the source preset.");
}
