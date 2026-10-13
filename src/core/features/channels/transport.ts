import type { TrustedTransport, WireRequest, WireResponse } from "../../../../modules/integrations/core/types.ts";
import { validateDestination } from "../../../../modules/integrations/core/destination.ts";

/** Only the providers' own webhook hosts are reachable, over public HTTPS with
 * no redirects, bounded in time and size. The Worker runs with
 * global_fetch_strictly_public, so a resolved private address is refused too. */
export function isChannelHost(kind: "slack" | "teams", hostname: string) {
  const host = hostname.toLowerCase();
  if (kind === "slack") return host === "hooks.slack.com";
  return host.endsWith(".webhook.office.com") || host.endsWith(".logic.azure.com") || host.endsWith(".environment.api.powerplatform.com");
}

export function createChannelTransport(options: { developmentReceiver?: string } = {}): TrustedTransport {
  return {
    async send(request: WireRequest): Promise<WireResponse> {
      const destination = validateDestination(request.url);
      if (!isChannelHost("slack", destination.hostname) && !isChannelHost("teams", destination.hostname)) throw new Error("channel_destination_refused");
      if (new TextEncoder().encode(request.body).length > 64 * 1024) throw new Error("channel_request_limit");
      // Local development only: a loopback receiver stands in for the provider, keeping its path.
      const target = import.meta.env?.DEV === true && options.developmentReceiver ? new URL(`${destination.pathname}${destination.search}`, options.developmentReceiver) : destination;
      const response = await fetch(target, { method: "POST", redirect: "manual", headers: request.headers, body: request.body, signal: AbortSignal.timeout(10_000) });
      const body = (await response.text()).slice(0, 64 * 1024);
      return { status: response.status, headers: Object.fromEntries([...response.headers].map(([name, value]) => [name.toLowerCase(), value])), body };
    },
  };
}
