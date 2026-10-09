import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openRuntime, migrate } from "./runtime.mjs";

const listen = (port) => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(port, "127.0.0.1", () => resolve(server));
});
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

test("default real D1 runtimes allocate independent HTTP and inspector ports and release them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lamp-t073-ports-"));
  const runtimes = [openRuntime(join(directory, "a")), openRuntime(join(directory, "b"))];
  let ports;
  try {
    const urls = await Promise.all(runtimes.map(async (runtime) => [await runtime.ready, await runtime.getInspectorURL()]));
    ports = urls.flat().map((url) => Number(url.port));
    assert.ok(ports.every((port) => port > 0));
    assert.equal(new Set(ports).size, 4, "HTTP and inspector listeners must all be independent");
    const databases = await Promise.all(runtimes.map((runtime) => runtime.getD1Database("DB")));
    await Promise.all(databases.map((db) => migrate(db)));
    await databases[0].prepare("INSERT INTO components (id,name,display_order,created_at,updated_at) VALUES ('isolated','Only first database',0,'2026-10-07','2026-10-07')").run();
    assert.equal((await databases[0].prepare("SELECT COUNT(*) AS count FROM components").first()).count, 1);
    assert.equal((await databases[1].prepare("SELECT COUNT(*) AS count FROM components").first()).count, 0);
    for (const [url] of urls) assert.equal(await (await fetch(url)).text(), "test database");
  } finally {
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
    await rm(directory, { recursive: true, force: true });
  }
  const listeners = [];
  try { for (const port of ports) listeners.push(await listen(port)); }
  finally { await Promise.all(listeners.map(close)); }
});
