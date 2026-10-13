#!/usr/bin/env bash
# Isolated development preview: no installed-app or device state is loaded.
set -euo pipefail
preview_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for port in 3015 47852; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop the existing preview or process first."
    exit 1
  fi
done
command -v go >/dev/null || { echo "Go is required."; exit 1; }
command -v node >/dev/null || { echo "Node.js is required."; exit 1; }
if [[ ! -d "$preview_root/apps/control-center/node_modules" ]]; then
  (cd "$preview_root/apps/control-center" && npm ci --no-audit --no-fund)
fi
preview_build="$(mktemp -d -t vibetv-ai-preview)"
(cd "$preview_root/companion" && go build -o "$preview_build/theme-studio-preview" ./cmd/theme-studio-preview)
helper_pid=""
web_pid=""
stop_preview() {
  trap - EXIT INT TERM
  [[ -z "$web_pid" ]] || kill "$web_pid" 2>/dev/null || true
  [[ -z "$helper_pid" ]] || kill "$helper_pid" 2>/dev/null || true
  wait 2>/dev/null || true
  # Remove only this invocation's known binary and now-empty temporary directory.
  rm -f "$preview_build/theme-studio-preview"
  rmdir "$preview_build" 2>/dev/null || true
}
trap stop_preview EXIT
trap 'exit 0' INT TERM
VIBETV_AI_THEME_ENABLED=1 "$preview_build/theme-studio-preview" &
helper_pid=$!
(
  cd "$preview_root/apps/control-center"
  exec env VIBETV_AI_THEME_PREVIEW=1 node node_modules/next/dist/bin/next dev --hostname localhost --port 3015
) &
web_pid=$!
echo "Theme Studio: http://localhost:3015/internal/theme-studio-preview"
echo "Leave this terminal open. Ctrl-C stops both processes and forgets the API key."
wait "$web_pid"
