import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const generatedAt = "2026-09-13T00:00:00.000Z";
function bundle(generation) {
  return { version: `v${generation}`, generation, generatedAt, artifacts: [
    { key: "page.html", contentType: "text/html", body: `<html><body>Degraded v${generation}</body></html>` },
    { key: "feed.atom", contentType: "application/atom+xml", body: `<feed><title>Degraded v${generation}</title><updated>${generatedAt}</updated></feed>` },
    { key: "widget.js", contentType: "application/javascript", body: `/* Degraded v${generation} */` },
    { key: "status.json", contentType: "application/json", body: JSON.stringify({ overall: "degraded", generation, generatedAt }) },
  ] };
}
test("PAGE-005 PAGE-006 PAGE-007 cold durable replica keeps complete generations through R2 failure without D1 reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lamp-retained-"));
  const output = join(directory, "worker.js");
  await build({ entryPoints: ["tests/e2e/snapshot-retained.worker.ts"], outfile: output, bundle: true, format: "esm", platform: "browser", external: ["cloudflare:workers"], plugins: [{ name: "vite-assets", setup(builder) {
    builder.onResolve({ filter: /\?(inline|raw)$/ }, args => ({ path: resolve(args.resolveDir, args.path.split("?")[0]), namespace: args.path.endsWith("?raw") ? "raw" : "inline" }));
    builder.onLoad({ filter: /.*/, namespace: "raw" }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, "utf8"))}`, loader: "js" }));
    builder.onLoad({ filter: /.*/, namespace: "inline" }, async args => ({ contents: `export default ${JSON.stringify("data:application/octet-stream;base64," + (await readFile(args.path)).toString("base64"))}`, loader: "js" }));
  } }] });
  const options = { bindings: { LAMP_APP_HOST: "app.example" }, name: "lamp-retained-test", resourcePersistencePath: join(directory, "storage"), modules: true, script: await readFile(output, "utf8"), compatibilityDate: "2026-09-08", compatibilityFlags: ["nodejs_compat"], durableObjects: { SNAPSHOT_CACHE: { className: "SnapshotCache", useSQLite: true } }, r2Buckets: ["SNAPSHOTS"] };
  let runtime = new Miniflare(convertV4MiniflareOptions(options));
  const fetch = (path, init) => runtime.dispatchFetch(`https://page.example${path}`, init);
  try {
    assert.equal((await fetch("/?storage=down&first=1")).status, 503);
    const firstFailure = await (await fetch("/test/rebuild", { method: "POST", body: JSON.stringify({ generation: 0, replicaFailure: "always" }) })).json();
    assert.match(firstFailure.failure, /replica PUT failure/);
    assert.equal(firstFailure.pointer, null);
    assert.equal(firstFailure.replica, null);
    assert.equal(firstFailure.pointerWrites, 0);
    assert.equal(firstFailure.completed, false);
    assert.equal((await fetch("/?storage=down&firstFailure=1")).status, 503);

    assert.equal((await fetch("/test/retain", { method: "PUT", body: JSON.stringify(bundle(1)) })).status, 204);
    // A prior absent lookup must not be negatively cached after first publication.
    assert.equal((await fetch("/?storage=down&first=2")).status, 200);
    await runtime.dispose(); runtime = new Miniflare(convertV4MiniflareOptions(options));
    for (const path of ["/", "/feed.atom", "/widget.js", "/api/public/status"]) {
      const response = await fetch(`${path}?storage=down&neverSeen=${Math.random()}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Lamp-Snapshot-State"), "stale");
      assert.equal(response.headers.get("X-Lamp-Snapshot-Generated-At"), generatedAt);
      assert.match(await response.text(), /Last known state|"snapshotState":"stale"/);
    }
    assert.equal((await fetch("/?storage=malformed")).status, 200);
    assert.equal((await fetch("/health?storage=down")).status, 503);
    assert.equal((await fetch("/test/retain", { method: "PUT", body: JSON.stringify({ ...bundle(2), artifacts: [] }) })).status, 400);
    assert.match(await (await fetch("/?storage=down")).text(), /Degraded v1/);
    const unicode = bundle(3);
    unicode.artifacts[0].body = `<body>Degraded v3 ${"🌊".repeat(20000)}</body>`;
    await fetch("/test/retain", { method: "PUT", body: JSON.stringify(unicode) });
    await fetch("/test/retain", { method: "PUT", body: JSON.stringify(bundle(2)) });
    const unicodeResponse = await (await fetch("/?storage=down")).text();
    assert.match(unicodeResponse, /Degraded v3/);
    assert.ok(unicodeResponse.includes("🌊".repeat(20000)), "chunk boundaries preserve exact UTF-8");
    await fetch("/test/source", { method: "POST", body: JSON.stringify({ pointer: { version: "v4", generation: 4, sourceRevision: 4, generatedAt }, artifacts: bundle(4).artifacts }) });
    const current = await fetch("/?query=irrelevant");
    assert.equal(current.status, 200); assert.equal(current.headers.get("X-Lamp-Snapshot-State"), null);
    assert.match(await current.text(), /Degraded v4/);
    await fetch("/test/source", { method: "POST", body: JSON.stringify({ pointer: { version: "v5", generation: 5, sourceRevision: 5, generatedAt }, artifacts: bundle(5).artifacts, archive: bundle(5) }) });
    const cacheWriteFailure = await fetch("/feed.atom?cacheWrites=down");
    assert.equal(cacheWriteFailure.status, 200);
    assert.equal(cacheWriteFailure.headers.get("X-Lamp-Snapshot-State"), null);
    assert.match(await cacheWriteFailure.text(), /Degraded v5/);
    const restored = await fetch("/?restored=1");
    assert.equal(restored.headers.get("X-Lamp-Snapshot-Retained"), "true", "restored R2 bundle primes the replica before acceptance");
    // Both primary storage and the durable replica fail: the independently
    // warmed edge fallback still returns labelled bytes, even conditionally.
    const validator = restored.headers.get("etag");
    const edgeOnly = await fetch("/?storage=down&replica=down", { headers: { "If-None-Match": validator } });
    assert.equal(edgeOnly.status, 200);
    assert.equal(edgeOnly.headers.get("X-Lamp-Snapshot-State"), "stale");
    assert.equal(edgeOnly.headers.get("etag"), null);
    assert.match(await edgeOnly.text(), /Last known state/);
    assert.equal((await fetch("/unwarmed?storage=down&replica=down")).status, 503);
    await runtime.dispose(); runtime = new Miniflare(convertV4MiniflareOptions(options));
    assert.match(await (await fetch("/?storage=down&restored=2")).text(), /Degraded v5/);
    const rebuild = async (input) => (await fetch("/test/rebuild", { method: "POST", body: JSON.stringify(input) })).json();
    const failedReplica = await rebuild({ generation: 10, replicaFailure: "always" });
    assert.match(failedReplica.failure, /replica PUT failure/);
    assert.equal(failedReplica.pointerWrites, 0, "no unprotected selector is exposed");
    assert.equal(failedReplica.pointer.version, "v5");
    assert.equal(failedReplica.replica.version, "v5");
    assert.equal(failedReplica.completed, false);
    assert.equal(failedReplica.builds.at(-1).status, "failed");
    assert.equal(failedReplica.loads, 1);
    assert.equal(new Set(failedReplica.attemptedVersions).size, 1);
    for (const replicaFailure of ["once", "after-ack"]) {
      const result = await rebuild({ generation: replicaFailure === "once" ? 11 : 12, replicaFailure });
      assert.equal(result.failure, null);
      assert.equal(result.loads, 1, "retries retain exact rendered generation");
      assert.equal(new Set(result.attemptedVersions).size, 1);
      assert.equal(result.pointer.version, result.replica.version);
      assert.equal(result.completed, true);
    }
    const failedPointer = await rebuild({ generation: 13, pointerFailure: true });
    assert.match(failedPointer.failure, /R2 selector failure/);
    assert.equal(failedPointer.completed, false);
    assert.equal(failedPointer.pointer.generation, 12);
    assert.equal(failedPointer.replica.generation, 13, "complete R2-persisted generation remains available during selector repair");
    assert.equal(failedPointer.builds.at(-1).status, "failed");
    assert.equal(new Set(failedPointer.attemptedVersions).size, 1);
    assert.equal((await fetch("/?storage=down&selectorRepair=1")).status, 200);

    // MOVE-005: actual rendered alias artifacts and pages share one R2 generation.
    // Every public request creates a fresh service whose repository throws on use.
    const at = new Date().toISOString();
    const source = {
      settings: { pageName: "Imported public record", tagline: "Source history", accentColor: "#16794C", timezone: "UTC", hostname: "page.example", footerCreditEnabled: false, logoKey: null, logoContentType: null, widgetAllowedOrigins: "[]", feedId: "import-fixture" },
      components: [{ id: "component", name: "API", groupName: null, groupOrder: null, displayOrder: 0 }], claims: [], history: [], corrections: [], reports: [],
      incidents: [{ id: "incident", reference: "INC-1", title: "Original outage", lifecycle: "Resolved", openedAt: at, resolvedAt: at }],
      incidentComponents: [{ incidentId: "incident", componentName: "API" }],
      updates: [{ id: "update", incidentId: "incident", lifecycle: "Resolved", affectedAudience: "Customers", customerImpact: "Service restored", whatStillWorks: "API", details: "Recovered", nextUpdateAt: null, publishedAt: at }],
      maintenance: [{ id: "maintenance", reference: "SCH-1", title: "Database upgrade", state: "Completed", startsAt: at, endsAt: at, completedAt: at }],
      maintenanceComponents: [{ maintenanceId: "maintenance", componentName: "API" }], maintenanceNotices: [],
      importedPublicRecords: [{ namespace: "statuspage", sourceId: "original-outage", targetKind: "incident", targetId: "incident", shortlink: "https://stspg.io/outage" }, { namespace: "statuspage", sourceId: "original-upgrade", targetKind: "maintenance", targetId: "maintenance", shortlink: "https://stspg.io/upgrade" }],
    };
    const imported = await rebuild({ generation: 20, source });
    assert.equal(imported.failure, null);
    for (const [path, destination, title] of [["/incidents/original-outage", "/incidents/INC-1", "Original outage"], ["/outage", "/incidents/INC-1", "Original outage"], ["/incidents/original-upgrade", "/maintenance/SCH-1", "Database upgrade"], ["/upgrade", "/maintenance/SCH-1", "Database upgrade"]]) {
      const redirected = await fetch(path, { redirect: "manual" });
      assert.equal(redirected.status, 301); assert.equal(redirected.headers.get("Location"), destination);
      const record = await fetch(destination); assert.equal(record.status, 200); assert.match(await record.text(), new RegExp(title));
      assert.equal(record.headers.get("X-Lamp-Snapshot-Generated-At"), redirected.headers.get("X-Lamp-Snapshot-Generated-At"));
      assert.equal((await runtime.dispatchFetch(`https://app.example${path}`)).status, 404);
    }
    const oldFeed = await fetch("/history.atom"); assert.equal(oldFeed.status, 200);
    assert.match(oldFeed.headers.get("Content-Type"), /application\/atom\+xml/);
    assert.equal(await oldFeed.text(), await (await fetch("/feed.atom")).text());
    for (const path of ["/api/v2/summary.json", "/history.rss", "/auth/login", "/app/settings"]) assert.equal((await fetch(path)).status, 404);
    // The next snapshot has no removed record or its alias, even after cache warming.
    const removed = structuredClone(source); removed.incidents = []; removed.updates = []; removed.incidentComponents = [];
    assert.equal((await rebuild({ generation: 21, source: removed })).failure, null);
    assert.equal((await fetch("/outage", { redirect: "manual" })).status, 404);
    assert.equal((await fetch("/upgrade", { redirect: "manual" })).status, 301);
    const legacy = structuredClone(source);
    legacy.importedPublicRecords[0].shortlink = "https://stspg.io/auth/login";
    legacy.importedPublicRecords[1].shortlink = "https://stspg.io/shared";
    legacy.importedPublicRecords.push({ ...legacy.importedPublicRecords[0], shortlink: "https://stspg.io/shared" });
    assert.equal((await rebuild({ generation: 22, source: legacy })).failure, null);
    assert.equal((await fetch("/")).status, 200, "legacy unsafe aliases never withhold status");
    assert.equal((await fetch("/incidents/original-outage", { redirect: "manual" })).status, 301, "safe source path still works");
    assert.equal((await fetch("/shared", { redirect: "manual" })).status, 404, "neither side wins a legacy alias conflict");
    assert.equal((await fetch("/auth/login", { redirect: "manual" })).status, 404);
    const noHistory = structuredClone(source);
    noHistory.incidents = []; noHistory.maintenance = []; noHistory.importedPublicRecords = []; noHistory.importedNamespaces = ["statuspage"];
    assert.equal((await rebuild({ generation: 23, source: noHistory })).failure, null);
    assert.equal((await fetch("/history.atom")).status, 200, "component-only import still serves source feed");
    noHistory.importedNamespaces = [];
    assert.equal((await rebuild({ generation: 24, source: noHistory })).failure, null);
    assert.equal((await fetch("/history.atom")).status, 404, "complete undo removes source feed");

  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
});
