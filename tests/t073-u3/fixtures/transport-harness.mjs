import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import net from "node:net";

async function assertClosed(origin) {
  const socket = net.connect(Number(new URL(origin).port), "127.0.0.1");
  try {
    await once(socket, "connect");
    assert.fail(`fixture listener survived teardown: ${origin}`);
  } catch (error) {
    assert.equal(error.code, "ECONNREFUSED");
  } finally {
    socket.destroy();
  }
}

export async function transportServer(t) {
  const child = fork(new URL("./transport-server.mjs", import.meta.url), [], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  let addresses;
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit");
      const watchdog = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.send("stop");
      try { await stopped; } finally { clearTimeout(watchdog); }
    }
    assert.equal(child.exitCode, 0, output);
    assert.equal(child.signalCode, null, output);
    if (addresses) await Promise.all([assertClosed(addresses.origin), assertClosed(addresses.control)]);
    t.diagnostic(`fixture server pid ${child.pid} exited 0; listeners closed`);
  });
  addresses = await new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`fixture exited before ready (${code}): ${output}`)));
  });
  return {
    ...addresses,
    // This real child CLI deliberately blocks the caller's event loop, as the
    // snapshot fixture's synchronous Wrangler commands do. The server stays live.
    control(command = "stats") {
      return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
        'const response = await fetch(process.argv[1]); process.stdout.write(await response.text());',
        `${addresses.control}/${command}`,
      ], { encoding: "utf8", timeout: 10_000 }));
    },
  };
}
