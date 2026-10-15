/// <reference path="../scripts/dev-ingress/virtual.d.ts" />
import { withDemo } from '../modules/demo/index.mjs';
import { seedDemo } from './demo';
export { SnapshotCache } from "./core/platform/blobs/snapshot-cache";
import { lampConfig } from "./ext/config";
import { createPageSettingsRepository } from "./core/features/page-settings/repository";
import { createSetupRepository } from "./core/features/setup/repository";
import { devGate, devNotFound } from "@runeditrun/rer/modules/operator-auth";
import { authConfig, authOrigin } from "./core/platform/auth/config";
import { authResponse } from "./core/platform/auth/http";
import start from "@tanstack/react-start/server-entry";

import { installedHomeResponse } from "./installed-home";
import { createHostDispatch, isDevelopmentAppPath, type LampSurface } from "./core/app/host-dispatch";
import { createApp } from "./core/app/server";
import { prepareAppMailBindings } from "./core/app/mail";
import { admitsDevelopmentRequest, DEV_OUTBOX_PATH, handleDevOutboxRequest } from "./core/features/dev-outbox";
import type { AppBindings } from "./core/app/types";
import { ensureDevelopmentSnapshot, runQueue, runScheduled } from "./core/app/worker-lifecycle";

function isHonoRequest(surface: LampSurface, request: Request, pathname: string) {
  if (surface === "page") return true;
  return pathname === "/setup/status"
    || (pathname === "/setup" && request.method !== "GET" && request.method !== "HEAD")
    || pathname === "/health"
    || pathname === "/api/app"
    || pathname.startsWith("/api/app/")
;
}

function isStartRequest(surface: LampSurface, request: Request, pathname: string) {
  if (surface !== "app") return false;
  if (pathname.startsWith("/_serverFn/")) return true;
  return (request.method === "GET" || request.method === "HEAD")
    && (pathname === "/signin" || pathname === "/setup" || pathname === "/app" || pathname.startsWith("/app/") || pathname === "/docs" || pathname.startsWith("/docs/"));
}

function isAppAssetRequest(surface: LampSurface, pathname: string) {
  return surface === "app" && (pathname.startsWith("/app-assets/") || pathname.startsWith("/brand/") || pathname === "/rer-theme.css" || (import.meta.env.DEV && isDevelopmentAppPath(pathname)));
}

function isOperatorDocument(request: Request, pathname: string) {
  return (request.method === "GET" || request.method === "HEAD")
    && (pathname === "/setup" || pathname === "/app" || pathname.startsWith("/app/"));
}

// Operator sign-in and the Lobby are bound to the configured https origin. A plain-http
// visit to the same host is sent there rather than failing Base's origin check.
function secureOperatorRedirect(request: Request, bindings: AppBindings, url: URL) {
  if (url.protocol !== "http:" || (request.method !== "GET" && request.method !== "HEAD")) return null;
  if (url.pathname !== "/" && url.pathname !== "/signin" && !url.pathname.startsWith("/auth/") && !isOperatorDocument(request, url.pathname)) return null;
  const origin = authOrigin(bindings);
  return origin === `https://${url.host}` ? Response.redirect(new URL(`${url.pathname}${url.search}`, origin), 301) : null;
}

async function operatorDocumentPreflight(request: Request, runtime: ReturnType<typeof createApp>) {
  const operator = await runtime.services.auth().getSession(request);
  if (operator) {
    // Until first-run setup is stored, every app document sends the owner to /setup.
    const pathname = new URL(request.url).pathname;
    const complete = await runtime.services.overview.setup.firstRunComplete();
    if (!complete && pathname !== "/setup") return Response.redirect(new URL("/setup", request.url), 302);
    if (complete && pathname === "/setup") return Response.redirect(new URL("/app", request.url), 302);
    return null;
  }

  const requested = new URL(request.url);
  const signIn = new URL("/signin", requested);
  signIn.searchParams.set("returnTo", `${requested.pathname}${requested.search}`);
  return Response.redirect(signIn, 302);
}

