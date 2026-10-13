import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { ownedGroupMembers, stopOwnedGroup } from "../e2e/owned-process-group.mjs";

test("owned native process ignoring SIGTERM makes cleanup fail within its bound", async () => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", 'process.on("SIGTERM", () => {}); process.stdout.write("ready"); setInterval(() => {}, 1000);'], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await once(child.stdout, "data");
    const started = performance.now();
    await assert.rejects(stopOwnedGroup(child), new RegExp(`Owned process group ${child.pid} did not exit after SIGTERM`));
    assert.ok(performance.now() - started < 6_000, "leader exit and group shutdown share the five-second bound");
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
    assert.ok(ownedGroupMembers(child).includes(child.pid));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      process.kill(-child.pid, "SIGKILL");
      await exited;
    }
    await stopOwnedGroup(child);
    assert.deepEqual(ownedGroupMembers(child), []);
  }
});
