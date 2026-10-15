#!/usr/bin/env bash
set -euo pipefail
# The trusted builder supplies pinned Node and pnpm; install frozen project dependencies.
if [[ "$(node --version)" != v22.20.0 ]]; then
  echo 'Lamp requires Node 22.20.0 in the trusted project build.' >&2
  exit 1
fi
pnpm install --frozen-lockfile
