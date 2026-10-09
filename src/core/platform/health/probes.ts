import type { JobDispatcher } from "../jobs";

export interface DependencyProber {
  checkStorage(): Promise<void>;
  checkQueue(): Promise<void>;
}

export function createDependencyProber(storage: R2Bucket, jobs: JobDispatcher): DependencyProber {
  return {
    async checkStorage() {
      const key = `_health/${crypto.randomUUID()}`;
      await storage.put(key, new Uint8Array([1]), { httpMetadata: { contentType: "application/octet-stream" } });
      try {
        const stored = await storage.get(key);
        if (!stored) throw new Error("R2 did not return its health probe object.");
      } finally {
        await storage.delete(key);
      }
    },
    async checkQueue() {
      await jobs.enqueue({ type: "health-probe", requestedAt: new Date().toISOString() });
    },
  };
}