export default withDemo({
  async fetch(request: Request, bindings: AppBindings, executionContext: ExecutionContext): Promise<Response> {
    if (import.meta.env.DEV) {
      const { enabled, authenticate } = await import("virtual:lamp-dev-ingress");
      if (enabled) {
        const authenticated = await authenticate(request);
        if (!authenticated || !admitsDevelopmentRequest(bindings, authenticated)) {
          return new Response("Not found.", { status: 404, headers: { "Cache-Control": "no-store" } });
        }
        request = authenticated;
      }
      const config = authConfig(bindings);
      const gate = devGate({key:bindings.RER_DEV_KEY,origin:config.origin,local:config.local!});
      const exchange = await gate?.exchange(request);
      if (exchange) return exchange;
      // A tunnel or local proxy makes remote requests look local: the outbox
      // holds sign-in links, so it answers only a request holding the dev key.
      const { pathname } = new URL(request.url);
      if ((pathname === DEV_OUTBOX_PATH || pathname.startsWith(`${DEV_OUTBOX_PATH}/`)) && !(gate && await gate.admits(request))) return devNotFound();
      const outbox = await handleDevOutboxRequest(request, bindings.RER_DEMO === '1' ? { ...bindings, LAMP_DEV_OUTBOX: bindings.SNAPSHOTS, LAMP_BASE_MAIL: bindings.DB } : bindings, async () => (await createPageSettingsRepository(bindings.DB).get())?.pageName ?? lampConfig.pageName);
      if (outbox) return outbox;
    }
    const url = new URL(request.url);
    const surface = createHostDispatch(bindings).surfaceFor(request, { allowDevelopmentAssets: import.meta.env.DEV });
    if (!surface) return new Response("Not found.", { status: 404 });
    // The landing page's former address; old links follow it to the app host's home page for one release.
    if (surface === "app" && url.pathname === "/lamp") return Response.redirect(new URL(`/${url.search}`, url), 301);
    // The generated deployment's ASSETS binding owns emitted client files. In
    // development, the same binding serves Vite and Start's virtual modules.
    if (isAppAssetRequest(surface, url.pathname)) return bindings.ASSETS.fetch(request);
    if (surface === "app") {
      const secure = secureOperatorRedirect(request, bindings, url);
      if (secure) return secure;
      // The app host's / is the shared Lobby; /setup/state says whether the owner has claimed this installation.
      const home = await installedHomeResponse(request, bindings);
      if (home) return home;
    }

    const runtime = createApp(await prepareAppMailBindings(bindings, request), request);
    if (surface === "app" && (url.pathname === "/signin" || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/.well-known/rer-"))) {
      return authResponse(request, bindings, runtime.services);
    }
    await ensureDevelopmentSnapshot(runtime);
    // Managed readiness must publish pending initial state before traffic arrives;
    // preview environments do not run cron. This does not run scheduled mail work.
    if (url.pathname === "/health" && bindings.RER_INSTALLATION_ID) {
      try {
        if (await createSetupRepository(bindings.DB).pageConfigured()) await runtime.services.publicSnapshots.retryPendingBuild();
      } catch {
        return Response.json({ status: "unavailable", reason: "Public snapshot readiness failed." }, { status: 503 });
      }
    }

    if (isHonoRequest(surface, request, url.pathname)) return runtime.app.fetch(request, bindings, executionContext);
    if (isOperatorDocument(request, url.pathname)) {
      const rejected = await operatorDocumentPreflight(request, runtime);
      if (rejected) return rejected;
    }
    if (isStartRequest(surface, request, url.pathname)) {
      const response = await start.fetch(request);
      // Proxies must preserve the HTML React hydrates, including docs addresses.
      // Keep Start's existing cache policy and leave server-function data alone.
      if (!response.headers.get("content-type")?.includes("text/html")) return response;
      const headers = new Headers(response.headers);
      const cacheControl = headers.get("Cache-Control");
      if (!/(^|[\s,])no-transform($|[\s,])/i.test(cacheControl ?? "")) {
        headers.set("Cache-Control", cacheControl ? `${cacheControl}, no-transform` : "no-transform");
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return new Response("Not found.", { status: 404 });
  },
  async scheduled(event: ScheduledController, bindings: AppBindings, executionContext: ExecutionContext) {
    await runScheduled(bindings, executionContext, event.scheduledTime);
  },
  async queue(batch: MessageBatch<unknown>, bindings: AppBindings) {
    await runQueue(batch, bindings);
  },
} satisfies ExportedHandler<AppBindings>, { seed: seedDemo });
