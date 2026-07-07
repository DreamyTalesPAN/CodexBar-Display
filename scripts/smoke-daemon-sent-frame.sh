#!/usr/bin/env bash
set -euo pipefail

PLIST_PATH="${1:-$HOME/Library/LaunchAgents/com.codexbar-display.daemon.plist}"
LOG_PATH="${2:-$HOME/Library/Application Support/codexbar-display/logs/daemon.out.log}"
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
SERVICE="$DOMAIN/com.codexbar-display.daemon"

service_present() {
  launchctl print "$SERVICE" >/dev/null 2>&1
}

wait_for_service_state() {
  local want_present="$1"
  local timeout_secs="$2"
  local deadline=$((SECONDS + timeout_secs))

  while (( SECONDS < deadline )); do
    if service_present; then
      [[ "$want_present" == "present" ]] && return 0
    else
      [[ "$want_present" == "absent" ]] && return 0
    fi
    sleep 1
  done

  if service_present; then
    [[ "$want_present" == "present" ]] && return 0
  else
    [[ "$want_present" == "absent" ]] && return 0
  fi
  return 1
}

baseline_count="$(rg -c "sent frame ->" "$LOG_PATH" 2>/dev/null || true)"
if [[ -z "$baseline_count" ]]; then
  baseline_count=0
fi

echo "smoke: restarting launch agent $SERVICE"
launchctl bootout "$SERVICE" 2>/dev/null || true
wait_for_service_state absent 10 || true

bootstrap_output=""
if ! bootstrap_output="$(launchctl bootstrap "$DOMAIN" "$PLIST_PATH" 2>&1)"; then
  if ! service_present; then
    echo "smoke: fail (bootstrap failed)" >&2
    printf '%s\n' "$bootstrap_output" >&2
    exit 1
  fi
fi

if ! wait_for_service_state present 10; then
  echo "smoke: fail (service did not appear after bootstrap)" >&2
  launchctl print "$SERVICE" 2>&1 || true
  exit 1
fi

kickstart_output=""
if ! kickstart_output="$(launchctl kickstart -k "$SERVICE" 2>&1)"; then
  if ! service_present; then
    echo "smoke: fail (kickstart failed and service missing)" >&2
    printf '%s\n' "$kickstart_output" >&2
    exit 1
  fi
  echo "smoke: warning (kickstart returned non-zero, continuing with service state check)" >&2
  printf '%s\n' "$kickstart_output" >&2
fi

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
launchctl print "$SERVICE" 2>&1 || true
echo "log tail:" >&2
tail -n 50 "$LOG_PATH" >&2 || true
exit 1
