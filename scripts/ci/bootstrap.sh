#!/usr/bin/env bash
set -euo pipefail
# setup-node selects package.json's Node pin before this step. Keep the package
# manager pin in the same source as local installs, without installing a browser.
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(process.versions.node, pkg.engines.node);
NODE
manager=$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).packageManager')
[[ "$manager" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+$ ]]
if ! command -v pnpm >/dev/null || [ "$(pnpm --version)" != "${manager#pnpm@}" ]; then
  npm install --global "$manager" --no-audit --no-fund
fi
pnpm install --frozen-lockfile
# Preserve the locked native runtime launch check from agent-bootstrap.sh.
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(realpathSync('node_modules/wrangler/package.json'));
const runtime = require.resolve('workerd/package.json');
assert.equal(require(runtime).version, '1.20260907.1');
execFileSync(resolve(dirname(runtime), 'bin/workerd'), ['--version'], { stdio: 'inherit' });
NODE
# Hosted runners supply the base tools. Only the XML validation journeys need
# this additional package; do not update apt on every shard on every run.
if [ "${LAMP_CI_XML:-false}" = true ] && ! command -v xmllint >/dev/null; then
  sudo timeout 90 apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update
  sudo timeout 120 env DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 install -y --no-install-recommends libxml2-utils
fi
