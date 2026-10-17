import type { SnapshotArtifact } from "./renderer";

/** Pagination is rendered before the generation advances. A cursor addresses
 * one immutable page, so public reads never query application data. */
export function nativeCollectionArtifacts(name: string, records: Array<{ id: string }>, generatedAt: string): SnapshotArtifact[] {
  const artifacts: SnapshotArtifact[] = [];
  const size = 50;
  for (let offset = 0; offset < Math.max(records.length, 1); offset += size) {
    const cursor = offset === 0 ? "" : records[offset - 1].id;
    const nextCursor = offset + size < records.length ? records[offset + size - 1].id : null;
    artifacts.push({
      key: `api/public/v1/${name}${cursor ? `/${encodeURIComponent(cursor)}` : ""}.json`,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ generatedAt, data: records.slice(offset, offset + size), nextCursor }),
    });
  }
  return artifacts;
}

export function nativeApiArtifact(path: string, cursor: string | undefined) {
  const collection = /^\/api\/public\/v1\/(components|incidents|maintenance)(?:\.json)?\/?$/.exec(path)?.[1];
  if (!collection || (cursor && !/^[A-Za-z0-9_-]{1,100}$/.test(cursor))) return "api/public/v1/not-found.json";
  return `api/public/v1/${collection}${cursor ? `/${cursor}` : ""}.json`;
}
