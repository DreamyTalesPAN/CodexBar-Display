#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLED_BIN="${VIBEBLOCK_BIN:-$HOME/Library/Application Support/vibeblock/bin/vibeblock}"

if [[ -x "$INSTALLED_BIN" ]]; then
  exec "$INSTALLED_BIN" upgrade "$@"
fi

cd "$ROOT_DIR/companion"
exec go run ./cmd/vibeblock upgrade "$@"
