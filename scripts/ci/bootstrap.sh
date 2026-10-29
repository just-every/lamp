#!/usr/bin/env bash
set -euo pipefail
# setup-node selects package.json's Node pin before this step. Keep the package
# manager pin in the same source as local installs, without installing a browser.
manager=$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).packageManager')
[[ "$manager" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+$ ]]
if ! command -v pnpm >/dev/null || [ "$(pnpm --version)" != "${manager#pnpm@}" ]; then
  npm install --global "$manager" --no-audit --no-fund
fi
# Keep installs and journey scratch homes on the runner-owned temporary volume.
# Fresh installer journeys clear their environment and create their own HOME
# beneath TMPDIR; the browser-driving process keeps the runner's real HOME.
: "${RUNNER_TEMP:?RUNNER_TEMP is required for CI caches}"
export TMPDIR="$RUNNER_TEMP"
printf 'TMPDIR=%s\n' "$TMPDIR" >> "$GITHUB_ENV"
export npm_config_store_dir="$RUNNER_TEMP/pnpm-store"
printf 'npm_config_store_dir=%s\n' "$npm_config_store_dir" >> "$GITHUB_ENV"
pnpm config set store-dir "$npm_config_store_dir"
pnpm install --frozen-lockfile
# Preserve the locked native runtime launch check from agent-bootstrap.sh.
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(realpathSync('node_modules/wrangler/package.json'));
const runtime = require.resolve('workerd/package.json');
execFileSync(resolve(dirname(runtime), 'bin/workerd'), ['--version'], { stdio: 'inherit' });
NODE
