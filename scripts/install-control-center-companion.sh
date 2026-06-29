#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPANION_DIR="$ROOT_DIR/companion"
APP_SUPPORT_DIR="$HOME/Library/Application Support/codexbar-display"
BIN_DIR="$APP_SUPPORT_DIR/bin"
BIN_PATH="$BIN_DIR/codexbar-display"
RUN_DIR="$APP_SUPPORT_DIR/run"
PID_PATH="$RUN_DIR/companion-api.pid"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.codexbar-display.companion-api.plist"
SERVICE_LABEL="com.codexbar-display.companion-api"
SERVICE="gui/$(id -u)/${SERVICE_LABEL}"
GLOBAL_PLIST_PATH="${VIBETV_COMPANION_GLOBAL_PLIST:-/Library/LaunchAgents/${SERVICE_LABEL}.plist}"
DISPLAY_DAEMON_LABEL="com.codexbar-display.daemon"
DISPLAY_DAEMON_PLIST="$PLIST_DIR/${DISPLAY_DAEMON_LABEL}.plist"
DISPLAY_DAEMON_SERVICE="gui/$(id -u)/${DISPLAY_DAEMON_LABEL}"
DISPLAY_DAEMON_LOG_OUT="/tmp/codexbar-display-daemon.out.log"
DISPLAY_DAEMON_LOG_ERR="/tmp/codexbar-display-daemon.err.log"
ADDR="${VIBETV_COMPANION_ADDR:-127.0.0.1:47832}"
DEV_ORIGIN="${VIBETV_COMPANION_DEV_ORIGIN:-}"
TARGET="${VIBETV_COMPANION_TARGET:-http://vibetv.local}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: this installer currently supports macOS only" >&2
  exit 1
fi

if ! command -v go >/dev/null 2>&1; then
  echo "error: Go is required to build the Companion binary" >&2
  echo "hint: install Go, then rerun this script" >&2
  exit 1
fi

stop_launchagent() {
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
    if [[ -f "$GLOBAL_PLIST_PATH" ]]; then
      launchctl disable "$SERVICE" >/dev/null 2>&1 || true
      echo "old Mac setup service disabled for this user"
    fi
  fi
  rm -f "$PLIST_PATH"
}

stop_terminal_service() {
  if [[ ! -f "$PID_PATH" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "$PID_PATH" 2>/dev/null || true)"
  rm -f "$PID_PATH"
  if [[ -z "$pid" ]]; then
    return 0
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      if ! kill -0 "$pid" >/dev/null 2>&1; then
        return 0
      fi
      sleep 0.1
    done
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
}

stop_existing_listener() {
  command -v lsof >/dev/null 2>&1 || return 0

  local port pids pid command_line
  port="${ADDR##*:}"
  [[ "$port" =~ ^[0-9]+$ ]] || return 0
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$pids" ]] || return 0

  for pid in $pids; do
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command_line" == *"codexbar-display"* ]]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  printf '%s' "$value"
}

write_daemon_plist() {
  local daemon_args=("$BIN_PATH" "daemon" "--interval" "30s" "--transport" "wifi" "--target" "$TARGET" "--api-addr" "$ADDR")
  if [[ -n "$DEV_ORIGIN" ]]; then
    daemon_args+=("--api-dev-origin" "$DEV_ORIGIN")
  fi

  mkdir -p "$PLIST_DIR"
  {
    cat <<PLIST_HEAD
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${DISPLAY_DAEMON_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
PLIST_HEAD

    for arg in "${daemon_args[@]}"; do
      printf '      <string>%s</string>\n' "$(xml_escape "$arg")"
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
    <string>${DISPLAY_DAEMON_LOG_OUT}</string>

    <key>StandardErrorPath</key>
    <string>${DISPLAY_DAEMON_LOG_ERR}</string>
  </dict>
</plist>
PLIST_TAIL
  } > "$DISPLAY_DAEMON_PLIST"

  chmod 644 "$DISPLAY_DAEMON_PLIST"
}

mkdir -p "$BIN_DIR"

echo "building Companion binary"
(cd "$COMPANION_DIR" && go build -o "$BIN_PATH" ./cmd/codexbar-display)
chmod 755 "$BIN_PATH"

stop_launchagent
stop_terminal_service
stop_existing_listener

if ! command -v launchctl >/dev/null 2>&1; then
  echo "error: launchctl is required to start the VibeTV Mac App background service" >&2
  exit 1
fi

write_daemon_plist
launchctl bootout "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1 || true
launchctl enable "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1 || true
if ! launchctl bootstrap "gui/$(id -u)" "$DISPLAY_DAEMON_PLIST" >/dev/null 2>&1; then
  if ! launchctl print "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1; then
    echo "error: failed to load the VibeTV Mac App background service" >&2
    exit 1
  fi
fi
launchctl kickstart -k "$DISPLAY_DAEMON_SERVICE" >/dev/null

echo "waiting for Mac setup service at http://$ADDR/v1/status"
for _ in $(seq 1 20); do
  if curl -fsS "http://$ADDR/v1/status" >/dev/null 2>&1; then
    echo "Mac setup service is running"
    echo "service: $DISPLAY_DAEMON_SERVICE"
    echo "logs: $DISPLAY_DAEMON_LOG_OUT / $DISPLAY_DAEMON_LOG_ERR"
    exit 0
  fi
  sleep 0.5
done

echo "error: Mac setup service did not answer on http://$ADDR/v1/status" >&2
echo "hint: inspect $DISPLAY_DAEMON_LOG_ERR" >&2
exit 1
