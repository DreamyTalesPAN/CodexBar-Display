#!/usr/bin/env bash
set -euo pipefail

PLIST_PATH="${1:-$HOME/Library/LaunchAgents/com.vibeblock.daemon.plist}"
LOG_PATH="${2:-/tmp/vibeblock-daemon.out.log}"
TIMEOUT_SECS="${3:-90}"
POLL_SECS=3

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "error: LaunchAgent plist not found: $PLIST_PATH" >&2
  exit 1
fi

if ! [[ "$TIMEOUT_SECS" =~ ^[0-9]+$ ]] || (( TIMEOUT_SECS <= 0 )); then
  echo "error: timeout must be a positive integer, got '$TIMEOUT_SECS'" >&2
  exit 1
fi

DOMAIN="gui/$(id -u)"
SERVICE="$DOMAIN/com.vibeblock.daemon"

baseline_count="$(rg -c "sent frame ->" "$LOG_PATH" 2>/dev/null || true)"
if [[ -z "$baseline_count" ]]; then
  baseline_count=0
fi

echo "smoke: restarting launch agent $SERVICE"
launchctl bootout "$SERVICE" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST_PATH" 2>/dev/null || true
launchctl kickstart -k "$SERVICE"

deadline=$((SECONDS + TIMEOUT_SECS))
while (( SECONDS < deadline )); do
  current_count="$(rg -c "sent frame ->" "$LOG_PATH" 2>/dev/null || true)"
  if [[ -z "$current_count" ]]; then
    current_count=0
  fi
  if (( current_count > baseline_count )); then
    echo "smoke: ok (new sent frame detected)"
    rg "sent frame ->" "$LOG_PATH" | tail -n 1
    exit 0
  fi
  sleep "$POLL_SECS"
done

echo "smoke: fail (no new 'sent frame ->' line within ${TIMEOUT_SECS}s)" >&2
echo "log tail:" >&2
tail -n 50 "$LOG_PATH" >&2 || true
exit 1
