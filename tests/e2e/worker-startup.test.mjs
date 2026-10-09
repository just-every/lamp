import assert from "node:assert/strict";
import { createServer } from "node:net";
import { after, test } from "node:test";

import { reservePort, waitForWorker } from "./worker-startup.mjs";

const listeners = [];

after(async () => {
  await Promise.all(listeners.splice(0).map(({ server, sockets }) => new Promise((resolve) => {
    for (const socket of sockets) socket.destroy();
    server.close(resolve);
  })));
});

test("Worker startup bounds a listener that accepts but never answers", async () => {
  const port = await reservePort({ label: "stalled startup test" });
  const sockets = new Set();
  const server = createServer((socket) => sockets.add(socket));
  server.on("connection", (socket) => socket.once("close", () => sockets.delete(socket)));
  listeners.push({ server, sockets });
  await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", (error) => error ? reject(error) : resolve()));

  const startedAt = performance.now();
  await assert.rejects(
    waitForWorker({ origin: `http://127.0.0.1:${port}`, child: { exitCode: null }, output: () => "stalled Worker output", timeoutMs: 80, label: "Stalled Worker" }),
    (error) => /Stalled Worker did not become ready within 80ms/.test(error.message) && /stalled Worker output/.test(error.message),
  );
  assert.ok(performance.now() - startedAt < 1_000, "the abortable probe must honor the bounded startup budget");
});

test("Worker startup exposes an early child exit with captured output", async () => {
  await assert.rejects(
    waitForWorker({ origin: "http://127.0.0.1:1", child: { exitCode: 1 }, output: () => "worker compile failed", label: "Exited Worker" }),
    (error) => /Exited Worker exited before it became ready/.test(error.message) && /worker compile failed/.test(error.message),
  );
});
