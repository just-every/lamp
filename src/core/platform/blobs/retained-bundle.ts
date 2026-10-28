export interface RetainedArtifact { key: string; body: string; contentType: string; encoding?: "base64" }
export interface RetainedBundle {
  version: string;
  generatedAt: string;
  generation: number;
  artifacts: RetainedArtifact[];
}
export function encodeRetainedBundle(bundle: RetainedBundle) {
  const encoded = JSON.stringify(bundle);
  // Bound memory during rendering and replication; reject before publication.
  if (new TextEncoder().encode(encoded).byteLength > 25 * 1024 * 1024) throw new Error("Retained snapshot exceeds the 25 MiB retained bundle limit.");
  return encoded;
}
export function readRetainedArtifact(encoded: string, key: string) {
  const bundle = JSON.parse(encoded) as RetainedBundle;
  if (!bundle || typeof bundle.version !== "string" || !Number.isFinite(Date.parse(bundle.generatedAt)) || (!Number.isInteger(bundle.generation) || bundle.generation < 0) || !Array.isArray(bundle.artifacts)) throw new Error("Retained snapshot is invalid.");
  const keys = new Set<string>();
  for (const artifact of bundle.artifacts) {
    if (typeof artifact.key !== "string" || typeof artifact.body !== "string" || typeof artifact.contentType !== "string" || (artifact.encoding !== undefined && artifact.encoding !== "base64") || keys.has(artifact.key)) throw new Error("Retained snapshot artifact is invalid.");
    if (artifact.encoding === "base64" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(artifact.body)) throw new Error("Retained binary snapshot artifact is invalid.");
    keys.add(artifact.key);
  }
  for (const required of ["page.html", "feed.atom", "widget.js", "status.json"]) if (!keys.has(required)) throw new Error("Retained snapshot is incomplete.");
  const artifact = bundle.artifacts.find((item) => item.key === key);
  if (!artifact) return null;
  const bytes = artifact.encoding === "base64" ? Uint8Array.from(atob(artifact.body), character => character.charCodeAt(0)).buffer : new TextEncoder().encode(artifact.body).buffer;
  return { bytes, contentType: artifact.contentType, version: bundle.version, generatedAt: new Date(bundle.generatedAt).toISOString(), stale: true };
}
