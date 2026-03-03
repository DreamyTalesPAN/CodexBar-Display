#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-8765}"
URL="http://127.0.0.1:${PORT}/tools/theme-preview/mini-theme-preview.html"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required for the local preview server" >&2
  exit 1
fi

echo "Mini theme preview:"
echo "  ${URL}"
echo "Press Ctrl+C to stop."

( sleep 1; open "${URL}" >/dev/null 2>&1 || true ) &

cd "${ROOT_DIR}"
exec python3 -m http.server "${PORT}" --bind 127.0.0.1
