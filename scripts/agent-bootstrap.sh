#!/usr/bin/env bash
set -euo pipefail

# Lamp's pinned runtime (the seed command contract's Node and pnpm).
readonly NODE_VERSION=22.20.0
readonly PNPM_VERSION=10.12.4
readonly PLAYWRIGHT_VERSION=1.55.0
readonly WORKERD_VERSION=1.20260907.1
readonly BIN_DIR=/usr/local/bin

fail() { printf 'Bootstrap: %s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Linux ]] || fail 'requires Linux (Ubuntu/Debian with apt-get).'
command -v apt-get >/dev/null || fail 'requires apt-get for browser OS dependencies.'
[[ "$PATH" == "$BIN_DIR":* ]] || fail "put ${BIN_DIR} first on the calling shell PATH before running bootstrap."
if [[ $(id -u) == 0 ]]; then
  root=()
else
  command -v sudo >/dev/null || fail 'requires root or passwordless sudo.'
  sudo -n true || fail 'requires passwordless sudo for system packages and shared binaries.'
  root=(sudo -n)
fi
case $(uname -m) in
  x86_64)
    arch=x64
    node_checksum=eeaccb0378b79406f2208e8b37a62479c70595e20be6b659125eb77dd1ab2a29 ;;
  aarch64|arm64)
    arch=arm64
    node_checksum=4181609e03dcb9880e7e5bf956061ecc0503c77a480c6631d868cb1f65a2c7dd ;;
  *) fail 'supported Linux architectures are x86_64 and aarch64.' ;;
esac
readonly node_home="/opt/rer-agent-tools/node-v${NODE_VERSION}-linux-${arch}"
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
readonly repo_root
cd "$repo_root"

"${root[@]}" apt-get update
"${root[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  ca-certificates curl git libatomic1 libxml2-utils python3 tar unzip
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
install_node() {
  local version=$1 checksum=$2 destination=$3 archive
  if [[ ! -x "$destination/bin/node" ]] || [[ $("$destination/bin/node" --version) != "v${version}" ]]; then
    archive="node-v${version}-linux-${arch}.tar.gz"
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
      "https://nodejs.org/dist/v${version}/${archive}" -o "$scratch/$archive"
    printf '%s  %s\n' "$checksum" "$scratch/$archive" | sha256sum --check --strict
    "${root[@]}" mkdir -p /opt/rer-agent-tools
    "${root[@]}" tar -xzf "$scratch/$archive" -C /opt/rer-agent-tools
  fi
}
install_node "$NODE_VERSION" "$node_checksum" "$node_home"
"${root[@]}" mkdir -p "$BIN_DIR"
for command_name in node npm npx; do
  "${root[@]}" ln -sfn "$node_home/bin/$command_name" "$BIN_DIR/$command_name"
done
hash -r
[[ $(node --version) == "v${NODE_VERSION}" ]] || fail 'another Node shadows the installed runtime.'
if [[ ! -x "$node_home/bin/pnpm" ]] || [[ $("$node_home/bin/pnpm" --version) != "$PNPM_VERSION" ]]; then
  "${root[@]}" "$node_home/bin/node" "$node_home/lib/node_modules/npm/bin/npm-cli.js" \
    install --global --prefix "$node_home" "pnpm@${PNPM_VERSION}" --no-audit --no-fund
fi
"${root[@]}" ln -sfn "$node_home/bin/pnpm" "$BIN_DIR/pnpm"
hash -r
[[ $(pnpm --version) == "$PNPM_VERSION" ]] || fail 'another pnpm shadows the installed package manager.'
# /usr/local/bin persists in the caller and across CI steps, without sourcing.
if [[ -n ${GITHUB_PATH:-} ]]; then printf '%s\n' "$BIN_DIR" >> "$GITHUB_PATH"; fi

# Retain the default shared pnpm and Playwright stores; frozen install runs the
# real locked native installers allowed in package.json (workerd and esbuild).
pnpm install --frozen-lockfile
PLAYWRIGHT_SKIP_BROWSER_GC=1 node node_modules/playwright/cli.js install --with-deps chromium
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
const require = createRequire(realpathSync('node_modules/wrangler/package.json'))
const runtime = require.resolve('workerd/package.json')
assert.equal(require(runtime).version, '1.20260907.1')
execFileSync(resolve(dirname(runtime), 'bin/workerd'), ['--version'], { stdio: 'inherit' })
const browserRequire = createRequire(resolve('package.json'))
assert.equal(browserRequire('playwright/package.json').version, '1.55.0')
const { chromium } = browserRequire('playwright')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto('data:text/html,<title>Bootstrap browser probe</title>')
  assert.equal(await page.title(), 'Bootstrap browser probe')
  console.log(`Chromium ${browser.version()} launched successfully`)
} finally {
  await browser.close()
}
NODE
printf 'Ready: Node %s; pnpm %s; Playwright %s; workerd %s\n' \
  "$NODE_VERSION" "$PNPM_VERSION" "$PLAYWRIGHT_VERSION" "$WORKERD_VERSION"
printf 'Verify from the repository root: pnpm verify\n'
