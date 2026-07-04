#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="DreamyTalesPAN/CodexBar-Display"
GITHUB_API_BASE="https://api.github.com"
GITHUB_DOWNLOAD_BASE="https://github.com"
INSTALL_NAME="codexbar-display"
APP_SUPPORT_DIR="${HOME}/Library/Application Support/codexbar-display"
BIN_DIR="${APP_SUPPORT_DIR}/bin"
BIN_PATH="${BIN_DIR}/${INSTALL_NAME}"
RUN_DIR="${APP_SUPPORT_DIR}/run"
PID_PATH="${RUN_DIR}/companion-api.pid"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/com.codexbar-display.companion-api.plist"
SERVICE_LABEL="com.codexbar-display.companion-api"
SERVICE="gui/$(id -u)/${SERVICE_LABEL}"
GLOBAL_PLIST_PATH="${VIBETV_COMPANION_GLOBAL_PLIST:-/Library/LaunchAgents/${SERVICE_LABEL}.plist}"
DISPLAY_DAEMON_LABEL="com.codexbar-display.daemon"
DISPLAY_DAEMON_PLIST="${PLIST_DIR}/${DISPLAY_DAEMON_LABEL}.plist"
DISPLAY_DAEMON_SERVICE="gui/$(id -u)/${DISPLAY_DAEMON_LABEL}"
DISPLAY_DAEMON_LOG_OUT="/tmp/codexbar-display-daemon.out.log"
DISPLAY_DAEMON_LOG_ERR="/tmp/codexbar-display-daemon.err.log"
CONFIG_PATH="${APP_SUPPORT_DIR}/config.json"

REPO="${VIBETV_COMPANION_REPO:-$DEFAULT_REPO}"
RELEASE_VERSION="${VIBETV_COMPANION_VERSION:-}"
ADDR="${VIBETV_COMPANION_ADDR:-127.0.0.1:47832}"
DEV_ORIGIN="${VIBETV_COMPANION_DEV_ORIGIN:-}"
TARGET="${VIBETV_COMPANION_TARGET:-}"
TARGET_EXPLICIT=0
if [[ -n "${VIBETV_COMPANION_TARGET:-}" ]]; then
  TARGET_EXPLICIT=1
fi
SKIP_DEVICE_SETUP=0
REPAIR_MAX_ATTEMPTS="${VIBETV_COMPANION_REPAIR_ATTEMPTS:-45}"
REPAIR_RETRY_DELAY="${VIBETV_COMPANION_REPAIR_RETRY_DELAY:-2}"
MODE="install"
START_MODE="${VIBETV_COMPANION_START_MODE:-terminal}"
OPEN_CONTROL_CENTER="${VIBETV_COMPANION_OPEN_CONTROL_CENTER:-1}"
CONTROL_CENTER_PATH="${VIBETV_COMPANION_CONTROL_CENTER_PATH:-/control-center}"
TMPDIR_INSTALL=""
DOWNLOAD_BIN=""
CHECKSUMS_FILE=""
ARCH=""
BINARY_ARCH=""
RELEASE_TAG=""

usage() {
  cat <<'EOF'
Usage:
  install-control-center-companion.sh [--repo owner/name] [--version x.y.z] [--addr 127.0.0.1:47832] [--target http://<device-ip>] [--control-center-path /control-center] [--skip-device-setup]
  install-control-center-companion.sh --restart
  install-control-center-companion.sh --uninstall

What it does:
  - downloads the matching codexbar-display macOS release binary
  - verifies the release checksum
  - installs the binary under ~/Library/Application Support/codexbar-display/bin
  - stops the old standalone Mac setup service if it exists
  - starts the normal VibeTV Mac App background service
  - verifies http://127.0.0.1:47832/v1/status
  - connects VibeTV and installs the latest firmware when available
  - opens the local Control Center at http://127.0.0.1:47832/control-center

Examples:
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --restart

The Mac setup service runs inside the normal VibeTV Mac App background service
so the customer has one local Mac App process.
EOF
}

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  printf 'support: status: curl -fsS http://%s/v1/status\n' "$ADDR" >&2
  printf 'support: report: curl -fsS http://%s/v1/diagnostics\n' "$ADDR" >&2
  printf 'support: logs: %s / %s\n' "$DISPLAY_DAEMON_LOG_OUT" "$DISPLAY_DAEMON_LOG_ERR" >&2
  exit 1
}

