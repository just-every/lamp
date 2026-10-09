/// <reference path="../scripts/dev-ingress/virtual.d.ts" />
export { SnapshotCache } from "./core/platform/blobs/snapshot-cache";
import { createBootstrapRepository } from "./core/features/bootstrap/repository";
import start from "@tanstack/react-start/server-entry";

import { createHostDispatch, isDevelopmentAppPath, type LampSurface } from "./core/app/host-dispatch";
import { createApp } from "./core/app/server";
import { prepareAppMailBindings } from "./core/app/mail";
import { canUseDevelopmentMail, handleDevOutboxRequest } from "./core/features/dev-outbox";
import { readOperatorSessionId } from "./core/features/session";
import type { AppBindings } from "./core/app/types";
import { ensureDevelopmentSnapshot, runQueue, runScheduled } from "./core/app/worker-lifecycle";

function isHonoRequest(surface: LampSurface, pathname: string) {
  if (surface === "page") return true;
  return pathname === "/setup/status"
    || pathname === "/setup"
    || pathname === "/health"
    || pathname === "/api/app"
    || pathname.startsWith("/api/app/")
    || pathname === "/signin/config"
    || pathname === "/signin/request"
    || pathname.startsWith("/signin/complete/");
}

function isStartRequest(surface: LampSurface, request: Request, pathname: string) {
  if (surface !== "app") return false;
  if (pathname.startsWith("/_serverFn/")) return true;
  return (request.method === "GET" || request.method === "HEAD")
    && (pathname === "/signin" || pathname === "/app" || pathname.startsWith("/app/"));
}

function isAppAssetRequest(surface: LampSurface, pathname: string) {
  return surface === "app" && (pathname.startsWith("/app-assets/") || (import.meta.env.DEV && isDevelopmentAppPath(pathname)));
}

function isOperatorDocument(request: Request, pathname: string) {
  return (request.method === "GET" || request.method === "HEAD")
    && (pathname === "/app" || pathname.startsWith("/app/"));
}

async function operatorDocumentPreflight(request: Request, runtime: ReturnType<typeof createApp>) {
  const sessionId = readOperatorSessionId(request.headers.get("Cookie") ?? undefined);
  const operator = sessionId ? await runtime.services.session.getActiveOperator(sessionId) : null;
  if (operator) return null;

  const requested = new URL(request.url);
  const signIn = new URL("/signin", requested);
  signIn.searchParams.set("returnTo", `${requested.pathname}${requested.search}`);
  return Response.redirect(signIn, 302);
}

export default {
  async fetch(request: Request, bindings: AppBindings, executionContext: ExecutionContext): Promise<Response> {
    if (import.meta.env.DEV) {
      const { enabled, authenticate } = await import("virtual:lamp-dev-ingress");
      if (enabled) {
        const authenticated = await authenticate(request);
        if (!authenticated || !canUseDevelopmentMail(bindings, authenticated)) {
          return new Response("Not found.", { status: 404, headers: { "Cache-Control": "no-store" } });
        }
        request = authenticated;
      }
      const outbox = await handleDevOutboxRequest(request, bindings);
      if (outbox) return outbox;
    }
    const url = new URL(request.url);
    const surface = createHostDispatch(bindings).surfaceFor(request, { allowDevelopmentAssets: import.meta.env.DEV });
    if (!surface) return new Response("Not found.", { status: 404 });
    // The generated deployment's ASSETS binding owns emitted client files. In
    // development, the same binding serves Vite and Start's virtual modules.
    if (isAppAssetRequest(surface, url.pathname)) return bindings.ASSETS.fetch(request);

    const runtime = createApp(await prepareAppMailBindings(bindings, request), request);
    await ensureDevelopmentSnapshot(runtime);
    // Managed readiness must publish pending initial state before traffic arrives;
    // preview environments do not run cron. This does not run scheduled mail work.
    if (url.pathname === "/health" && bindings.RER_INSTALLATION_ID) {
      try {
        if (await createBootstrapRepository(bindings.DB).initialized()) await runtime.services.publicSnapshots.retryPendingBuild();
      } catch {
        return Response.json({ status: "unavailable", reason: "Public snapshot readiness failed." }, { status: 503 });
      }
    }

    if (isHonoRequest(surface, url.pathname)) return runtime.app.fetch(request, bindings, executionContext);
    if (isOperatorDocument(request, url.pathname)) {
      const rejected = await operatorDocumentPreflight(request, runtime);
      if (rejected) return rejected;
    }
    if (isStartRequest(surface, request, url.pathname)) return start.fetch(request);
    return new Response("Not found.", { status: 404 });
  },
  async scheduled(_event: ScheduledController, bindings: AppBindings, executionContext: ExecutionContext) {
    await runScheduled(bindings, executionContext);
  },
  async queue(batch: MessageBatch<unknown>, bindings: AppBindings) {
    await runQueue(batch, bindings);
  },
} satisfies ExportedHandler<AppBindings>;
