#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPANION_DIR="$ROOT_DIR/companion"
APP_SUPPORT_DIR="$HOME/Library/Application Support/codexbar-display"
BIN_DIR="$APP_SUPPORT_DIR/bin"
BIN_PATH="$BIN_DIR/codexbar-display"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.codexbar-display.companion-api.plist"
SERVICE="gui/$(id -u)/com.codexbar-display.companion-api"
LOG_OUT="/tmp/codexbar-display-companion-api.out.log"
LOG_ERR="/tmp/codexbar-display-companion-api.err.log"
ADDR="${VIBETV_COMPANION_ADDR:-127.0.0.1:47832}"
DEV_ORIGIN="${VIBETV_COMPANION_DEV_ORIGIN:-}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: this installer currently supports macOS only" >&2
  exit 1
fi

if ! command -v go >/dev/null 2>&1; then
  echo "error: Go is required to build the Companion binary" >&2
  echo "hint: install Go, then rerun this script" >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$PLIST_DIR"

echo "building Companion binary"
(cd "$COMPANION_DIR" && go build -o "$BIN_PATH" ./cmd/codexbar-display)
chmod 755 "$BIN_PATH"

api_args=("$BIN_PATH" "api" "--addr" "$ADDR")
if [[ -n "$DEV_ORIGIN" ]]; then
  api_args+=("--dev-origin" "$DEV_ORIGIN")
fi

{
  cat <<PLIST_HEAD
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.codexbar-display.companion-api</string>

    <key>ProgramArguments</key>
    <array>
PLIST_HEAD

  for arg in "${api_args[@]}"; do
    escaped="${arg//&/&amp;}"
    escaped="${escaped//</&lt;}"
    escaped="${escaped//>/&gt;}"
    escaped="${escaped//\"/&quot;}"
    printf '      <string>%s</string>\n' "$escaped"
  done

  cat <<PLIST_TAIL
    </array>

    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$LOG_OUT</string>

    <key>StandardErrorPath</key>
    <string>$LOG_ERR</string>
  </dict>
</plist>
PLIST_TAIL
} > "$PLIST_PATH"

chmod 644 "$PLIST_PATH"

launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
launchctl enable "$SERVICE" >/dev/null 2>&1 || true
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1; then
  if ! launchctl print "$SERVICE" >/dev/null 2>&1; then
    echo "error: failed to load Companion LaunchAgent" >&2
    echo "hint: inspect $LOG_ERR and rerun this script" >&2
    exit 1
  fi
fi
launchctl kickstart -k "$SERVICE" >/dev/null

echo "waiting for Companion API at http://$ADDR/v1/status"
for _ in $(seq 1 20); do
  if curl -fsS "http://$ADDR/v1/status" >/dev/null 2>&1; then
    echo "Companion API is running"
    echo "service: $SERVICE"
    echo "plist: $PLIST_PATH"
    echo "logs: $LOG_OUT / $LOG_ERR"
    exit 0
  fi
  sleep 0.5
done

echo "error: Companion API did not answer on http://$ADDR/v1/status" >&2
echo "hint: inspect $LOG_ERR" >&2
exit 1
