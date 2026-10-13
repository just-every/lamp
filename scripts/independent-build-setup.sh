#!/usr/bin/env bash
set -euo pipefail
# Credential-free Ubuntu trusted-build candidate setup. Installs project-owned tools.
if [[ "$(node --version)" != v22.20.0 ]]; then
  echo 'Lamp requires Node 22.20.0 in the trusted project build.' >&2
  exit 1
fi
npm install --global pnpm@10.12.4
pnpm install --frozen-lockfile
sudo apt-get update
sudo apt-get install -y libxml2-utils
node node_modules/playwright/cli.js install --with-deps chromium
