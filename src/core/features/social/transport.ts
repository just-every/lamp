import type { TrustedTransport, WireRequest, WireResponse } from "../../../../modules/integrations/core/types.ts";
import { validateDestination } from "../../../../modules/integrations/core/destination.ts";

const MAX_BYTES = 64 * 1024;
const API_PATHS = new Set(["/2/tweets", "/xrpc/com.atproto.server.createSession", "/xrpc/com.atproto.repo.createRecord", "/api/v1/statuses"]);

/** The Worker's global_fetch_strictly_public rejects private DNS resolutions,
 * including rebinding. Validate literal hosts as well and never follow redirects.
 * A local receiver is available only in the development build. */
export function createSocialTransport(options: { developmentReceiver?: string } = {}): TrustedTransport {
  return {
    async send(request: WireRequest): Promise<WireResponse> {
      const destination = validateDestination(request.url);
      if (!API_PATHS.has(destination.pathname) || destination.search) throw new Error("social_destination_refused");
      if (new TextEncoder().encode(request.body).length > MAX_BYTES) throw new Error("social_request_limit");
      const receiver = import.meta.env?.DEV === true && options.developmentReceiver?.startsWith("http://127.0.0.1:") ? options.developmentReceiver : undefined;
      const target = receiver ? new URL(destination.pathname, receiver) : destination;
      const response = await fetch(target, { method: "POST", redirect: "manual", headers: request.headers, body: request.body, signal: AbortSignal.timeout(10_000) });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > MAX_BYTES) { await reader.cancel(); throw new Error("social_response_limit"); }
            chunks.push(chunk.value);
          }
        } finally { reader.releaseLock(); }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { status: response.status, headers: Object.fromEntries([...response.headers].map(([name, value]) => [name.toLowerCase(), value])), body: new TextDecoder().decode(bytes) };
    },
  };
}
