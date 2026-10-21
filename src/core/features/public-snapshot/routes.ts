import { aliasArtifactKey, isImportAliasPath, isLampPermalink } from "../statuspage-import/public-addresses";
import { isSorryHistoryMonthPath } from "../statuspage-import/public-paths.mjs";
import type { Context, Hono } from "hono";

import type { AppEnv } from "../../app/types";
import { escapeHtml } from "./format";
import { applyPublicIsolationHeaders } from "./headers";
import type { PublicSnapshotService } from "./service";
import { nativeApiArtifact } from "./native-api";

// Stable public URLs are selectors, not immutable artifacts. Revalidate the
// generation on every reuse; downstream stale-while-revalidate can otherwise
// hide a newly published pointer for longer than the publication guarantee.
// Bytes remain cacheable using the generation validator below. Outage retention
// is explicit in the DO/edge cache, where responses can be labelled stale.
const CACHE_CONTROL = "public, max-age=0, stale-if-error=3600";
const MAINTENANCE_OVERRUN_MS = 15 * 60_000;
function isMaintenanceOverrunning(state: string | null | undefined, endsAt: string | null | undefined, now: number) {
  const end = endsAt ? Date.parse(endsAt) : Number.NaN;
  return state === "In progress" && Number.isFinite(end) && end + MAINTENANCE_OVERRUN_MS <= now;
}
function applyPublicHeaders(headers: Headers, origin: string, cacheable = true) {
  if (cacheable) headers.set("Cache-Control", CACHE_CONTROL);
  applyPublicIsolationHeaders(headers, origin);
  // Public snapshot bytes contain no credentials or private data. Owner-browser
  // cutover checks must read the real redirect and final response across hosts.
  headers.set("Access-Control-Allow-Origin", "*");
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
    // response's generation-revalidation policy unchanged.
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
  headers.delete("ETag");
  headers.set("Warning", '110 - "Response is stale"');
  const contentType = headers.get("Content-Type") ?? "";
  if (contentType.includes("text/html")) {
    const body = (await cached.clone().text()).replace(/<body([^>]*)>/i, `<body$1><aside role="status" aria-live="polite" class="snapshot-stale">Last known state — content generated at ${headers.get("X-Lamp-Snapshot-Generated-At") ?? "unknown"}; current state could not be verified.</aside>`);
    return new Response(body, { status: cached.status, headers });
  }
  if (contentType.includes("atom+xml")) {
    const body = (await cached.clone().text()).replace(/<title>([^<]*)<\/title>/, `<title>$1</title><subtitle>Last known state — content generated at ${headers.get("X-Lamp-Snapshot-Generated-At") ?? "unknown"}; current state could not be verified.</subtitle>`);
    return new Response(body, { status: cached.status, headers });
  }
  if (contentType.includes("rss+xml")) {
    const body = (await cached.clone().text()).replace(/<description>[^<]*<\/description>/, `<description>Last known state — content generated at ${headers.get("X-Lamp-Snapshot-Generated-At") ?? "unknown"}; current state could not be verified.</description>`);
    return new Response(body, { status: cached.status, headers });
  }
  if (artifact === "status.json" && contentType.includes("application/json")) {
    const payload = JSON.parse(await cached.clone().text()) as Record<string, unknown>;
    return new Response(JSON.stringify({ ...payload, snapshotState: "stale" }), { status: cached.status, headers });
  }
  if ((artifact === "widget.js" || artifact === "embed/script.js") && contentType.includes("javascript")) {
    const body = `${await cached.clone().text()};(()=>{const n=document.currentScript?.nextElementSibling;if(n?.getAttribute('role')==='status'){const l=document.createElement('span');l.textContent=${JSON.stringify(` · Last known state — generated at ${headers.get('X-Lamp-Snapshot-Generated-At') ?? 'unknown'}`)};n.append(l)}})();`;
    return new Response(body, { status: cached.status, headers });
  }
  return new Response(cached.body, { status: cached.status, headers });
}

// Resolve installation routing when serving immutable HTML so local URLs keep
// their scheme/port and changing the configured app host needs no DB read.
function installedSignInUrl(context: Context<AppEnv>) {
  const target = new URL("/signin", context.req.url);
  // Match the host dispatcher's normalization of installation bindings.
  target.hostname = context.env.LAMP_APP_HOST.trim().toLowerCase();
  return target.href;
}

