import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stopOwnedGroup } from "./owned-process-group.mjs";
import { waitForWorker } from "./worker-startup.mjs";
import { appOrigin } from "./helpers/hosts.mjs";

export { stopOwnedGroup as stopViteWorker };

/** Start a real Vite/workerd app on a socket it owns continuously. */
export async function startViteWorker({ port = 0, statePath, viteCachePath, env = process.env, onOutput = () => {}, label = "Lamp incident Worker", timeoutMs, probe } = {}) {
  const server = spawn("pnpm", ["exec", "node", fileURLToPath(new URL("./vite-worker-process.mjs", import.meta.url)), String(port)], {
    cwd: process.cwd(), stdio: "pipe", detached: true,
    env: { ...env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: viteCachePath, LAMP_DISABLE_INSPECTOR: "true" },
  });
  let output = "";
  let baseUrl;
  const capture = (chunk) => {
    output += chunk;
    baseUrl = output.match(/^LAMP_TEST_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)\r?$/m)?.[1];
    onOutput(chunk);
  };
  server.stdout.on("data", capture);
  server.stderr.on("data", capture);
  try {
    await waitForWorker({
      child: server, output: () => output, label, timeoutMs,
      isListening: () => Boolean(baseUrl),
      probe: (options) => probe ? probe({ ...options, origin: baseUrl }) : fetch(`${baseUrl}/health`, { signal: options.signal }),
    });
    appOrigin(new URL(baseUrl).port);
    return { server, baseUrl };
  } catch (cause) {
    await stopOwnedGroup(server);
    throw cause;
  }
}
