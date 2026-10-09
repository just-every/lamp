import type { BlobStore } from "./store";

export function createR2BlobStore(bucket: R2Bucket): BlobStore {
  return {
    async getText(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return { text: await object.text(), contentType: object.httpMetadata?.contentType ?? null, eTag: object.etag };
    },
    async putText(key, text, contentType) {
      await bucket.put(key, text, { httpMetadata: { contentType } });
    },
    async putTextConditionally(key, text, contentType, condition) {
      const object = await bucket.put(key, text, {
        httpMetadata: { contentType },
        onlyIf: condition.eTag ? { etagMatches: condition.eTag } : { etagDoesNotMatch: "*" },
      });
      return object !== null;
    },
    async getBytes(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return { bytes: await object.arrayBuffer(), contentType: object.httpMetadata?.contentType ?? null };
    },
    async putBytes(key, bytes, contentType) {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    },
  };
}

export function createSnapshotBlobStore(bindings: { SNAPSHOTS: R2Bucket }): BlobStore {
  return createR2BlobStore(bindings.SNAPSHOTS);
}
