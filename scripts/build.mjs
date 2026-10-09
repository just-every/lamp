import { spawnSync } from "node:child_process";

import { readBuiltWorkerArtifact } from "./build-output.mjs";

const result = spawnSync("pnpm", ["exec", "vite", "build"], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
await readBuiltWorkerArtifact();