require_cmd_for() {
  local cmd="$1"
  local why="$2"
  local action="$3"

  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'error: missing dependency: %s\n' "$cmd" >&2
    printf 'needed for: %s\n' "$why" >&2
    printf 'next step: %s\n' "$action" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "${TMPDIR_INSTALL}" && -d "${TMPDIR_INSTALL}" ]]; then
    rm -rf "${TMPDIR_INSTALL}"
  fi
}

normalize_version() {
  local version="$1"
  version="${version#v}"
  if [[ -z "$version" ]]; then
    die "version cannot be empty"
  fi
  printf '%s\n' "$version"
}

normalize_control_center_path() {
  local path="$1"
  if [[ -z "$path" ]]; then
    path="/control-center"
  fi
  case "$path" in
    /control-center|/control-center/*)
      printf '%s\n' "$path"
      ;;
    *)
      die "invalid control center path: $path"
      ;;
  esac
}

fetch_latest_release_tag() {
  local response tag
  response="$(
    curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 10 \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -H "User-Agent: vibetv-companion-install" \
      "${GITHUB_API_BASE}/repos/${REPO}/releases/latest"
  )"
  tag="$(printf '%s' "$response" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  if [[ -z "$tag" ]]; then
    die "could not determine latest release tag for ${REPO}"
  fi
  printf '%s\n' "$tag"
}

download_file() {
  local url="$1"
  local out="$2"

  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 10 --max-time 600 \
    -o "$out" \
    "$url"
}

verify_checksum() {
  local expected actual
  expected="$(grep -F "${INSTALL_NAME}-darwin-${BINARY_ARCH}-v${RELEASE_VERSION}" "$CHECKSUMS_FILE" | awk '{print $1}' | head -n 1 || true)"
  if [[ -z "$expected" ]]; then
    die "checksum entry not found for ${DOWNLOAD_BIN##*/}"
  fi

  actual="$(shasum -a 256 "$DOWNLOAD_BIN" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    die "checksum mismatch for ${DOWNLOAD_BIN##*/}"
  fi
}

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  printf '%s' "$value"
}

runtime_config_target() {
  [[ -f "$CONFIG_PATH" ]] || return 0
  sed -n 's/.*"deviceTarget"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CONFIG_PATH" | head -n 1
}

daemon_target_for_plist() {
  if [[ -n "$TARGET" ]]; then
    printf '%s\n' "$TARGET"
    return 0
  fi
  runtime_config_target
}

