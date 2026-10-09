#!/usr/bin/env bash
set -euo pipefail
# Credential-free Ubuntu trusted-build candidate setup. Installs project-owned tools.
if [[ "$(node --version)" != v26.8.1 ]]; then
  echo 'Lamp requires Node 26.8.1 in the trusted project build.' >&2
  exit 1
fi
npm install --global pnpm@8.15.6
pnpm install --frozen-lockfile
sudo apt-get update
sudo apt-get install -y libxml2-utils
# Playwright 1.55 archive extraction requires Node 22; runtime checks use Node 26.
npm exec --yes --package=node@22 -- node node_modules/playwright/cli.js install --with-deps chromium
