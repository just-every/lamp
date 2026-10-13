import type { DeliveryProtocol, Outcome, WireResponse } from "../../../../modules/integrations/core/types.ts";
import { validateDestination } from "../../../../modules/integrations/core/destination.ts";
import { isChannelHost } from "./transport";

export const TEAMS_WEBHOOK_PROTOCOL = "teams.incoming-webhook.v1";

/** A Teams channel's incoming webhook (a Workflows "post to a channel when a
 * webhook request is received" URL, or a legacy connector URL) receives an
 * Adaptive Card message. */
export function createTeamsProtocol(resolveDestination: (destinationId: string) => Promise<string>): DeliveryProtocol {
  return {
    id: TEAMS_WEBHOOK_PROTOCOL,
    async prepare(envelope) {
      if (envelope.protocol !== TEAMS_WEBHOOK_PROTOCOL) throw new Error("Wrong Teams protocol");
      JSON.parse(envelope.body);
      let url: URL;
      try { url = validateDestination(await resolveDestination(envelope.destinationId)); } catch { throw new Error("Teams webhook configuration unavailable or invalid"); }
      if (!isChannelHost("teams", url.hostname)) throw new Error("Teams webhook configuration unavailable or invalid");
      return { url: url.href, headers: { "content-type": "application/json; charset=utf-8" }, body: envelope.body };
    },
    classify(response: WireResponse): Outcome {
      if (response.status >= 200 && response.status < 300) return { kind: "accepted", code: "teams_accepted", status: response.status };
      if (response.status === 429) {
        const seconds = Number(response.headers["retry-after"]);
        return Number.isInteger(seconds) && seconds > 0 && seconds <= 86_400 ? { kind: "retryable", code: "teams_rate_limited", status: 429, retryAfterMs: seconds * 1000 } : { kind: "rejected", code: "teams_rate_limit_invalid_delay", status: 429 };
      }
      if (response.status >= 500) return { kind: "retryable", code: "teams_server_error", status: response.status };
      if ([400, 401, 403, 404, 410, 413].includes(response.status)) return { kind: "rejected", code: "teams_rejected", status: response.status };
      return { kind: "uncertain", code: "teams_unknown_response", status: response.status };
    },
  };
}
