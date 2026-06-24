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

stop_launchagent() {
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
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

mkdir -p "$BIN_DIR"

echo "building Companion binary"
(cd "$COMPANION_DIR" && go build -o "$BIN_PATH" ./cmd/codexbar-display)
chmod 755 "$BIN_PATH"

api_args=("$BIN_PATH" "api" "--addr" "$ADDR")
if [[ -n "$DEV_ORIGIN" ]]; then
  api_args+=("--dev-origin" "$DEV_ORIGIN")
fi

stop_launchagent
stop_terminal_service
stop_existing_listener

mkdir -p "$RUN_DIR"
: > "$LOG_OUT"
: > "$LOG_ERR"
nohup "${api_args[@]}" >>"$LOG_OUT" 2>>"$LOG_ERR" &
printf '%s\n' "$!" > "$PID_PATH"
disown "$!" >/dev/null 2>&1 || true

echo "waiting for Mac setup service at http://$ADDR/v1/status"
for _ in $(seq 1 20); do
  if curl -fsS "http://$ADDR/v1/status" >/dev/null 2>&1; then
    echo "Mac setup service is running"
    echo "pid: $(cat "$PID_PATH")"
    echo "logs: $LOG_OUT / $LOG_ERR"
    exit 0
  fi
  sleep 0.5
done

echo "error: Mac setup service did not answer on http://$ADDR/v1/status" >&2
echo "hint: inspect $LOG_ERR" >&2
exit 1
