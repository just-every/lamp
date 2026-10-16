import { createApp } from "../../src/core/app/server";
import { runScheduled } from "../../src/core/app/worker-lifecycle";
import { queueDueWork } from "../../src/core/app/request-work";
import type { AppBindings } from "../../src/core/app/types";
export { SnapshotCache } from "../../src/core/platform/blobs/snapshot-cache";

// The app's Hono door as src/server.ts serves it, plus a door for the Cron handler.
export default {
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    request = new Request(request);
    request.headers.set("Host", new URL(request.url).host);
    if (new URL(request.url).pathname === "/__test/cron") {
      await runScheduled(env, context);
      return new Response(null, { status: 204 });
    }
    const runtime = createApp(env, request);
    const response = await runtime.app.fetch(request, env, context);
    queueDueWork(runtime, env, context, request, response);
    return response;
  },
};
