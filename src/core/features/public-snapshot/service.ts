import type { RetainedSnapshotCache } from "../../platform/blobs/retained";
import { encodeRetainedBundle, readRetainedArtifact } from "../../platform/blobs/retained-bundle";
import { createUlid, nowIso } from "../../shared/ids";
import type { BlobObject, BlobStore } from "../../platform/blobs/store";
import type { LampServerSlots } from "../../api/extensions";

import { readGenerationArtifact } from "./generation-cache";
import { renderPublicSnapshot } from "./renderer";
import type { SnapshotRepository } from "./repository";
import { defaultPublicSnapshotPolicies, type PublicSnapshotPolicies } from "./policies";
import { defaultPublicSnapshotEvents, type PublicSnapshotEvents } from "./events";

const CURRENT_POINTER_KEY = "snapshots/current.json";
const STALE_MARKER_KEY = "snapshots/stale.json";
const STALE_BUILD_MS = 5 * 60_000;
const RETRY_LEASE_MS = 2 * 60_000;
const LOGO_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const PUBLIC_SNAPSHOT_RENDERER_VERSION = "lamp-public-snapshot-v20";

interface SnapshotPointer {
  version: string;
  generatedAt: string;
  generation: number;
  sourceRevision: number;
  rendererVersion: string | null;
}

interface SnapshotStaleMarker {
  revision: number;
  failedAt: string;
}

