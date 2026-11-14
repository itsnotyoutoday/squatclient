#!/usr/bin/env bash
# Runs the SquatClient <-> gtf compatibility test (internal/app/gtf_integration_test.go) against a
# REAL gtf binary under a pty with a scratch HOME.
#
#   scripts/gtf-integration.sh                 # builds gtf from $GTF_SRC (default ../gtf) into a temp dir
#   GTF_BIN=/path/to/gtf scripts/gtf-integration.sh   # use an existing binary
#
# Nothing in the gtf source tree is modified (the binary is built to a temp path with GOWORK=off).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${GTF_BIN:-}" ]; then
  src="${GTF_SRC:-../gtf}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  (cd "$src" && GOWORK=off go build -o "$tmp/gtf" ./cmd/gtf)
  export GTF_BIN="$tmp/gtf"
fi
export GOWORK=off
exec go test ./internal/app -run 'TestGTF' -count=1 -v "$@"
