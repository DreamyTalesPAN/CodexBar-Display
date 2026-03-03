#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLED_BIN="${CODEXBAR_DISPLAY_BIN:-$HOME/Library/Application Support/codexbar-display/bin/codexbar-display}"

if [[ -x "$INSTALLED_BIN" ]]; then
  exec "$INSTALLED_BIN" upgrade "$@"
fi

cd "$ROOT_DIR/companion"
exec go run ./cmd/codexbar-display upgrade "$@"
