import { spawn } from "node:child_process";

// The standard local entrypoint explicitly selects the isolated development inbox.
const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "4177", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, LAMP_DEV_OUTBOX_MODE: "local" },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
