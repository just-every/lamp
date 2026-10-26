import { createApp } from "../../../src/core/app/server";
import { createHostDispatch } from "../../../src/core/app/host-dispatch";
import { runQueue, runScheduled } from "../../../src/core/app/worker-lifecycle";
import type { AppBindings } from "../../../src/core/app/types";
export { SnapshotCache } from "../../../src/core/platform/blobs/snapshot-cache";

export default {
  async fetch(request: Request, bindings: AppBindings, context: ExecutionContext) {
    if (!createHostDispatch(bindings).surfaceFor(request)) return new Response("Not found.", { status: 404 });
    // Miniflare's dispatch transport supplies its internal Host. Match the real
    // Worker request URL before Base verifies the installation's exact origin.
    const incoming = new Request(request);
    incoming.headers.set("Host", new URL(incoming.url).host);
    return createApp(bindings).app.fetch(incoming, bindings, context);
  },
  queue: runQueue,
  scheduled(controller: ScheduledController, bindings: AppBindings, context: ExecutionContext) {
    const observed = Object.create(context) as ExecutionContext;
    observed.waitUntil = promise => context.waitUntil(promise.catch(cause => {
      console.error("Restored Cron failed:", cause instanceof Error ? cause.message : "Unknown failure");
      throw cause;
    }));
    return runScheduled(bindings, observed, controller.scheduledTime);
  },
};
