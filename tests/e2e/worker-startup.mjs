import { createServer } from "node:net";

function startupOutput(output) {
  return typeof output === "function" ? output() : output ?? "";
}

async function probeSummary(response) {
  if (!response || typeof response.status !== "number") throw new Error("A Worker startup probe must return an HTTP response.");
  const body = typeof response.text === "function" ? await response.text() : "";
  return `${response.status}${body ? ` ${body}` : ""}`;
}

/** Reserve an ephemeral loopback port for one local Worker test. */
export async function reservePort({ host = "127.0.0.1", label = "Worker" } = {}) {
  return new Promise((resolvePort, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, host, () => {
      const address = listener.address();
      if (!address || typeof address === "string") return reject(new Error(`Could not reserve a ${label} port.`));
      listener.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

/**
 * Wait for one locally spawned Worker without allowing a half-open HTTP probe
 * to exceed the fixture's wall-clock startup budget. Custom host-routing probes
 * receive the same AbortSignal and remaining budget as the default fetch probe.
 */
export async function waitForWorker({ origin, child, output, probe, isListening, timeoutMs = 30_000, label = "Worker" } = {}) {
  if (!child) throw new Error(`${label} startup requires its spawned child process.`);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`${label} startup timeout must be positive.`);
  if (!probe && !origin) throw new Error(`${label} startup requires an origin or custom probe.`);

  const healthProbe = probe ?? (({ signal }) => fetch(new URL("/health", origin), { signal }));
  const deadline = performance.now() + timeoutMs;
  let latest = "connection refused";

  while (performance.now() < deadline) {
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(`${label} exited before it became ready:\n${startupOutput(output)}`);
    }
    const remainingMs = Math.max(1, Math.ceil(deadline - performance.now()));
    const signal = AbortSignal.timeout(remainingMs);
    try {
      if (isListening && !isListening()) throw new Error("spawned Worker has not announced its listening address");
      const response = await healthProbe({ signal, remainingMs });
      if (child.exitCode != null || child.signalCode != null) {
        throw new Error(`${label} exited during its startup probe:\n${startupOutput(output)}`);
      }
      if (!response || typeof response.status !== "number") throw new Error("startup probe did not return an HTTP response.");
      if (response.status === 200) return response;
      latest = await probeSummary(response);
    } catch (cause) {
      latest = cause instanceof Error ? cause.message : String(cause);
    }

    const pause = Math.min(100, Math.max(0, deadline - performance.now()));
    if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
  }

  throw new Error(`${label} did not become ready within ${timeoutMs}ms (${latest}):\n${startupOutput(output)}`);
}
