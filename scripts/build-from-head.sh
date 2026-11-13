#!/bin/bash
# Build SquatClient from the COMMITTED HEAD of both repos (uncommitted work in progress is ignored,
# so a build can never pick up half-finished edits) and install it at build/bin/squatclient.app.
# That one path is always the newest build. Usage: scripts/build-from-head.sh [--open]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENG="$ROOT/../squatClientDaemon"
WAILS="${WAILS:-$HOME/go/bin/wails}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/squatClient" "$TMP/squatClientDaemon"
git -C "$ROOT" archive HEAD | tar -x -C "$TMP/squatClient"
git -C "$ENG" archive HEAD | tar -x -C "$TMP/squatClientDaemon"
echo "building client $(git -C "$ROOT" rev-parse --short HEAD) + engine $(git -C "$ENG" rev-parse --short HEAD)"
(cd "$TMP/squatClient/frontend" && npm ci --no-audit --no-fund >/dev/null)
(cd "$TMP/squatClient" && "$WAILS" build 2>&1 | grep -E "Built|ERR|rror" || true)
APP="$ROOT/build/bin/squatclient.app"
mkdir -p "$ROOT/build/bin"
rm -rf "$APP"
ditto "$TMP/squatClient/build/bin/squatclient.app" "$APP"
echo "installed: $APP ($(stat -f '%Sm' "$APP"))"
[ "${1:-}" = "--open" ] && open "$APP"
exit 0
