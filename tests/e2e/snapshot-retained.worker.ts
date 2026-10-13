import { createHostDispatch } from "../../src/core/app/host-dispatch";
import { exerciseRebuild } from "./snapshot-rebuild";
import { createHealthService } from "../../src/core/features/health/service";
import { registerHealthRoutes } from "../../src/core/features/health/routes";
import { Hono } from "hono";
import { createPublicSnapshotService } from "../../src/core/features/public-snapshot/service";
import { registerPublicSnapshotRoutes } from "../../src/core/features/public-snapshot/routes";
import { createRetainedSnapshotCache } from "../../src/core/platform/blobs/retained";
import { createR2BlobStore } from "../../src/core/platform/blobs/r2";
export { SnapshotCache } from "../../src/core/platform/blobs/snapshot-cache";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cache = createRetainedSnapshotCache(env);
    if (url.pathname === "/test/rebuild") return Response.json(await exerciseRebuild(env, await request.json()));
    if (url.pathname === "/test/retain") {
      try { await cache.write(await request.text()); return new Response(null, { status: 204 }); }
      catch { return new Response(null, { status: 400 }); }
    }
    if (url.pathname === "/test/source") {
      const input = await request.json();
      await env.SNAPSHOTS.put("snapshots/current.json", JSON.stringify(input.pointer));
      for (const artifact of input.artifacts) await env.SNAPSHOTS.put(`snapshots/${input.pointer.version}/${artifact.key}`, artifact.body, { httpMetadata: { contentType: artifact.contentType } });
      if (input.archive) await env.SNAPSHOTS.put(`snapshots/${input.pointer.version}/retained.json`, JSON.stringify(input.archive));
      return new Response(null, { status: 204 });
    }
    if (url.pathname !== "/health" && createHostDispatch({ LAMP_PAGE_HOST: "page.example", LAMP_APP_HOST: "app.example" }).surfaceFor(request) !== "page") return new Response("Not found", { status: 404 });
    // Fault injection lives exclusively in this test Worker. Fresh services on
    // every request ensure neither an isolate variable nor prior URL warms proof.
    const blobs = createR2BlobStore(env.SNAPSHOTS);
    const failing = new Proxy(blobs, { get(target, key) {
      if (url.searchParams.get("storage") === "down") return async () => { throw new Error("R2 unavailable"); };
      if (url.searchParams.get("storage") === "malformed" && key === "getText") return async () => ({ text: "{", eTag: "bad", contentType: "application/json" });
      return Reflect.get(target, key);
    } });
    const repository = new Proxy({}, { get() { throw new Error("PUBLIC READ TOUCHED D1"); } });
    const service = createPublicSnapshotService(repository, failing, undefined, undefined, undefined, cache);
    const app = new Hono();
    registerPublicSnapshotRoutes(app, service);
    registerHealthRoutes(app, createHealthService({ checkDatabase: async () => { throw new Error("D1 unavailable"); } }, {}));
    return app.fetch(request, env);
  },
};