function logoDataUrl(logo: { bytes: ArrayBuffer; contentType: string }) {
  if (!LOGO_CONTENT_TYPES.has(logo.contentType)) throw new Error("Configured logo content type is invalid.");
  const bytes = new Uint8Array(logo.bytes);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${logo.contentType};base64,${btoa(binary)}`;
}

export interface PublicSnapshotService {
  rebuild(force?: boolean): Promise<void>;
  hasCurrentSnapshot(): Promise<boolean>;
  readArtifact(key: string): Promise<{ bytes: ArrayBuffer; contentType: string; version: string; generatedAt: string; stale: boolean; retainedReady?: boolean } | null>;
  latestBuild(): ReturnType<SnapshotRepository["latestBuild"]>;
  /** When the page customers see now was published; null before the first snapshot. */
  publishedAt(): Promise<string | null>;
  retryPendingBuild(): Promise<boolean>;
}

function parsePointer(object: BlobObject): SnapshotPointer {
  const parsed = JSON.parse(object.text) as Partial<SnapshotPointer>;
  if (typeof parsed.version !== "string" || typeof parsed.generatedAt !== "string" || !Number.isFinite(Date.parse(parsed.generatedAt)) || typeof parsed.generation !== "number" || !Number.isInteger(parsed.generation) || parsed.generation < 0 || typeof parsed.sourceRevision !== "number" || !Number.isInteger(parsed.sourceRevision) || parsed.sourceRevision < 0) throw new Error("Public snapshot pointer is invalid.");
  return {
    version: parsed.version,
    generatedAt: new Date(parsed.generatedAt).toISOString(),
    generation: parsed.generation,
    sourceRevision: parsed.sourceRevision,
    // Older deployments did not persist a renderer identity. Unknown values
    // are treated as stale so the scheduler can publish a known version.
    rendererVersion: typeof parsed.rendererVersion === "string" && parsed.rendererVersion.length > 0 ? parsed.rendererVersion : null,
  };
}

function rendererNeedsRebuild(pointer: SnapshotPointer | null) {
  return pointer !== null && pointer.rendererVersion !== PUBLIC_SNAPSHOT_RENDERER_VERSION;
}

export function createPublicSnapshotService(
  repository: SnapshotRepository,
  blobs: BlobStore,
  policies: PublicSnapshotPolicies = defaultPublicSnapshotPolicies,
  events: PublicSnapshotEvents = defaultPublicSnapshotEvents,
  slots: LampServerSlots = {},
  retained?: RetainedSnapshotCache,
): PublicSnapshotService {
  let rebuildTail: Promise<void> = Promise.resolve();

  async function readPointer(): Promise<SnapshotPointer | null> {
    const object = await blobs.getText(CURRENT_POINTER_KEY);
    return object ? parsePointer(object) : null;
  }

  async function advancePointer(pointer: SnapshotPointer) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const currentObject = await blobs.getText(CURRENT_POINTER_KEY);
      const current = currentObject ? parsePointer(currentObject) : null;
      if (current && current.generation >= pointer.generation) return false;
      if (await blobs.putTextConditionally(CURRENT_POINTER_KEY, JSON.stringify(pointer), "application/json; charset=utf-8", { eTag: currentObject?.eTag ?? null })) return true;
    }
    throw new Error("Public snapshot pointer changed too often to advance safely.");
  }

  async function staleMarker() {
    const object = await blobs.getText(STALE_MARKER_KEY);
    if (!object) return null;
    const parsed = JSON.parse(object.text) as Partial<SnapshotStaleMarker>;
    if (typeof parsed.revision !== "number" || !Number.isInteger(parsed.revision) || typeof parsed.failedAt !== "string") throw new Error("Public snapshot stale marker is invalid.");
    return { marker: { revision: parsed.revision, failedAt: parsed.failedAt }, eTag: object.eTag };
  }

  async function markStale(revision: number, failedAt: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await staleMarker();
      if (existing && existing.marker.revision >= revision) return;
      if (await blobs.putTextConditionally(STALE_MARKER_KEY, JSON.stringify({ revision, failedAt } satisfies SnapshotStaleMarker), "application/json; charset=utf-8", { eTag: existing?.eTag ?? null })) return;
    }
    throw new Error("Public snapshot stale marker changed too often to record a failed build safely.");
  }

  // Public reads can continue from R2 when D1 has failed. Keep that fact in
  // R2 too: snapshot bookkeeping is useful observability, never a dependency
  // for telling a reader that the artifact predates the current source.
  async function markReachableSnapshotStale(revision?: number) {
    try {
      const pointer = await readPointer();
      if (!pointer) return;
      await markStale(Math.max(revision ?? 0, pointer.sourceRevision + 1), nowIso());
    } catch {
      // If R2 itself is unavailable the route's cached-object path provides
      // the only possible stale response. Do not conceal the original error.
    }
  }

  async function staleRevisionNeedsRebuild(pointer: SnapshotPointer | null) {
    if (!pointer) return false;
    const marker = await staleMarker();
    return Boolean(marker && marker.marker.revision > pointer.sourceRevision);
  }

  async function rebuildOne(revision: number) {
    const timestamp = nowIso();
    const buildId = createUlid();
    let started = false;
    let attempts = 0;
    let lastError: unknown;
    try {
      const generation = await repository.reserveGeneration(timestamp);
      await repository.startBuild({
        id: buildId,
        status: "building",
        version: null,
        error: null,
        attempts: 0,
        startedAt: timestamp,
        finishedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      started = true;
      async function prepare() {
        const source = await repository.load();
        if (!source) throw new Error("Cannot build a public snapshot before page settings exist.");
        const logo = source.settings.logoKey ? await blobs.getBytes(source.settings.logoKey) : null;
        if (source.settings.logoKey && !logo) throw new Error("Configured logo object is missing from object storage.");
        const logoContentType = logo?.contentType ?? source.settings.logoContentType;
        if (logo && !logoContentType) throw new Error("Configured logo content type is missing.");
        const version = createUlid();
        const rendered = renderPublicSnapshot(source, new Date().toISOString(), policies, { logoDataUrl: logo && logoContentType ? logoDataUrl({ ...logo, contentType: logoContentType }) : null }, slots);
        const bundle = encodeRetainedBundle({ version, generatedAt: rendered.generatedAt, generation, artifacts: rendered.artifacts });
        return { version, rendered, bundle, logo, logoContentType };
      }
      let prepared: Awaited<ReturnType<typeof prepare>> | null = null;
      while (attempts < 3) {
        attempts += 1;
        try {
        // Retry storage/replica/pointer delivery with identical generation bytes.
        prepared ??= await prepare();
        const { version, rendered, bundle, logo, logoContentType } = prepared;
        await Promise.all(rendered.artifacts.map((artifact) => blobs.putText(`snapshots/${version}/${artifact.key}`, artifact.body, artifact.contentType)));
        if (logo) {
          await blobs.putBytes(`snapshots/${version}/assets/logo`, logo.bytes, logoContentType ?? "application/octet-stream");
        }
        // Artifacts are complete before the conditional pointer change. A
        // superseded build deliberately leaves its revision pending: a later
        // cron pass rereads D1 rather than assuming the winner saw this write.
        if (retained) await blobs.putText(`snapshots/${version}/retained.json`, bundle, "application/json");
        // Retention must be acknowledged before the R2 selector can expose
        // this generation. A failed replica write leaves the prior pointer.
        if (retained) await retained.write(bundle);
        const replicaGeneration = retained ? await retained.generation() : generation;
        const advanced = replicaGeneration === generation
          ? await advancePointer({ version, generatedAt: rendered.generatedAt, generation, sourceRevision: revision, rendererVersion: PUBLIC_SNAPSHOT_RENDERER_VERSION })
          : false;
        const finishedAt = nowIso();
        await repository.finishBuild({ id: buildId, status: "published", version, error: advanced ? null : "Superseded by a newer public snapshot generation.", attempts, finishedAt, updatedAt: finishedAt });
        const selected = await readPointer();
        if (selected?.version === version) await repository.completeWork(revision, finishedAt);
        if (!advanced) return;
        await events.snapshotPublished({ version, generatedAt: rendered.generatedAt });
        return;
        } catch (cause) {
          lastError = cause;
        }
      }
      const message = lastError instanceof Error ? lastError.message : "Unknown snapshot build failure.";
      throw new Error(`Public snapshot build failed after ${attempts} attempts: ${message}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown snapshot build failure.";
      if (started) {
        try {
          await repository.finishBuild({ id: buildId, status: "failed", version: null, error: message, attempts, finishedAt: nowIso(), updatedAt: nowIso() });
        } catch {
          // R2 remains reachable even when build bookkeeping is not.
        }
      }
      await markReachableSnapshotStale(revision);
      throw cause;
    }
  }

  async function enqueueRebuild(force = false) {
    let work: { requestedRevision: number; completedRevision: number };
    try {
      work = await repository.currentWork();
    } catch (cause) {
      await markReachableSnapshotStale();
      throw cause;
    }
    // Database triggers record every public-source mutation. A first snapshot
    // without prior work still creates a durable request here.
    const pointer = await readPointer();
    const revision = force ? await repository.requestWork(nowIso()) : work.requestedRevision > work.completedRevision
      ? work.requestedRevision
      : !pointer || await staleRevisionNeedsRebuild(pointer) || rendererNeedsRebuild(pointer)
        ? await repository.requestWork(nowIso())
        : null;
    if (revision === null) return;
    const next = rebuildTail.then(() => rebuildOne(revision), () => rebuildOne(revision));
    rebuildTail = next.catch(() => undefined);
    return next;
  }

  return {
    rebuild: enqueueRebuild,
    async hasCurrentSnapshot() {
      try {
        if (await readPointer()) return true;
      } catch (cause) {
        if (!retained) throw cause;
      }
      return Boolean(await retained?.read());
    },
    async readArtifact(key) {
      try {
        const pointer = await readPointer();
        if (!pointer) {
          const bundle = await retained?.read();
          return bundle ? readRetainedArtifact(bundle, key) : null;
        }
        const object = await readGenerationArtifact(blobs, pointer.version, key);
        if (!object && ["page.html", "feed.atom", "widget.js", "status.json"].includes(key)) throw new Error("Published snapshot artifact is missing.");
        const marker = await staleMarker();
        let retainedReady = false;
        if (retained) {
          try {
            let generation = await retained.generation();
            if (generation === null || generation < pointer.generation) {
              const archived = await blobs.getText(`snapshots/${pointer.version}/retained.json`);
              if (archived) { await retained.write(archived.text); generation = await retained.generation(); }
            }
            retainedReady = generation !== null && generation >= pointer.generation;
          } catch { /* The readable R2 snapshot remains authoritative. */ }
        }
        return object ? {
          bytes: object.bytes,
          contentType: object.contentType ?? "application/octet-stream",
          version: pointer.version,
          retainedReady,
          generatedAt: pointer.generatedAt,
          stale: Boolean(marker && marker.marker.revision > pointer.sourceRevision),
        } : null;
      } catch (cause) {
        const bundle = await retained?.read();
        if (!bundle) throw cause;
        return readRetainedArtifact(bundle, key);
      }
    },
    latestBuild: () => repository.latestBuild(),
    async publishedAt() {
      try { return (await readPointer())?.generatedAt ?? null; }
      catch { return null; /* An unreadable pointer reads as not yet published. */ }
    },
    async retryPendingBuild() {
      try {
        const now = new Date();
        const nowText = now.toISOString();
        const staleBefore = new Date(now.getTime() - STALE_BUILD_MS).toISOString();
        await repository.markInterruptedBuilds(nowText, staleBefore);
        let work = await repository.currentWork();
        if (work.completedRevision >= work.requestedRevision) {
          const pointer = await readPointer();
          const missingReplica = retained && pointer && (await retained.generation()) === null;
          if (missingReplica) {
            const archived = await blobs.getText(`snapshots/${pointer.version}/retained.json`);
            if (archived) { await retained!.write(archived.text); return true; }
          }
          if (!missingReplica && !(await staleRevisionNeedsRebuild(pointer)) && !rendererNeedsRebuild(pointer)) return false;
          await repository.requestWork(nowText);
          work = await repository.currentWork();
        }
        const leaseId = createUlid();
        if (!(await repository.claimPendingWork({ leaseId, now: nowText, leaseUntil: new Date(now.getTime() + RETRY_LEASE_MS).toISOString(), staleBefore }))) return false;
        work = await repository.currentWork();
        if (work.completedRevision >= work.requestedRevision) return false;
        try {
          await rebuildOne(work.requestedRevision);
          return true;
        } finally {
          await repository.releaseWorkLease(leaseId, nowIso());
        }
      } catch (cause) {
        await markReachableSnapshotStale();
        throw cause;
      }
    },
  };
}
