#!/usr/bin/env bash
# Build the front end, serve it, and check the help rendering in a real WKWebView. macOS only.
#   scripts/webkit-probe/run.sh [topic-id ...]     (default: home scripting compat lua keys)
set -euo pipefail
if [ "$(uname -s)" != "Darwin" ] || ! command -v swiftc >/dev/null 2>&1; then
  echo "webkit-probe: skipped (needs macOS with swiftc)"
  exit 0
fi
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fe="$here/../.."
tmp="$(mktemp -d)"
trap 'kill "${srv:-0}" 2>/dev/null || true; rm -rf "$tmp"' EXIT
port="${PORT:-$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')}"
(cd "$fe" && npm run help:build >/dev/null && npx vite build --outDir "$tmp/dist" --emptyOutDir >/dev/null)
swiftc -O "$here/help-probe.swift" -o "$tmp/help-probe"
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$tmp/dist" >/dev/null 2>&1 &
srv=$!
sleep 1
"$tmp/help-probe" "http://127.0.0.1:$port/index.html?mock=1" "$@"