write_plist() {
  local daemon_target
  daemon_target="$(daemon_target_for_plist)"

  local daemon_args=("$BIN_PATH" "daemon" "--interval" "30s" "--transport" "wifi" "--api-addr" "$ADDR")
  if [[ -n "$daemon_target" ]]; then
    daemon_args+=("--target" "$daemon_target")
  fi
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

restart_service() {
  if [[ ! -x "$BIN_PATH" ]]; then
    die "Mac setup binary is missing: ${BIN_PATH}. Run install first."
  fi

  require_cmd_for launchctl "start the VibeTV Mac App background service" "rerun from a standard macOS Terminal."
  stop_launchagent
  stop_terminal_service
  stop_existing_listener
  write_plist
  launchctl bootout "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1 || true
  launchctl enable "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1 || true
  if ! launchctl bootstrap "gui/$(id -u)" "$DISPLAY_DAEMON_PLIST" >/dev/null 2>&1; then
    if ! launchctl print "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1; then
      die "failed to load the VibeTV Mac App background service."
    fi
  fi
  launchctl kickstart -k "$DISPLAY_DAEMON_SERVICE" >/dev/null
}

wait_for_api() {
  log "vibetv: waiting for Mac setup service at http://${ADDR}/v1/status"
  for _ in $(seq 1 20); do
    if curl -fsS "http://${ADDR}/v1/status" >/dev/null 2>&1; then
      log "vibetv: Mac setup service is running"
      log "vibetv: service=${DISPLAY_DAEMON_SERVICE}"
      log "vibetv: logs=${DISPLAY_DAEMON_LOG_OUT} / ${DISPLAY_DAEMON_LOG_ERR}"
      return 0
    fi
    sleep 0.5
  done
  die "Mac setup service did not answer on http://${ADDR}/v1/status. Inspect ${DISPLAY_DAEMON_LOG_ERR}."
}

control_center_url() {
  printf 'http://%s%s\n' "$ADDR" "$CONTROL_CENTER_PATH"
}

open_control_center() {
  local url
  url="$(control_center_url)"
  if [[ "$OPEN_CONTROL_CENTER" != "1" ]]; then
    log "vibetv: Control Center is ready at ${url}"
    return 0
  fi
  log "vibetv: opening Control Center at ${url}"
  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || log "vibetv: open ${url}"
  else
    log "vibetv: open ${url}"
  fi
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

json_device_target() {
  sed -n 's/.*"device"[^{]*{[^}]*"target"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

json_api_field() {
  local field="$1"
  sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

status_field() {
  local object="$1"
  local field="$2"
  sed -n "s/.*\"${object}\"[^{]*{[^}]*\"${field}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

status_bool_field() {
  local object="$1"
  local field="$2"
  sed -n \
    -e "s/.*\"${object}\"[^{]*{[^}]*\"${field}\"[[:space:]]*:[[:space:]]*true.*/true/p" \
    -e "s/.*\"${object}\"[^{]*{[^}]*\"${field}\"[[:space:]]*:[[:space:]]*false.*/false/p" \
    | head -n 1
}

local_api_json() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"
  local response_file status_file stderr_file status curl_status
  response_file="${TMPDIR_INSTALL}/api-response.json"
  status_file="${TMPDIR_INSTALL}/api-status.txt"
  stderr_file="${TMPDIR_INSTALL}/api-stderr.txt"
  : > "$response_file"
  : > "$status_file"
  : > "$stderr_file"

  set +e
  if [[ -n "$payload" ]]; then
    curl -sS --connect-timeout 10 --max-time 90 \
      -o "$response_file" \
      -w "%{http_code}" \
      -X "$method" "http://${ADDR}${path}" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      > "$status_file" 2> "$stderr_file"
  else
    curl -sS --connect-timeout 10 --max-time 30 \
      -o "$response_file" \
      -w "%{http_code}" \
      -X "$method" "http://${ADDR}${path}" \
      > "$status_file" 2> "$stderr_file"
  fi
  curl_status=$?
  set -e

  status="$(cat "$status_file" 2>/dev/null || true)"
  if [[ "$curl_status" == "0" && "$status" =~ ^2[0-9][0-9]$ ]]; then
    cat "$response_file"
    return 0
  fi

  return 1
}

print_local_api_error() {
  local method="$1"
  local path="$2"
  local response_file="${TMPDIR_INSTALL}/api-response.json"
  local status_file="${TMPDIR_INSTALL}/api-status.txt"
  local stderr_file="${TMPDIR_INSTALL}/api-stderr.txt"
  local message next_action code stderr_text status
  status="$(cat "$status_file" 2>/dev/null || true)"
  message="$(json_api_field "message" < "$response_file")"
  next_action="$(json_api_field "nextAction" < "$response_file")"
  code="$(json_api_field "code" < "$response_file")"
  stderr_text="$(tr '\n' ' ' < "$stderr_file" | sed 's/[[:space:]]*$//')"

  printf 'error: Mac App API %s %s failed' "$method" "$path" >&2
  if [[ -n "$status" && "$status" != "000" ]]; then
    printf ' with HTTP %s' "$status" >&2
  fi
  printf '.\n' >&2
  [[ -z "$code" ]] || printf 'error code: %s\n' "$code" >&2
  [[ -z "$message" ]] || printf 'detail: %s\n' "$message" >&2
  [[ -z "$next_action" ]] || printf 'next step: %s\n' "$next_action" >&2
  [[ -z "$stderr_text" ]] || printf 'curl: %s\n' "$stderr_text" >&2
}

retryable_repair_failure() {
  local response_file="${TMPDIR_INSTALL}/api-response.json"
  local status_file="${TMPDIR_INSTALL}/api-status.txt"
  local stderr_file="${TMPDIR_INSTALL}/api-stderr.txt"
  local code status stderr_text
  status="$(cat "$status_file" 2>/dev/null || true)"
  code="$(json_api_field "code" < "$response_file")"
  stderr_text="$(tr '\n' ' ' < "$stderr_file" | tr '[:upper:]' '[:lower:]' || true)"

  [[ "$status" == "000" ]] && return 0
  [[ "$status" == "408" || "$status" == "429" ]] && return 0
  [[ "$status" =~ ^5[0-9][0-9]$ ]] && return 0
  [[ "$code" == "device_not_found" ]] && return 0
  [[ "$stderr_text" == *"timed out"* || "$stderr_text" == *"connection reset"* || "$stderr_text" == *"connection refused"* ]] && return 0
  return 1
}

recover_connected_device_from_status() {
  local response connected paired known_target
  response="$(local_api_json GET "/v1/status")" || return 1
  connected="$(printf '%s' "$response" | status_bool_field "device" "connected")"
  paired="$(printf '%s' "$response" | status_bool_field "device" "paired")"
  known_target="$(printf '%s' "$response" | json_device_target)"
  if [[ "$connected" == "true" && "$paired" == "true" && -n "$known_target" ]]; then
    TARGET="$known_target"
    log "vibetv: VibeTV is already connected at ${TARGET}"
    return 0
  fi
  return 1
}

connect_vibetv() {
  local payload response discovered_target saved_response saved_status saved_stderr
  if [[ "$TARGET_EXPLICIT" == "1" ]]; then
    payload="{\"target\":\"$(json_escape "$TARGET")\",\"forcePair\":true}"
    log "vibetv: connecting VibeTV at ${TARGET}"
  else
    payload="{\"forcePair\":true}"
    log "vibetv: discovering VibeTV on this WiFi"
  fi

  for attempt in $(seq 1 "$REPAIR_MAX_ATTEMPTS"); do
    if response="$(local_api_json POST "/v1/device/repair" "$payload")"; then
      break
    fi
    if [[ "$attempt" == "$REPAIR_MAX_ATTEMPTS" ]] || ! retryable_repair_failure; then
      saved_response="$(cat "${TMPDIR_INSTALL}/api-response.json" 2>/dev/null || true)"
      saved_status="$(cat "${TMPDIR_INSTALL}/api-status.txt" 2>/dev/null || true)"
      saved_stderr="$(cat "${TMPDIR_INSTALL}/api-stderr.txt" 2>/dev/null || true)"
      if recover_connected_device_from_status; then
        return 0
      fi
      printf '%s' "$saved_response" > "${TMPDIR_INSTALL}/api-response.json"
      printf '%s' "$saved_status" > "${TMPDIR_INSTALL}/api-status.txt"
      printf '%s' "$saved_stderr" > "${TMPDIR_INSTALL}/api-stderr.txt"
      print_local_api_error POST "/v1/device/repair"
      die "VibeTV could not connect. Keep VibeTV powered on and on the same WiFi, then rerun setup."
    fi
    log "vibetv: VibeTV did not answer yet; retrying (${attempt}/${REPAIR_MAX_ATTEMPTS})"
    sleep "$REPAIR_RETRY_DELAY"
  done

  discovered_target="$(printf '%s' "$response" | json_device_target)"
  if [[ -n "$discovered_target" ]]; then
    TARGET="$discovered_target"
  elif [[ -z "$TARGET" ]]; then
    die "VibeTV connected, but the Mac App did not return the device address. Rerun setup or use --target http://<device-ip>."
  fi
  log "vibetv: VibeTV is connected at ${TARGET}"
}

restart_service_with_discovered_target() {
  [[ -n "$TARGET" ]] || return 0
  log "vibetv: saving VibeTV address ${TARGET} for the background service"
  restart_service
  wait_for_api
  verify_companion_version
}

update_vibetv_firmware() {
  if [[ -z "$TARGET" ]]; then
    die "VibeTV firmware update needs a device address. Rerun setup or use --target http://<device-ip>."
  fi
  log "vibetv: starting VibeTV firmware update"
  "$BIN_PATH" install-update --target "$TARGET" --confirm-live-update \
    || die "VibeTV firmware update failed. Keep VibeTV powered on, then rerun setup."
  wait_for_api
  log "vibetv: VibeTV firmware update complete"
}

verify_companion_version() {
  local response version
  if ! response="$(local_api_json GET "/v1/status")"; then
    print_local_api_error GET "/v1/status"
    die "Mac setup service did not answer on http://${ADDR}/v1/status. Inspect ${DISPLAY_DAEMON_LOG_ERR}."
  fi
  version="$(printf '%s' "$response" | status_field "companion" "version")"
  if [[ "$version" == "$RELEASE_VERSION" ]]; then
    return 0
  fi

  log "vibetv: Mac App answered with version ${version:-unknown}; restarting once"
  restart_service
  wait_for_api
  if ! response="$(local_api_json GET "/v1/status")"; then
    print_local_api_error GET "/v1/status"
    die "Mac setup service did not answer on http://${ADDR}/v1/status after restart. Inspect ${DISPLAY_DAEMON_LOG_ERR}."
  fi
  version="$(printf '%s' "$response" | status_field "companion" "version")"
  [[ "$version" == "$RELEASE_VERSION" ]] \
    || die "Mac App version mismatch after restart: expected ${RELEASE_VERSION}, got ${version:-unknown}. Inspect ${DISPLAY_DAEMON_LOG_ERR}."
}

verify_final_status() {
  local response device_response status connected paired firmware
  if ! response="$(local_api_json GET "/v1/status")"; then
    print_local_api_error GET "/v1/status"
    die "Mac setup service did not answer for the final status check. Inspect ${DISPLAY_DAEMON_LOG_ERR}."
  fi
  status="$(printf '%s' "$response" | status_field "companion" "status")"
  [[ "$status" == "ready" ]] \
    || die "Mac App is not ready after setup. Inspect ${DISPLAY_DAEMON_LOG_ERR}."

  if ! device_response="$(local_api_json GET "/v1/device")"; then
    print_local_api_error GET "/v1/device"
    die "VibeTV is not reachable after setup. Run: curl http://${ADDR}/v1/status"
  fi
  connected="$(printf '%s' "$response" | status_bool_field "device" "connected")"
  paired="$(printf '%s' "$device_response" | status_bool_field "device" "paired")"
  firmware="$(printf '%s' "$device_response" | status_field "device" "firmware")"
  [[ "$connected" == "true" && "$paired" == "true" ]] \
    || die "VibeTV is not connected after setup. Run: curl http://${ADDR}/v1/status"
  [[ -n "$firmware" ]] \
    || die "VibeTV firmware version was not available after setup. Run: curl http://${ADDR}/v1/device"
  log "vibetv: setup verified; Mac App ready, VibeTV connected, firmware ${firmware}"
}

finish_device_setup() {
  connect_vibetv
  restart_service_with_discovered_target
  update_vibetv_firmware
  verify_final_status
}

install_binary() {
  mkdir -p "$BIN_DIR"
  cp "$DOWNLOAD_BIN" "$BIN_PATH"
  chmod 755 "$BIN_PATH"
  if command -v xattr >/dev/null 2>&1; then
    xattr -cr "$BIN_PATH" >/dev/null 2>&1 || true
  fi
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --sign - "$BIN_PATH" >/dev/null 2>&1 \
      || die "macOS could not prepare the Companion binary for launch. Open System Settings > Privacy & Security, allow VibeTV if prompted, then rerun this installer."
  fi
}

uninstall_service() {
  stop_terminal_service
  stop_launchagent
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1 || true
  fi
  rm -f "$PLIST_PATH" "$DISPLAY_DAEMON_PLIST"
  log "vibetv: Mac setup service stopped"
  log "vibetv: installed binary kept at ${BIN_PATH}"
}

stop_launchagent() {
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
    if [[ -f "$GLOBAL_PLIST_PATH" ]]; then
      launchctl disable "$SERVICE" >/dev/null 2>&1 || true
      log "vibetv: old Mac setup service disabled for this user"
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
    if [[ "$command_line" == *"$INSTALL_NAME"* ]]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}

detect_arch() {
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64)
      BINARY_ARCH="arm64"
      ;;
    x86_64)
      BINARY_ARCH="amd64"
      ;;
    *)
      die "unsupported macOS architecture: $ARCH"
      ;;
  esac
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      --repo)
        [[ $# -ge 2 ]] || die "--repo requires a value"
        REPO="$2"
        shift 2
        ;;
      --repo=*)
        REPO="${1#*=}"
        shift
        ;;
      --version)
        [[ $# -ge 2 ]] || die "--version requires a value"
        RELEASE_VERSION="$(normalize_version "$2")"
        shift 2
        ;;
      --version=*)
        RELEASE_VERSION="$(normalize_version "${1#*=}")"
        shift
        ;;
      --addr)
        [[ $# -ge 2 ]] || die "--addr requires a value"
        ADDR="$2"
        shift 2
        ;;
      --addr=*)
        ADDR="${1#*=}"
        shift
        ;;
      --dev-origin)
        [[ $# -ge 2 ]] || die "--dev-origin requires a value"
        DEV_ORIGIN="$2"
        shift 2
        ;;
      --dev-origin=*)
        DEV_ORIGIN="${1#*=}"
        shift
        ;;
      --control-center-path)
        [[ $# -ge 2 ]] || die "--control-center-path requires a value"
        CONTROL_CENTER_PATH="$(normalize_control_center_path "$2")"
        shift 2
        ;;
      --control-center-path=*)
        CONTROL_CENTER_PATH="$(normalize_control_center_path "${1#*=}")"
        shift
        ;;
      --target)
        [[ $# -ge 2 ]] || die "--target requires a value"
        TARGET="$2"
        TARGET_EXPLICIT=1
        shift 2
        ;;
      --target=*)
        TARGET="${1#*=}"
        TARGET_EXPLICIT=1
        shift
        ;;
      --restart)
        MODE="restart"
        shift
        ;;
      --uninstall)
        MODE="uninstall"
        shift
        ;;
      --terminal-session)
        START_MODE="terminal"
        shift
        ;;
      --launchagent)
        START_MODE="launchagent"
        shift
        ;;
      --skip-device-setup)
        SKIP_DEVICE_SETUP=1
        shift
        ;;
      --force-legacy-script)
        # Kept as a no-op so older support commands do not fail.
        shift
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done
}

