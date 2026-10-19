import { ApiError, appApi } from "../../../app/client/ui/api";

/** Move in's client of the import door's owner surface (/api/operator/import/*):
 * upload the original bytes in chunks, plan, apply the reviewed fingerprint and
 * undo, each request naming its source. Every import takes this path. */
const CHUNK_BYTES = 65_536;
// One apply or undo call is one bounded batch; this is far past the largest import.
const MAX_ROUNDS = 1_000;
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const sha256 = async (bytes: Uint8Array<ArrayBuffer>) => hex(await crypto.subtle.digest("SHA-256", bytes));
function base64(bytes: Uint8Array) {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(text);
}

type DoorJob = { id: string; state: string };

export function moveInDoor(source: string) {
  const call = <T>(action: string, body: unknown) => appApi<T>(`/api/operator/import/${action}`, { method: "POST", headers: { "X-Import-Source": source }, body: JSON.stringify(body) });
  async function planned<T>(uploadId: string) {
    try { return await call<T>("plan", { uploadId }); }
    catch (cause) {
      if (cause instanceof ApiError && cause.message === "catchup_required") return call<T>("plan", { uploadId, catchup: true });
      throw cause;
    }
  }
  async function until(action: "apply" | "undo", body: unknown, working: string[]) {
    let job: DoorJob | undefined;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      job = (await call<{ job: DoorJob }>(action, body)).job;
      if (!working.includes(job.state)) break;
    }
    return job!;
  }
  return {
    /** Uploads the export and plans it. A source imported before is planned as
     * its catch-up; one imported and undone plans afresh. */
    async plan<T>(upload: Record<string, unknown>): Promise<T> {
      const bytes = new TextEncoder().encode(JSON.stringify(upload));
      const bundleSha256 = await sha256(bytes), totalChunks = Math.ceil(bytes.length / CHUNK_BYTES);
      let uploadId: string | undefined;
      for (let index = 0; index < totalChunks; index++) {
        const chunk = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
        uploadId = (await call<{ uploadId: string }>("uploads", { ...(uploadId ? { uploadId } : {}), name: `${source}-move-in.json`, bundleSha256, totalBytes: bytes.length, totalChunks, index, chunkSha256: await sha256(chunk), base64: base64(chunk) })).uploadId;
      }
      return planned<T>(uploadId!);
    },
    apply: (planId: string, reviewedFingerprint: string) => until("apply", { planId, reviewedFingerprint }, ["queued", "applying"]),
    undo: (planId: string) => until("undo", { planId }, ["undoing"]),
  };
}