function installedSignIn(response: Response, context: Context<AppEnv>) {
  if (!response.headers.get("Content-Type")?.includes("text/html")) return response;
  const target = installedSignInUrl(context);
  const operatorLink = `<a data-lamp-signin href="${escapeHtml(target)}">Sign in</a>`;
  let signInSeen = false;
  return new HTMLRewriter()
    .on("body", {
      element(element) {
        element.onEndTag((endTag) => {
          if (signInSeen) return;
          endTag.before(`<footer>${operatorLink}</footer>`, { html: true });
          signInSeen = true;
        });
      },
    })
    .on("nav.status-utilities a", {
      element(element) {
        if (element.hasAttribute("data-lamp-signin") || element.getAttribute("href") === "/signin" || element.getAttribute("href") === target) element.remove();
      },
    })
    .on("footer", {
      element(element) {
        // Archived generations predate the footer link. Reuse a marked link
        // when present, or add the operator entry after the customer resources.
        element.onEndTag((endTag) => {
          if (signInSeen) return;
          endTag.before(` ${operatorLink}`, { html: true });
          signInSeen = true;
        });
      },
    })
    .on("footer a[data-lamp-signin]", {
      element(element) {
        if (signInSeen) return void element.remove();
        element.setAttribute("href", target);
        signInSeen = true;
      },
    }).transform(response);
}

function maintenanceOverrunState(html: string, now: number) {
  return [...html.matchAll(/<p class="maintenance-window"([^>]*)>/g)].map(([, attributes]) => {
    const state = attributes.match(/\bdata-maintenance-state="([^"]*)"/)?.[1];
    const endsAt = attributes.match(/\bdata-maintenance-ends-at="([^"]*)"/)?.[1];
    return isMaintenanceOverrunning(state, endsAt, now) ? "1" : "0";
  }).join("");
}

function currentMaintenanceOverruns(response: Response, now: number) {
  if (!response.headers.get("Content-Type")?.includes("text/html")) return response;
  return new HTMLRewriter()
    .on("p.maintenance-window[data-maintenance-state] span.overrun", { element(element) { element.remove(); } })
    .on("p.maintenance-window", {
      element(element) {
        const state = element.getAttribute("data-maintenance-state");
        const endsAt = element.getAttribute("data-maintenance-ends-at");
        if (!isMaintenanceOverrunning(state, endsAt, now)) return;
        element.onEndTag((endTag) => { endTag.before(' <span class="overrun">Running longer than planned</span>', { html: true }); });
      },
    }).transform(response);
}

