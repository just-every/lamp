import {appOrigin} from '../e2e/helpers/hosts.mjs';
import { stopOwnedGroup } from "../e2e/owned-process-group.mjs";
import { spawn } from "node:child_process";
import { reservePort, waitForWorker } from "../e2e/worker-startup.mjs";

/** Stop only the process group created for this fixture, including failed startup. */
export async function stopIncidentWorker(server) {
  await stopOwnedGroup(server);
}

/** Call after emulator setup/migrations so their listeners cannot claim the HTTP port. */
export async function startIncidentWorker({ port, statePath, viteCachePath, onOutput = () => {} }) {
  if (port !== undefined) return spawnIncidentWorker({ port, statePath, viteCachePath, onOutput });
  // A reserved ephemeral port is released before Vite binds it, so a concurrent
  // test process can claim it first. Only that lost race is retried on a new port.
  for (let attempt = 1; ; attempt++) {
    try {
      return await spawnIncidentWorker({ port: await reservePort({ label: "Lamp incident Worker" }), statePath, viteCachePath, onOutput });
    } catch (cause) {
      if (attempt >= 3 || !/Port \d+ is already in use/.test(cause?.message ?? "")) throw cause;
    }
  }
}

async function spawnIncidentWorker({ port, statePath, viteCachePath, onOutput }) {
  const baseUrl = appOrigin(port);
  const server = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: process.cwd(), stdio: "pipe", detached: true,
    env: { ...process.env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: viteCachePath, LAMP_DISABLE_INSPECTOR: "true" },
  });
  let output = "";
  const capture = (chunk) => { output += chunk; onOutput(chunk); };
  server.stdout.on("data", capture);
  server.stderr.on("data", capture);
  // Vite prints Local only after its own strict listen succeeds. A foreign 200
  // response cannot satisfy readiness while this child is compiling or failing.
  const isListening = () => output.replace(/\x1b\[[0-9;]*m/g, "").split("\n")
    .some((line) => line.trim().endsWith(`Local:   ${baseUrl}/`));
  try {
    await waitForWorker({ origin: baseUrl, child: server, output: () => output, isListening, label: "Lamp incident Worker" });
    return { server, baseUrl };
  } catch (cause) {
    await stopIncidentWorker(server);
    throw cause;
  }
}
