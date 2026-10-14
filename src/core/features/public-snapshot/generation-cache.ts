import type { BlobBytes, BlobStore } from "../../platform/blobs/store";

/** Only immutable generation bytes belong in the normal edge cache. The
 * current pointer and stale marker are always read from object storage. */
export async function readGenerationArtifact(blobs: BlobStore, version: string, key: string): Promise<BlobBytes | null> {
  const request = new Request(`https://lamp-snapshot.invalid/${encodeURIComponent(version)}/${encodeURIComponent(key)}`);
  const cache = typeof caches === "undefined" ? null : await caches.open("lamp-public-snapshot-generations").catch(() => null);
  const cached = await cache?.match(request).catch(() => undefined);
  if (cached) return { bytes: await cached.arrayBuffer(), contentType: cached.headers.get("Content-Type") };
  const object = await blobs.getBytes(`snapshots/${version}/${key}`);
  if (object && cache) {
    try {
      await cache.put(request, new Response(object.bytes, { headers: {
        "Content-Type": object.contentType ?? "application/octet-stream",
        "Cache-Control": "public, max-age=3600, immutable",
      } }));
    } catch { /* Caching is optional; the verified R2 bytes remain available. */ }
  }
  return object;
}
