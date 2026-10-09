import { execFileSync } from "node:child_process";

/** Read only membership of the process group created by detached spawn. */
export function ownedGroupMembers(server) {
  if (!server?.pid) return [];
  let output;
  try { output = execFileSync("ps", ["-g", String(server.pid), "-o", "pid=,pgid="], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (cause) {
    if (cause.status === 1 && !cause.stdout?.toString().trim()) return [];
    throw cause;
  }
  return output.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([_pid, group]) => group === server.pid).map(([pid]) => pid);
}

/** A detached leader can exit before its Vite/workerd descendants. */
export async function stopOwnedGroup(server) {
  if (!server?.pid) return;
  const leaderRunning = () => server.exitCode === null && server.signalCode === null;
  const deadline = performance.now() + 5_000;
  if (ownedGroupMembers(server).length) {
    try { process.kill(-server.pid, "SIGTERM"); }
    catch (cause) {
      if (cause?.code !== "ESRCH" && !(cause?.code === "EPERM" && !ownedGroupMembers(server).length)) throw cause;
    }
  }
  while (leaderRunning() || ownedGroupMembers(server).length) {
    if (performance.now() >= deadline) throw new Error(`Owned process group ${server.pid} did not exit after SIGTERM.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
