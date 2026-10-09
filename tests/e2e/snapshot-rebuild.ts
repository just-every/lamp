import { createPublicSnapshotService } from "../../src/core/features/public-snapshot/service";
import { createR2BlobStore } from "../../src/core/platform/blobs/r2";
import { createRetainedSnapshotCache } from "../../src/core/platform/blobs/retained";

/** Real renderer, R2 and SQLite DO with test-only fault injection at write seams. */
export async function exerciseRebuild(env, input) {
  const blobs = createR2BlobStore(env.SNAPSHOTS);
  const cache = createRetainedSnapshotCache(env);
  const attemptedVersions = [];
  let loads = 0, completed = false, pointerWrites = 0;
  const builds = [];
  const source = {
    settings: { id: "default", pageName: "Retained rebuild", tagline: "Verified fixture", accentColor: "#16794C", timezone: "UTC", hostname: "status.example.test", footerCreditEnabled: false, logoKey: null, logoContentType: null, widgetAllowedOrigins: "[]", mailFromAddress: "lamp@example.test", aiToneInstructions: "", feedId: "retained-fixture", createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z" },
    components: [], claims: [], history: [], corrections: [], incidents: [], incidentComponents: [], updates: [], maintenance: [], maintenanceComponents: [], reports: [], maintenanceNotices: [],
  };
  const repository = {
    load: async () => { loads++; return source; },
    startBuild: async () => {}, finishBuild: async value => { builds.push(value); }, latestBuild: async () => null,
    reserveGeneration: async () => input.generation, requestWork: async () => input.generation,
    currentWork: async () => ({ requestedRevision: input.generation, completedRevision: 0 }),
    completeWork: async () => { completed = true; },
    markInterruptedBuilds: async () => {}, claimPendingWork: async () => true, releaseWorkLease: async () => {},
  };
  const faultBlobs = { ...blobs, async putTextConditionally(key, ...args) {
    if (key === "snapshots/current.json") {
      pointerWrites++;
      if (input.pointerFailure) throw new Error("Injected R2 selector failure");
    }
    return blobs.putTextConditionally(key, ...args);
  } };
  const faultCache = { ...cache, async write(encoded) {
    attemptedVersions.push(JSON.parse(encoded).version);
    if (input.replicaFailure === "always" || (input.replicaFailure === "once" && attemptedVersions.length === 1)) throw new Error("Injected replica PUT failure");
    await cache.write(encoded);
    if (input.replicaFailure === "after-ack" && attemptedVersions.length === 1) throw new Error("Injected replica response loss");
  } };
  const service = createPublicSnapshotService(repository, faultBlobs, undefined, undefined, undefined, faultCache);
  let failure = null;
  try { await service.rebuild(); } catch (cause) { failure = cause.message; }
  const selected = await blobs.getText("snapshots/current.json");
  const retained = await cache.read();
  return { loads, completed, pointerWrites, builds, attemptedVersions, failure, pointer: selected ? JSON.parse(selected.text) : null, replica: retained ? JSON.parse(retained) : null };
}