main() {
  parse_args "$@"
  CONTROL_CENTER_PATH="$(normalize_control_center_path "$CONTROL_CENTER_PATH")"

  require_cmd_for uname "detect your Mac CPU architecture" "use a standard macOS Terminal, then rerun the installer."

  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "this installer currently supports macOS only"
  fi

  require_cmd_for curl "download the VibeTV Companion release files" "use a standard macOS Terminal with curl available, then rerun the installer."
  require_cmd_for shasum "verify the downloaded Companion binary checksum" "install the macOS command line tools, then rerun the installer."
  require_cmd_for awk "read the expected checksum from the release file" "install the macOS command line tools, then rerun the installer."
  require_cmd_for sed "read the latest GitHub release version" "install the macOS command line tools, then rerun the installer."
  require_cmd_for grep "find the matching checksum entry" "install the macOS command line tools, then rerun the installer."
  require_cmd_for mktemp "create a temporary download folder" "use a standard macOS Terminal, then rerun the installer."

  if [[ "$MODE" == "uninstall" ]]; then
    uninstall_service
    exit 0
  fi

  if [[ "$MODE" == "restart" ]]; then
    restart_service
    wait_for_api
    open_control_center
    exit 0
  fi

  detect_arch

  if [[ -z "$RELEASE_VERSION" ]]; then
    RELEASE_TAG="$(fetch_latest_release_tag)"
    RELEASE_VERSION="$(normalize_version "$RELEASE_TAG")"
  else
    RELEASE_TAG="v${RELEASE_VERSION}"
  fi

  TMPDIR_INSTALL="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-companion-install.XXXXXX")"
  trap cleanup EXIT INT TERM

  DOWNLOAD_BIN="${TMPDIR_INSTALL}/${INSTALL_NAME}-darwin-${BINARY_ARCH}-v${RELEASE_VERSION}"
  CHECKSUMS_FILE="${TMPDIR_INSTALL}/checksums-v${RELEASE_VERSION}.txt"

  log "vibetv: repo=${REPO}"
  log "vibetv: release=${RELEASE_TAG}"
  log "vibetv: arch=${ARCH}"

  download_file "${GITHUB_DOWNLOAD_BASE}/${REPO}/releases/download/${RELEASE_TAG}/${DOWNLOAD_BIN##*/}" "$DOWNLOAD_BIN"
  chmod 755 "$DOWNLOAD_BIN"

  download_file "${GITHUB_DOWNLOAD_BASE}/${REPO}/releases/download/${RELEASE_TAG}/checksums-v${RELEASE_VERSION}.txt" "$CHECKSUMS_FILE"
  verify_checksum

  install_binary
  restart_service
  wait_for_api
  verify_companion_version

  log "vibetv: Mac setup binary installed at ${BIN_PATH}"
  log "vibetv: background service installed at ${DISPLAY_DAEMON_PLIST}"
  if [[ "$SKIP_DEVICE_SETUP" == "1" ]]; then
    log "vibetv: Mac App update verified"
    open_control_center
    exit 0
  fi
  finish_device_setup
  open_control_center
}

main "$@"
