/** Strongly consistent cache replica for PAGE-006/007. KV negative caching cannot
 * serve a cold location immediately after first publication. R2 remains the
 * canonical archive; this object retains only the latest complete public bundle. */
export interface RetainedSnapshotCache {
  read(): Promise<string | null>;
  generation(): Promise<number | null>;
  write(bundle: string): Promise<void>;
}
export function createRetainedSnapshotCache(bindings: { SNAPSHOT_CACHE: DurableObjectNamespace }): RetainedSnapshotCache {
  if (!bindings.SNAPSHOT_CACHE) throw new Error("SNAPSHOT_CACHE binding is required.");
  const stub = () => bindings.SNAPSHOT_CACHE.get(bindings.SNAPSHOT_CACHE.idFromName("public-snapshot"));
  return {
    async generation() {
      const response = await stub().fetch("https://snapshot.internal/", { method: "HEAD" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Retained snapshot cache lookup failed.");
      return Number(response.headers.get("X-Lamp-Generation"));
    },
    async read() {
      const response = await stub().fetch("https://snapshot.internal/");
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Retained snapshot cache read failed.");
      return response.text();
    },
    async write(bundle) {
      const response = await stub().fetch("https://snapshot.internal/", { method: "PUT", body: bundle });
      if (!response.ok) throw new Error("Retained snapshot cache publication failed.");
    },
  };
}
