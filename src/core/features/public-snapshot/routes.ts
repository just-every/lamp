import type { Context, Hono } from "hono";

import type { AppEnv } from "../../app/types";
import type { PublicSnapshotService } from "./service";

const CACHE_CONTROL = "public, max-age=10, s-maxage=10, stale-while-revalidate=30, stale-if-error=3600";
function applyPublicHeaders(headers: Headers, origin: string, cacheable = true) {
  if (cacheable) headers.set("Cache-Control", CACHE_CONTROL);
  headers.set("Content-Security-Policy", `default-src ${origin}; script-src ${origin}; style-src ${origin}; font-src 'self' data:; img-src ${origin}; connect-src ${origin}; form-action ${origin}; base-uri ${origin}; frame-ancestors 'none'; object-src 'none'`);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
}

function publicResponse(body: BodyInit, contentType: string, requestUrl: string, status = 200, cacheable = true, download = false) {
  const headers = new Headers({ "Content-Type": contentType });
  if (download) headers.set("Content-Disposition", "attachment");
  applyPublicHeaders(headers, new URL(requestUrl).origin, cacheable);
  return new Response(body, { status, headers });
}

function unavailable(requestUrl: string) {
  return publicResponse("The last known public status snapshot is unavailable. No current state is being inferred.", "text/plain; charset=utf-8", requestUrl, 503);
}

async function cacheResponse(cache: Cache | null, request: Request, response: Response) {
  if (!cache) return;
  try {
    const headers = new Headers(response.headers);
    // Cache API does not honour stale-if-error. Retain the immutable artifact
    // independently for the promised outage window while keeping the public
    // response's short cache policy unchanged.
    headers.set("Cache-Control", "public, max-age=3600");
    await cache.put(request, new Response(response.clone().body, { status: response.status, statusText: response.statusText, headers }));
  } catch {
    // The cache is an optional stale source. Its write availability must not
    // change the result of a successful immutable R2 snapshot read.
  }
}

async function labelledStaleResponse(cached: Response, artifact: string) {
  const headers = new Headers(cached.headers);
  headers.set("Cache-Control", CACHE_CONTROL);
  headers.set("X-Lamp-Snapshot-State", "stale");
  headers.set("Warning", '110 - "Response is stale"');
  const contentType = headers.get("Content-Type") ?? "";
  if (contentType.includes("text/html")) {
    const body = (await cached.clone().text()).replace(/<body([^>]*)>/i, `<body$1><aside role="status" aria-live="polite" style="margin:0;padding:10px 14px;background:#fff3e9;color:#6b3511;font:600 14px system-ui,sans-serif">Last known state — content generated at ${headers.get("X-Lamp-Snapshot-Generated-At") ?? "unknown"}; current state could not be verified.</aside>`);
    return new Response(body, { status: cached.status, headers });
  }
  if (contentType.includes("atom+xml")) {
    const body = (await cached.clone().text()).replace(/<title>([^<]*)<\/title>/, `<title>$1</title><subtitle>Last known state — content generated at ${headers.get("X-Lamp-Snapshot-Generated-At") ?? "unknown"}; current state could not be verified.</subtitle>`);
    return new Response(body, { status: cached.status, headers });
  }
  if (artifact === "status.json" && contentType.includes("application/json")) {
    const payload = JSON.parse(await cached.clone().text()) as Record<string, unknown>;
    return new Response(JSON.stringify({ ...payload, snapshotState: "stale" }), { status: cached.status, headers });
  }
  if (artifact === "widget.js" && contentType.includes("javascript")) {
    const body = `${await cached.clone().text()};(()=>{const n=document.currentScript?.nextElementSibling;if(n?.getAttribute('role')==='status'){const l=document.createElement('span');l.textContent=${JSON.stringify(` · Last known state — generated at ${headers.get('X-Lamp-Snapshot-Generated-At') ?? 'unknown'}`)};n.append(l)}})();`;
    return new Response(body, { status: cached.status, headers });
  }
  return new Response(cached.body, { status: cached.status, headers });
}

export function registerPublicSnapshotRoutes(app: Hono<AppEnv>, service: PublicSnapshotService) {
  const serve = (artifact: (context: Context<AppEnv>) => string, download = false, missingArtifact?: string) => async (context: Context<AppEnv>) => {
    const cache = await caches.open("lamp-public-snapshot-fallback").catch(() => null);
    const cacheUrl = new URL(context.req.url);
    cacheUrl.search = ""; // Public artifacts do not vary by query parameters.
    const cacheRequest = new Request(cacheUrl, { method: "GET" });
    try {
      const object = await service.readArtifact(artifact(context));
      if (object) {
        const response = publicResponse(object.bytes, object.contentType, context.req.url, 200, true, download);
        response.headers.set("X-Lamp-Snapshot-Generated-At", object.generatedAt);
        if (object.retainedReady) response.headers.set("X-Lamp-Snapshot-Retained", "true");
        await cacheResponse(cache, cacheRequest, response);
        return object.stale ? labelledStaleResponse(response, artifact(context)) : response;
      }
      if (missingArtifact) {
        const notFound = await service.readArtifact(missingArtifact);
        if (notFound) {
          const response = publicResponse(notFound.bytes, notFound.contentType, context.req.url, 404);
          response.headers.set("X-Lamp-Snapshot-Generated-At", notFound.generatedAt);
          if (notFound.retainedReady) response.headers.set("X-Lamp-Snapshot-Retained", "true");
          return notFound.stale ? labelledStaleResponse(response, missingArtifact) : response;
        }
      }
      const response = (await service.hasCurrentSnapshot())
        ? publicResponse("The requested public status artifact was not found.", "text/plain; charset=utf-8", context.req.url, 404)
        : unavailable(context.req.url);
      if (response.status === 200) await cacheResponse(cache, cacheRequest, response);
      return response;
    } catch {
      const cached = await cache?.match(cacheRequest).catch(() => undefined);
      if (cached) {
        return labelledStaleResponse(cached, artifact(context));
      }
      return unavailable(context.req.url);
    }
  };

  app.get("/", serve(() => "page.html"));
  app.get("/history", serve(() => "history.html"));
  app.get("/incidents/:reference", serve((context) => `incidents/${encodeURIComponent(context.req.param("reference") ?? "")}.html`, false, "not-found.html"));
  app.get("/feed.atom", serve(() => "feed.atom"));
  app.get("/widget.js", serve(() => "widget.js"));
  app.get("/assets/status-page.css", serve(() => "assets/status-page.css"));
  app.get("/assets/status-page.js", serve(() => "assets/status-page.js"));
  app.get("/assets/cartographic-map.svg", serve(() => "assets/cartographic-map.svg"));
  app.get("/assets/logo", serve(() => "assets/logo", true));
  app.get("/assets/favicon.svg", serve(() => "assets/favicon.svg"));
  app.get("/assets/og.svg", serve(() => "assets/og.svg"));
  app.get("/api/public/status", serve(() => "status.json"));
}
