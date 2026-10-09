import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openRuntime, migrate } from "./runtime.mjs";

test("an occupied legacy port cannot redirect or prevent a real D1 runtime and its restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lamp-t073-occupied-"));
  let foreignRequests = 0;
  const foreign = createServer((_request, response) => {
    foreignRequests++;
    response.end("foreign listener");
  });
  let runtime;
  try {
    await new Promise((resolve, reject) => {
      foreign.once("error", reject);
      foreign.listen(0, "127.0.0.1", resolve);
    });
    const occupiedPort = foreign.address().port;
    const foreignUrl = `http://127.0.0.1:${occupiedPort}`;
    // Extra arguments from a legacy caller must never select a shared listener.
    runtime = openRuntime(directory, occupiedPort);
    let db = await runtime.getD1Database("DB");
    await migrate(db);
    await db.prepare("INSERT INTO components (id,name,display_order,created_at,updated_at) VALUES ('retained','Retained across restart',0,'2026-10-07','2026-10-07')").run();
    for (let start = 0; start < 2; start++) {
      const http = await runtime.ready;
      const inspector = await runtime.getInspectorURL();
      assert.ok(Number(http.port) > 0);
      assert.ok(Number(inspector.port) > 0);
      assert.notEqual(Number(http.port), occupiedPort);
      assert.notEqual(Number(inspector.port), occupiedPort);
      assert.notEqual(http.port, inspector.port);
      assert.equal(await (await fetch(http)).text(), "test database");
      assert.equal(foreignRequests, start, "runtime requests never reach the foreign listener");
      assert.equal(await db.prepare("SELECT name FROM components WHERE id = 'retained'").first("name"), "Retained across restart");
      await runtime.dispose();
      runtime = undefined;
      assert.equal(await (await fetch(foreignUrl, { headers: { Connection: "close" } })).text(), "foreign listener");
      assert.equal(foreignRequests, start + 1, "disposing the runtime leaves the foreign listener intact");
      if (start === 0) {
        runtime = openRuntime(directory, occupiedPort);
        db = await runtime.getD1Database("DB");
      }
    }
  } finally {
    try { await runtime?.dispose(); }
    finally {
      await new Promise((resolve, reject) => foreign.close(error => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }
});