export function registerPublicSnapshotRoutes(app: Hono<AppEnv>, service: PublicSnapshotService) {
  const serve = (artifact: (context: Context<AppEnv>) => string, download = false, missingArtifact?: string) => async (context: Context<AppEnv>) => {
    const cache = await caches.open("lamp-public-snapshot-fallback").catch(() => null);
    const cacheUrl = new URL(context.req.url);
    cacheUrl.search = ""; // Public artifacts do not vary by query parameters.
    if (cacheUrl.pathname.startsWith("/api/public/v1/")) cacheUrl.searchParams.set("artifact", artifact(context));
    const cacheRequest = new Request(cacheUrl, { method: "GET" });
    try {
      const object = await service.readArtifact(artifact(context));
      if (object) {
        const redirect = object.contentType === "application/vnd.lamp.redirect+json" ? JSON.parse(new TextDecoder().decode(object.bytes)).target : null;
        const path = new URL(context.req.url).pathname;
        const historyRedirect = (redirect === "/history/" && (path === "/history" || path === "/notices" || isSorryHistoryMonthPath(path)))
          // Previously retained Sorry snapshots used /history as canonical.
          || (redirect === "/history" && ["/notices", "/history/"].includes(path));
        if (redirect !== null && (typeof redirect !== "string" || !(isLampPermalink(redirect) || historyRedirect))) throw new Error("Invalid snapshot redirect.");
        let response = publicResponse(redirect ? "" : object.bytes, redirect ? "text/plain; charset=utf-8" : object.contentType, context.req.url, redirect ? 301 : 200, true, download);
        if (redirect) response.headers.set("Location", redirect);
        response.headers.set("X-Lamp-Snapshot-Generated-At", object.generatedAt);
        response.headers.set("X-Lamp-Snapshot-Version", object.version);
        const servedAt = Date.now();
        // HTML also varies with its serving-time action and full installed URL.
        // Version that transformation so an old validator cannot retain a
        // header sign-in link after an upgrade of the same stored artifact.
        const html = object.contentType.includes("text/html") ? new TextDecoder().decode(object.bytes) : "";
        const overrunState = object.contentType.includes("text/html") ? maintenanceOverrunState(html, servedAt) : "";
        const representation = object.contentType.includes("text/html")
          ? `installed-signin-footer-v3:${installedSignInUrl(context)}${overrunState.includes("1") ? `:maintenance-overrun-v1:${overrunState}` : ""}`
          : context.env?.LAMP_APP_HOST ?? "";
        const etag = `W/"${encodeURIComponent(object.version)}/${encodeURIComponent(artifact(context))}/${encodeURIComponent(representation)}"`;
        response.headers.set("ETag", etag);
        response = installedSignIn(response, context);
        response = currentMaintenanceOverruns(response, servedAt);
        if (object.retainedReady) response.headers.set("X-Lamp-Snapshot-Retained", "true");
        await cacheResponse(cache, cacheRequest, response);
        if (object.stale) return labelledStaleResponse(response, artifact(context));
        // Only a verified current generation can return 304. An outage must
        // deliver the stale-labelled body even if the visitor has these bytes.
        const validators = context.req.header("If-None-Match")?.split(",").map((value) => value.trim().replace(/^W\//, ""));
        if (response.status === 200 && validators?.some((value) => value === "*" || value === etag.replace(/^W\//, ""))) {
          return new Response(null, { status: 304, headers: response.headers });
        }
        return response;
      }
      if (missingArtifact) {
        const notFound = await service.readArtifact(missingArtifact);
        if (notFound) {
          const response = installedSignIn(publicResponse(notFound.bytes, notFound.contentType, context.req.url, 404), context);
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
        return labelledStaleResponse(currentMaintenanceOverruns(installedSignIn(cached, context), Date.now()), artifact(context));
      }
      return unavailable(context.req.url);
    }
  };

  app.get("*", async (context, next) => {
    const path = new URL(context.req.url).pathname;
    if (["/history.atom", "/history.rss"].includes(path)) return next();
    if (!isImportAliasPath(path)) return next();
    // Every valid Sorry month shares the retained collection redirect. Its
    // absence after undo yields 404, even for a month never previously visited.
    return serve(() => aliasArtifactKey(isSorryHistoryMonthPath(path) ? "/notices" : path), false, "not-found.html")(context);
  });
  app.get("/maintenance/:reference", serve((context) => `maintenance/${encodeURIComponent(context.req.param("reference") ?? "")}.html`, false, "not-found.html"));
  app.get("/", serve(() => "page.html"));
  app.get("/history/:month", serve(context => /^\d{4}-(?:0[1-9]|1[0-2])$/.test(context.req.param("month") ?? "") ? `history/${context.req.param("month")}.html` : "history/invalid.html", false, "not-found.html"));
  app.get("/history", serve(() => "history.html"));
  app.get("/incidents/:reference", serve((context) => `incidents/${encodeURIComponent(context.req.param("reference") ?? "")}.html`, false, "not-found.html"));
  app.get("/feed.atom", serve(() => "feed.atom"));
  app.get("/feed.rss", serve(() => "feed.rss"));
  app.get("/history.atom", serve(() => "history.atom"));
  app.get("/history.rss", serve(() => "history.rss"));
  app.get("/badge.svg", serve(() => "badge.svg"));
  app.get("/badge.json", serve(() => "badge.json"));
  for (const resource of ["feed.atom", "feed.rss", "badge.svg", "uptime.svg"]) {
    app.get(`/components/:slug/${resource}`, serve(context => `components/${encodeURIComponent(context.req.param("slug") ?? "")}/${resource}`));
  }
  app.get("/api/v2/*", serve(context => new URL(context.req.url).pathname.slice(1)));
  for (const path of ["/api/public/v1", "/api/public/v1/", "/api/public/v1/summary.json"]) app.get(path, serve(() => "api/public/v1/summary.json"));
  app.get("/api/public/v1/*", serve(context => nativeApiArtifact(new URL(context.req.url).pathname, context.req.query("cursor"))));
  app.get("/widget.js", serve(() => "widget.js"));
  app.get("/embed/script.js", serve(() => "embed/script.js"));
  app.get("/assets/status-page.css", serve(() => "assets/status-page.css"));
  app.get("/assets/status-page.js", serve(() => "assets/status-page.js"));
  // A chosen built-in template's own stylesheet and script; the default page never loads them.
  app.get("/assets/template.css", serve(() => "assets/template.css"));
  app.get("/assets/template.js", serve(() => "assets/template.js"));
  app.get("/assets/logo", serve(() => "assets/logo", true));
  app.get("/assets/favicon.svg", serve(() => "assets/favicon.svg"));
  app.get("/assets/mark.svg", serve(() => "assets/mark.svg"));
  app.get("/assets/og.svg", serve(() => "assets/og.svg"));
  app.get("/api/public/status", serve(() => "status.json"));
}
