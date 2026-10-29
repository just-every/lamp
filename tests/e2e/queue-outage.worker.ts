import { createApp } from "../../src/core/app/server";
import { createHostDispatch } from "../../src/core/app/host-dispatch";
import type { AppBindings } from "../../src/core/app/types";
export { SnapshotCache } from "../../src/core/platform/blobs/snapshot-cache";

let outage = false;
let attempts = 0;

export function queueBindings(env: AppBindings): AppBindings {
  return outage ? { ...env, JOBS: new Proxy(env.JOBS, {
      get(target, key) {
        if (key === "send") return async () => {
          attempts++;
          throw new Error("Test-injected Queue transport outage");
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) } : env;
}

export default {
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    // Only the Queue send boundary is replaced during the injected outage.
    // Healthy sends and every storage operation use the real Worker bindings.
    const bindings = queueBindings(env);
    if (url.hostname === env.LAMP_APP_HOST && url.pathname === "/test/queue") {
      if (request.method === "GET") return Response.json({ attempts });
      if (request.method === "PUT") {
        outage = (await request.json<{ outage: boolean }>()).outage;
        return new Response(null, { status: 204 });
      }
    }
    const runtime = createApp(bindings);
    if (url.hostname === env.LAMP_APP_HOST && url.pathname === "/test/rebuild" && request.method === "POST") {
      await runtime.services.publicSnapshots.rebuild();
      return new Response(null, { status: 204 });
    }
    if (!createHostDispatch(env).surfaceFor(request)) return new Response("Not found", { status: 404 });
    return runtime.app.fetch(request, bindings, context);
  },
};
