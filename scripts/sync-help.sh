#!/usr/bin/env bash
# Copy the authoritative scripting docs from the ENGINE repo into the front end.
#
#   scripts/sync-help.sh [path-to-squatClientDaemon]
#
# The engine repo (default ../squatClientDaemon, or $SQUAT_ENGINE_DIR) owns
# TF-LANGUAGE.md, TF-COMPAT.md and LUA-API.md. We keep a committed copy in
# frontend/src/help/imported/ so builds work without the engine checkout; run
# this script after those docs change, review the diff, and commit it.
# The topic files and search index are then rebuilt by `npm run help:build`
# (also run automatically by predev / prebuild / pretest).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
engine="${1:-${SQUAT_ENGINE_DIR:-$here/../squatClientDaemon}}"
src="$engine/docs"
dst="$here/frontend/src/help/imported"
files=(TF-LANGUAGE.md TF-COMPAT.md LUA-API.md)

if [ ! -d "$src" ]; then
  echo "sync-help: engine docs not found at $src" >&2
  echo "sync-help: keeping the committed copy in $dst (set SQUAT_ENGINE_DIR or pass a path)" >&2
  exit 0
fi

mkdir -p "$dst"
for f in "${files[@]}"; do
  if [ ! -f "$src/$f" ]; then
    echo "sync-help: missing $src/$f" >&2
    exit 1
  fi
  cp "$src/$f" "$dst/$f"
  echo "synced $f"
done

if command -v node >/dev/null 2>&1 && [ -f "$here/frontend/package.json" ]; then
  (cd "$here/frontend" && node src/help/build/build-help.mjs)
fi
