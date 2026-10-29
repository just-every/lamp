#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?RUNNER_TEMP is required for CI caches}"
: "${PLAYWRIGHT_BROWSERS_PATH:?Set the runner-owned browser cache before restoring it}"
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" "$RUNNER_TEMP/rer-apt/archives"
pnpm exec playwright install chromium
# Keep Lamp's real launch and page assertion. Permission errors cannot be
# repaired by installing libraries, and must never mutate a HOME cache via sudo.
probe_log="$RUNNER_TEMP/lamp-chromium-probe.log"
if pnpm exec node scripts/chromium-probe.mjs > "$probe_log" 2>&1; then
  cat "$probe_log"
else
  status=$?
  cat "$probe_log"
  if rg -qi 'EACCES|permission denied' "$probe_log"; then exit "$status"; fi
  sudo env "PATH=$PATH" "APT_ARCHIVES=$RUNNER_TEMP/rer-apt/archives" python3 scripts/install-chromium-deps.py
  pnpm exec node scripts/chromium-probe.mjs
fi
