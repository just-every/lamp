import { DurableObject } from "cloudflare:workers";
import { readRetainedArtifact } from "./retained-bundle";

/** No public HTTP route exposes this class. One SQLite transaction replaces all
 * chunks, so a restart, overlapping publication or failed write cannot expose
 * a partial generation. No expiration or negative cache is used. */
export class SnapshotCache extends DurableObject {
  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS retained_chunks (position INTEGER PRIMARY KEY, body BLOB NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS retained_generation (id INTEGER PRIMARY KEY CHECK(id = 1), generation INTEGER NOT NULL)");
  }
  async fetch(request: Request) {
    if (request.method === "HEAD") {
      const current = [...this.ctx.storage.sql.exec<{generation: number}>("SELECT generation FROM retained_generation WHERE id = 1")][0];
      return new Response(null, { status: current ? 200 : 404, headers: current ? { "X-Lamp-Generation": String(current.generation) } : {} });
    }
    if (request.method === "GET") {
      const chunks = [...this.ctx.storage.sql.exec<{body: ArrayBuffer}>("SELECT body FROM retained_chunks ORDER BY position")];
      if (!chunks.length) return new Response(null, { status: 404 });
      return new Response(new Blob(chunks.map((chunk) => chunk.body)), { headers: { "Content-Type": "application/json" } });
    }
    if (request.method !== "PUT") return new Response(null, { status: 405 });
    const encoded = await request.text();
    try { readRetainedArtifact(encoded, "page.html"); } catch { return new Response("Invalid complete snapshot.", { status: 400 }); }
    const { generation } = JSON.parse(encoded) as { generation: number };
    this.ctx.storage.transactionSync(() => {
      const current = [...this.ctx.storage.sql.exec<{generation: number}>("SELECT generation FROM retained_generation WHERE id = 1")][0];
      if (current && current.generation >= generation) return;
      this.ctx.storage.sql.exec("DELETE FROM retained_chunks");
      // Bounded rows stay comfortably below SQLite's per-row value limit even
      // for rendered pages containing UTF-8 or inline data images.
      const bytes = new TextEncoder().encode(encoded);
      for (let offset = 0; offset < bytes.length; offset += 32_768) {
        this.ctx.storage.sql.exec("INSERT INTO retained_chunks(position, body) VALUES (?, ?)", offset, bytes.slice(offset, offset + 32_768).buffer);
      }
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO retained_generation(id, generation) VALUES (1, ?)", generation);
    });
    return new Response(null, { status: 204 });
  }
}
