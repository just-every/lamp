import { spawn } from "node:child_process";
const args = process.argv.slice(2);
const env = { ...process.env };
for (let i = 0; i < args.length; i += 2) {
  if (!["--from", "--evidence"].includes(args[i]) || !args[i + 1])
    throw new Error(
      "Usage: node tests/release/verify.mjs [--from vX.Y.Z] [--evidence DIRECTORY]",
    );
  env[args[i] === "--from" ? "LAMP_UPGRADE_FROM" : "LAMP_UPGRADE_EVIDENCE"] =
    args[i + 1];
}
const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=1", "tests/release/upgrade.test.mjs"],
  { env, stdio: "inherit" },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
