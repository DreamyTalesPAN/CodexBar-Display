#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="DreamyTalesPAN/CodexBar-Display"
GITHUB_API_BASE="https://api.github.com"
GITHUB_DOWNLOAD_BASE="https://github.com"
INSTALL_NAME="codexbar-display"
APP_SUPPORT_DIR="${HOME}/Library/Application Support/codexbar-display"
BIN_DIR="${APP_SUPPORT_DIR}/bin"
BIN_PATH="${BIN_DIR}/${INSTALL_NAME}"
APP_BUNDLE_DIR="${APP_SUPPORT_DIR}/VibeTV Control Center.app"
APP_BUNDLE_CONTENTS_DIR="${APP_BUNDLE_DIR}/Contents"
APP_BUNDLE_BIN_DIR="${APP_BUNDLE_CONTENTS_DIR}/MacOS"
APP_BUNDLE_BIN_PATH="${APP_BUNDLE_BIN_DIR}/${INSTALL_NAME}"
APP_BUNDLE_INFO_PLIST="${APP_BUNDLE_CONTENTS_DIR}/Info.plist"
RUN_DIR="${APP_SUPPORT_DIR}/run"
PID_PATH="${RUN_DIR}/companion-api.pid"
TERMINAL_FALLBACK_MARKER="${RUN_DIR}/terminal-fallback.active"
SCREEN_SESSION_LABEL="vibetv-control-center"
INSTALL_LOG_DIR="${APP_SUPPORT_DIR}/logs"
INSTALL_LOG_PATH="${VIBETV_INSTALL_LOG_PATH:-${INSTALL_LOG_DIR}/install.log}"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/com.codexbar-display.companion-api.plist"
SERVICE_LABEL="com.codexbar-display.companion-api"
SERVICE="gui/$(id -u)/${SERVICE_LABEL}"
GLOBAL_PLIST_PATH="${VIBETV_COMPANION_GLOBAL_PLIST:-/Library/LaunchAgents/${SERVICE_LABEL}.plist}"
DISPLAY_DAEMON_LABEL="com.codexbar-display.daemon"
DISPLAY_DAEMON_PLIST="${PLIST_DIR}/${DISPLAY_DAEMON_LABEL}.plist"
DISPLAY_DAEMON_SERVICE="gui/$(id -u)/${DISPLAY_DAEMON_LABEL}"
DISPLAY_DAEMON_LOG_OUT="${INSTALL_LOG_DIR}/daemon.out.log"
DISPLAY_DAEMON_LOG_ERR="${INSTALL_LOG_DIR}/daemon.err.log"
CONFIG_PATH="${APP_SUPPORT_DIR}/config.json"

REPO="${VIBETV_COMPANION_REPO:-$DEFAULT_REPO}"
RELEASE_VERSION="${VIBETV_COMPANION_VERSION:-}"
ADDR="${VIBETV_COMPANION_ADDR:-127.0.0.1:47832}"
DEV_ORIGIN="${VIBETV_COMPANION_DEV_ORIGIN:-}"
SOURCE_REF="${VIBETV_COMPANION_SOURCE_REF:-}"
TARGET="${VIBETV_COMPANION_TARGET:-}"
TARGET_EXPLICIT=0
if [[ -n "${VIBETV_COMPANION_TARGET:-}" ]]; then
  TARGET_EXPLICIT=1
fi
SKIP_DEVICE_SETUP=0
REPAIR_MAX_ATTEMPTS="${VIBETV_COMPANION_REPAIR_ATTEMPTS:-45}"
REPAIR_RETRY_DELAY="${VIBETV_COMPANION_REPAIR_RETRY_DELAY:-2}"
SERVICE_STABLE_RETRY_DELAY="${VIBETV_COMPANION_STABLE_RETRY_DELAY:-1}"
MODE="install"
START_MODE="${VIBETV_COMPANION_START_MODE:-terminal}"
OPEN_CONTROL_CENTER="${VIBETV_COMPANION_OPEN_CONTROL_CENTER:-1}"
CONTROL_CENTER_PATH="${VIBETV_COMPANION_CONTROL_CENTER_PATH:-/control-center}"
VERBOSE="${VIBETV_VERBOSE:-0}"
INSTALL_LOG_READY=0
STEP_TOTAL=0
STEP_CURRENT=0
STEP_ACTIVE=0
STEP_LABEL=""
INTRO_PRINTED=0
TMPDIR_INSTALL=""
DOWNLOAD_BIN=""
CHECKSUMS_FILE=""
ARCH=""
BINARY_ARCH=""
RELEASE_TAG=""
TERMINAL_FALLBACK_ACTIVE=0

usage() {
  cat <<'EOF'
Usage:
  install-control-center-companion.sh [--repo owner/name] [--version x.y.z] [--addr 127.0.0.1:47832] [--target http://<device-ip>] [--source-ref <commit>] [--control-center-path /control-center] [--skip-device-setup] [--verbose]
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
  - writes technical setup details to:
    ~/Library/Application Support/codexbar-display/logs/install.log

Examples:
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --restart
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --verbose

Debugging:
  Pass --verbose or set VIBETV_VERBOSE=1 to print full technical logs.

The Mac setup service runs inside the normal VibeTV Mac App background service
so the customer has one local Mac App process.
EOF
}

truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_verbose() {
  truthy "$VERBOSE"
}

say() {
  printf '%s\n' "$*"
}

log() {
  if [[ "$INSTALL_LOG_READY" == "1" ]]; then
    printf '%s\n' "$*" >> "$INSTALL_LOG_PATH"
  fi
  if is_verbose; then
    printf '%s\n' "$*" >&2
  fi
}

setup_install_log() {
  if ! mkdir -p "$INSTALL_LOG_DIR"; then
    printf 'VIBETV setup could not create the support log folder: %s\n' "$INSTALL_LOG_DIR" >&2
    exit 1
  fi
  if ! : > "$INSTALL_LOG_PATH"; then
    printf 'VIBETV setup could not write the support log: %s\n' "$INSTALL_LOG_PATH" >&2
    exit 1
  fi
  INSTALL_LOG_READY=1
  log "vibetv: setup log=${INSTALL_LOG_PATH}"
}

print_intro() {
  local title="$1"
  [[ "$INTRO_PRINTED" == "1" ]] && return 0
  say "VIBETV"
  say ""
  say "$title"
  say ""
  INTRO_PRINTED=1
}

step_start() {
  local label="$1"
  STEP_CURRENT=$((STEP_CURRENT + 1))
  STEP_LABEL="$label"
  STEP_ACTIVE=1
  log "vibetv: step start: ${label}"
  if is_verbose; then
    say "[${STEP_CURRENT}/${STEP_TOTAL}] ${label}"
  else
    printf '[%d/%d] %-30s' "$STEP_CURRENT" "$STEP_TOTAL" "$label"
  fi
}

step_done() {
  local label="${1:-$STEP_LABEL}"
  log "vibetv: step done: ${label}"
  if [[ "$STEP_ACTIVE" == "1" ]]; then
    if is_verbose; then
      say "[${STEP_CURRENT}/${STEP_TOTAL}] ${label}: OK"
    else
      printf 'OK\n'
    fi
  fi
  STEP_ACTIVE=0
  STEP_LABEL=""
}

step_fail() {
  local label="${STEP_LABEL:-Current step}"
  if [[ "$STEP_ACTIVE" == "1" ]]; then
    log "vibetv: step failed: ${label}"
    if is_verbose; then
      say "[${STEP_CURRENT}/${STEP_TOTAL}] ${label}: FAILED"
    else
      printf 'FAILED\n'
    fi
  fi
  STEP_ACTIVE=0
  STEP_LABEL=""
}

run_quiet() {
  local status
  log "vibetv: run: $*"
  set +e
  if is_verbose; then
    "$@" 2>&1 | tee -a "$INSTALL_LOG_PATH" >&2
    status=${PIPESTATUS[0]}
  else
    "$@" >> "$INSTALL_LOG_PATH" 2>&1
    status=$?
  fi
  set -e
  log "vibetv: exit ${status}: $*"
  return "$status"
}

finish_success() {
  local url
  url="$(control_center_url)"
  say ""
  if [[ "$OPEN_CONTROL_CENTER" == "1" ]]; then
    say "Done. Your Control Center is opening now."
  else
    say "Done. Your Control Center is ready."
  fi
  say "Open manually: ${url}"
  say "Support log: ${INSTALL_LOG_PATH}"
}

die() {
  log "vibetv: error: $*"
  step_fail
  printf '\nVIBETV setup needs attention.\n' >&2
  printf '%s\n' "$*" >&2
  printf '\nTry running setup again from the VibeTV setup page.\n' >&2
  printf 'Support log: %s\n' "$INSTALL_LOG_PATH" >&2
  if is_verbose; then
    printf 'Status check: curl -fsS http://%s/v1/status\n' "$ADDR" >&2
    printf 'Diagnostics: curl -fsS http://%s/v1/diagnostics\n' "$ADDR" >&2
    printf 'Daemon logs: %s / %s\n' "$DISPLAY_DAEMON_LOG_OUT" "$DISPLAY_DAEMON_LOG_ERR" >&2
  else
    printf 'For full details, rerun with --verbose.\n' >&2
  fi
  exit 1
}

require_cmd_for() {
  local cmd="$1"
  local why="$2"
  local action="$3"

  if ! command -v "$cmd" >/dev/null 2>&1; then
    log "vibetv: missing dependency: ${cmd}; needed for: ${why}; next step: ${action}"
    die "Missing dependency: ${cmd}. ${action}"
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

normalize_source_ref() {
  local ref="$1"
  ref="${ref#refs/heads/}"
  if [[ -z "$ref" ]]; then
    die "source ref cannot be empty"
  fi
  if [[ "$ref" == /* || "$ref" == *".."* || "$ref" == *"//"* || ! "$ref" =~ ^[A-Za-z0-9._/-]+$ ]]; then
    die "invalid source ref: $ref"
  fi
  printf '%s\n' "$ref"
}

source_build_version() {
  local ref="$1"
  ref="${ref//\//-}"
  printf 'preview-%s\n' "${ref:0:24}"
}

json_text_field() {
  local field="$1"
  sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

fetch_latest_release_tag() {
  local response_file response tag
  response_file="${TMPDIR_INSTALL}/latest-release.json"
  run_quiet curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 10 \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -H "User-Agent: vibetv-companion-install" \
    -o "$response_file" \
    "${GITHUB_API_BASE}/repos/${REPO}/releases/latest" \
    || die "Could not check the latest VibeTV release. Check your internet connection, then rerun setup."
  response="$(cat "$response_file")"
  tag="$(printf '%s' "$response" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  if [[ -z "$tag" ]]; then
    die "could not determine latest release tag for ${REPO}"
  fi
  printf '%s\n' "$tag"
}

fetch_dev_source_ref() {
  [[ -n "$DEV_ORIGIN" ]] || return 1

  local metadata_url response_file response source_ref repo
  metadata_url="${DEV_ORIGIN%/}/api/deployment"
  response_file="${TMPDIR_INSTALL}/deployment.json"
  run_quiet curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 10 --max-time 30 \
    -H "Accept: application/json" \
    -o "$response_file" \
    "$metadata_url" \
    || return 1
  response="$(cat "$response_file")"

  source_ref="$(printf '%s' "$response" | json_text_field "sourceRef")"
  repo="$(printf '%s' "$response" | json_text_field "repo")"
  if [[ -n "$repo" && "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    REPO="$repo"
  fi
  [[ -n "$source_ref" ]] || return 1
  normalize_source_ref "$source_ref"
}

download_file() {
  local url="$1"
  local out="$2"

  run_quiet curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 10 --max-time 600 \
    -o "$out" \
    "$url" \
    || die "Could not download a required VibeTV setup file. Check your internet connection, then rerun setup."
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

build_source_binary() {
  require_cmd_for go "build the Preview Mac App from source" "install Go, then rerun this Preview setup command."
  require_cmd_for npm "build the local Control Center from source" "install Node.js, then rerun this Preview setup command."
  require_cmd_for tar "unpack the Preview source archive" "use a standard macOS Terminal, then rerun this Preview setup command."
  require_cmd_for date "stamp the Preview Mac App build" "use a standard macOS Terminal, then rerun this Preview setup command."

  local source_archive source_dir short_ref build_date
  source_archive="${TMPDIR_INSTALL}/source-${SOURCE_REF//\//-}.tar.gz"
  source_dir="${TMPDIR_INSTALL}/source"
  short_ref="${SOURCE_REF:0:12}"
  build_date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  log "vibetv: source=${SOURCE_REF}"
  download_file "${GITHUB_DOWNLOAD_BASE}/${REPO}/archive/${SOURCE_REF}.tar.gz" "$source_archive"
  mkdir -p "$source_dir"
  run_quiet tar -xzf "$source_archive" -C "$source_dir" --strip-components 1 \
    || die "Could not unpack the Preview setup files. Rerun setup from the latest VibeTV setup page."

  (
    cd "$source_dir/apps/control-center"
    run_quiet npm ci \
      || die "Could not prepare the local Control Center files. Rerun setup with --verbose and send the support log."
    run_quiet npm run build:local \
      || die "Could not build the local Control Center. Rerun setup with --verbose and send the support log."
  )
  rm -rf "$source_dir/companion/internal/companionapi/controlcenter_static"
  mkdir -p "$source_dir/companion/internal/companionapi/controlcenter_static"
  cp -R "$source_dir/apps/control-center/out-local/." "$source_dir/companion/internal/companionapi/controlcenter_static/"

  (
    cd "$source_dir/companion"
    run_quiet env GOOS=darwin GOARCH="${BINARY_ARCH}" CGO_ENABLED=0 \
      go build \
      -ldflags "-s -w -X github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo.Version=${RELEASE_VERSION} -X github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo.Commit=${SOURCE_REF} -X github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo.Date=${build_date}" \
      -o "$DOWNLOAD_BIN" ./cmd/codexbar-display \
      || die "Could not build the VibeTV Mac App. Rerun setup with --verbose and send the support log."
  )
  chmod 755 "$DOWNLOAD_BIN"
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
  local daemon_target daemon_binary
  daemon_target="$(daemon_target_for_plist)"
  daemon_binary="$(daemon_binary_for_plist)"

  local daemon_args=("$daemon_binary" "daemon" "--interval" "30s" "--transport" "wifi" "--api-addr" "$ADDR")
  if [[ -n "$daemon_target" ]]; then
    daemon_args+=("--target" "$daemon_target")
  fi
  if [[ -n "$DEV_ORIGIN" ]]; then
    daemon_args+=("--api-dev-origin" "$DEV_ORIGIN")
  fi

  mkdir -p "$PLIST_DIR"
  mkdir -p "$INSTALL_LOG_DIR" || die "could not create log folder: ${INSTALL_LOG_DIR}"
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

    <key>ThrottleInterval</key>
    <integer>10</integer>

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

daemon_binary_for_plist() {
  if [[ -x "$APP_BUNDLE_BIN_PATH" ]]; then
    printf '%s\n' "$APP_BUNDLE_BIN_PATH"
    return 0
  fi
  printf '%s\n' "$BIN_PATH"
}

restart_service() {
  local kickstart_status
  if [[ ! -x "$BIN_PATH" ]]; then
    die "Mac setup binary is missing: ${BIN_PATH}. Run install first."
  fi

  require_cmd_for launchctl "start the VibeTV Mac App background service" "rerun from a standard macOS Terminal."
  install_app_bundle
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
  set +e
  launchctl kickstart -k "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1
  kickstart_status=$?
  set -e
  if [[ "$kickstart_status" -ne 0 ]] && ! launchctl print "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1; then
    die "failed to start the VibeTV Mac App background service."
  fi
  verify_launchagent_loaded
}

verify_launchagent_loaded() {
  if launchctl print "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1; then
    log "vibetv: background service loaded at ${DISPLAY_DAEMON_SERVICE}"
    return 0
  fi
  die "VibeTV Mac App background service is not loaded. Rerun setup from a standard macOS Terminal."
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

verify_control_center_available() {
  local url status
  url="$(control_center_url)"
  status="$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)"
  if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
    return 0
  fi
  die "Local Control Center did not answer at ${url} (HTTP ${status:-000}). Rerun setup from the latest VibeTV setup page."
}

verify_local_service_stable() {
  local status_url url status
  status_url="http://${ADDR}/v1/status"
  url="$(control_center_url)"
  log "vibetv: verifying local Control Center stays available"
  for attempt in 1 2 3; do
    curl -fsS "$status_url" >/dev/null 2>&1 \
      || die "Mac setup service stopped responding during verification. Inspect ${DISPLAY_DAEMON_LOG_ERR}."
    status="$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)"
    [[ "$status" =~ ^2[0-9][0-9]$ ]] \
      || die "Local Control Center stopped responding at ${url} (HTTP ${status:-000}). Inspect ${DISPLAY_DAEMON_LOG_ERR}."
    if [[ "$attempt" != "3" ]]; then
      sleep "$SERVICE_STABLE_RETRY_DELAY"
    fi
  done
  log "vibetv: local Control Center stayed available"
}

open_control_center() {
  local url
  url="$(control_center_url)"
  verify_control_center_available
  verify_local_service_stable
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

json_path_raw() {
  local path="$1"
  local json
  json="$(cat)"
  if command -v plutil >/dev/null 2>&1; then
    printf '%s' "$json" | plutil -extract "$path" raw -o - - 2>/dev/null | head -n 1
    return "${PIPESTATUS[1]}"
  fi
  if command -v node >/dev/null 2>&1; then
    JSON_PATH="$path" JSON_BODY="$json" node -e '
const path = process.env.JSON_PATH.split(".");
let value = JSON.parse(process.env.JSON_BODY);
for (const part of path) {
  if (value == null || !Object.prototype.hasOwnProperty.call(value, part)) process.exit(1);
  value = value[part];
}
if (value == null) process.exit(1);
process.stdout.write(typeof value === "object" ? JSON.stringify(value) : String(value));
' 2>/dev/null
    return $?
  fi
  return 1
}

json_device_target() {
  local json value
  json="$(cat)"
  if value="$(printf '%s' "$json" | json_path_raw "device.target")"; then
    printf '%s\n' "$value"
    return 0
  fi
  printf '%s' "$json" | sed -n 's/.*"device"[^{]*{[^}]*"target"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

json_api_field() {
  local field="$1"
  local json value
  json="$(cat)"
  if value="$(printf '%s' "$json" | json_path_raw "error.${field}")"; then
    printf '%s\n' "$value"
    return 0
  fi
  printf '%s' "$json" | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

status_field() {
  local object="$1"
  local field="$2"
  local json value
  json="$(cat)"
  if value="$(printf '%s' "$json" | json_path_raw "${object}.${field}")"; then
    printf '%s\n' "$value"
    return 0
  fi
  printf '%s' "$json" | sed -n "s/.*\"${object}\"[^{]*{[^}]*\"${field}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

status_bool_field() {
  local object="$1"
  local field="$2"
  local json value
  json="$(cat)"
  if value="$(printf '%s' "$json" | json_path_raw "${object}.${field}")"; then
    printf '%s\n' "$value"
    return 0
  fi
  printf '%s' "$json" | sed -n \
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

  log "vibetv: Mac App API ${method} ${path} failed"
  [[ -z "$status" || "$status" == "000" ]] || log "vibetv: api status=${status}"
  [[ -z "$code" ]] || log "vibetv: api code=${code}"
  [[ -z "$message" ]] || log "vibetv: api detail=${message}"
  [[ -z "$next_action" ]] || log "vibetv: api next step=${next_action}"
  [[ -z "$stderr_text" ]] || log "vibetv: api curl=${stderr_text}"
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

probe_known_target_from_terminal() {
  local target="$1"
  [[ -n "$target" ]] || return 1
  curl -fsS --connect-timeout 3 --max-time 5 "${target%/}/hello" >/dev/null 2>&1
}

start_terminal_daemon_fallback() {
  local target="$1"
  [[ -n "$target" ]] || return 1
  mkdir -p "$RUN_DIR" "$INSTALL_LOG_DIR"
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1 || true
  fi
  stop_terminal_service
  stop_existing_listener

  local daemon_args=("$BIN_PATH" "daemon" "--interval" "30s" "--transport" "wifi" "--api-addr" "$ADDR" "--target" "$target")
  if [[ -n "$DEV_ORIGIN" ]]; then
    daemon_args+=("--api-dev-origin" "$DEV_ORIGIN")
  fi

  if command -v screen >/dev/null 2>&1 && ! truthy "${VIBETV_DISABLE_SCREEN_FALLBACK:-0}"; then
    screen -S "$SCREEN_SESSION_LABEL" -X quit >/dev/null 2>&1 || true
    screen -dmS "$SCREEN_SESSION_LABEL" /bin/sh -c 'out="$1"; err="$2"; shift 2; exec "$@" >> "$out" 2>> "$err"' sh "$DISPLAY_DAEMON_LOG_OUT" "$DISPLAY_DAEMON_LOG_ERR" "${daemon_args[@]}"
    printf 'screen:%s\n' "$SCREEN_SESSION_LABEL" > "$PID_PATH"
  else
    nohup "${daemon_args[@]}" >> "$DISPLAY_DAEMON_LOG_OUT" 2>> "$DISPLAY_DAEMON_LOG_ERR" &
    printf '%s\n' "$!" > "$PID_PATH"
  fi
  : > "$TERMINAL_FALLBACK_MARKER"
  TERMINAL_FALLBACK_ACTIVE=1
  log "vibetv: terminal-seeded Mac App fallback started with pid $(cat "$PID_PATH" 2>/dev/null || true)"
  wait_for_api
  verify_companion_version
}

try_terminal_network_fallback() {
  local fallback_target payload response
  fallback_target="$TARGET"
  if [[ -z "$fallback_target" ]]; then
    fallback_target="$(runtime_config_target)"
  fi
  if [[ -z "$fallback_target" ]]; then
    local status_response
    if status_response="$(local_api_json GET "/v1/status")"; then
      fallback_target="$(printf '%s' "$status_response" | json_device_target)"
    fi
  fi
  [[ -n "$fallback_target" ]] || return 1
  probe_known_target_from_terminal "$fallback_target" || return 1

  log "vibetv: LaunchAgent could not reach VibeTV; using Terminal-seeded Mac App fallback"
  TARGET="$fallback_target"
  start_terminal_daemon_fallback "$TARGET"
  payload="{\"target\":\"$(json_escape "$TARGET")\",\"forcePair\":true}"
  response="$(local_api_json POST "/v1/device/repair" "$payload")" || return 1
  printf '%s\n' "$response"
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
      if response="$(try_terminal_network_fallback)"; then
        break
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
  if [[ "$TERMINAL_FALLBACK_ACTIVE" == "1" || -f "$TERMINAL_FALLBACK_MARKER" ]]; then
    log "vibetv: keeping Terminal-seeded Mac App fallback active"
    return 0
  fi
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
  run_quiet "$BIN_PATH" install-update --target "$TARGET" --confirm-live-update \
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
  install_app_bundle
}

install_app_bundle() {
  if [[ ! -x "$BIN_PATH" ]]; then
    die "Mac setup binary is missing: ${BIN_PATH}. Run install first."
  fi

  mkdir -p "$APP_BUNDLE_BIN_DIR"
  cp "$BIN_PATH" "$APP_BUNDLE_BIN_PATH"
  chmod 755 "$APP_BUNDLE_BIN_PATH"
  cat > "$APP_BUNDLE_INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>${INSTALL_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>shop.vibetv.control-center</string>
    <key>CFBundleName</key>
    <string>VibeTV Control Center</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>$(xml_escape "$RELEASE_VERSION")</string>
    <key>LSBackgroundOnly</key>
    <true/>
    <key>NSLocalNetworkUsageDescription</key>
    <string>VibeTV needs local network access to connect to your VibeTV display.</string>
  </dict>
</plist>
PLIST
  if command -v xattr >/dev/null 2>&1; then
    xattr -cr "$APP_BUNDLE_DIR" >/dev/null 2>&1 || true
  fi
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --deep --sign - "$APP_BUNDLE_DIR" >/dev/null 2>&1 \
      || log "vibetv: warning: ad-hoc codesign failed for ${APP_BUNDLE_DIR}"
  fi
}

uninstall_service() {
  stop_terminal_service
  stop_launchagent
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1 || true
  fi
  rm -f "$PLIST_PATH" "$DISPLAY_DAEMON_PLIST"
  rm -rf "$APP_BUNDLE_DIR"
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
  rm -f "$TERMINAL_FALLBACK_MARKER"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  if [[ "$pid" == screen:* ]]; then
    if command -v screen >/dev/null 2>&1; then
      screen -S "${pid#screen:}" -X quit >/dev/null 2>&1 || true
    fi
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
      --source-ref)
        [[ $# -ge 2 ]] || die "--source-ref requires a value"
        SOURCE_REF="$(normalize_source_ref "$2")"
        shift 2
        ;;
      --source-ref=*)
        SOURCE_REF="$(normalize_source_ref "${1#*=}")"
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
      --verbose)
        VERBOSE=1
        shift
        ;;
      --quiet)
        VERBOSE=0
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
  setup_install_log
  CONTROL_CENTER_PATH="$(normalize_control_center_path "$CONTROL_CENTER_PATH")"
  if [[ -n "$SOURCE_REF" ]]; then
    SOURCE_REF="$(normalize_source_ref "$SOURCE_REF")"
  fi

  if [[ "$MODE" == "uninstall" ]]; then
    STEP_TOTAL=2
    print_intro "Removing your local Control Center"
  elif [[ "$MODE" == "restart" ]]; then
    STEP_TOTAL=3
    print_intro "Starting your local Control Center"
  elif [[ "$SKIP_DEVICE_SETUP" == "1" ]]; then
    STEP_TOTAL=5
    print_intro "Installing your local Control Center"
  else
    STEP_TOTAL=7
    print_intro "Installing your local Control Center"
  fi

  step_start "Preparing Mac app"
  require_cmd_for uname "detect your Mac CPU architecture" "use a standard macOS Terminal, then rerun the installer."

  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "this installer currently supports macOS only"
  fi

  if [[ "$MODE" == "uninstall" ]]; then
    step_done "Preparing Mac app"
    step_start "Stopping Control Center"
    uninstall_service
    step_done "Stopping Control Center"
    say ""
    say "Done. Local Control Center service stopped."
    say "Support log: ${INSTALL_LOG_PATH}"
    exit 0
  fi

  if [[ "$MODE" == "restart" ]]; then
    require_cmd_for curl "check the local Control Center status" "use a standard macOS Terminal with curl available, then rerun setup."
    step_done "Preparing Mac app"
    step_start "Starting Control Center"
    restart_service
    wait_for_api
    step_done "Starting Control Center"
    step_start "Opening Control Center"
    open_control_center
    step_done "Opening Control Center"
    finish_success
    exit 0
  fi

  require_cmd_for curl "download the VibeTV Companion release files" "use a standard macOS Terminal with curl available, then rerun setup."
  require_cmd_for shasum "verify the downloaded Companion binary checksum" "install the macOS command line tools, then rerun setup."
  require_cmd_for awk "read the expected checksum from the release file" "install the macOS command line tools, then rerun setup."
  require_cmd_for sed "read the latest GitHub release version" "install the macOS command line tools, then rerun setup."
  require_cmd_for grep "find the matching checksum entry" "install the macOS command line tools, then rerun setup."
  require_cmd_for mktemp "create a temporary download folder" "use a standard macOS Terminal, then rerun setup."

  detect_arch
  TMPDIR_INSTALL="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-companion-install.XXXXXX")"
  trap cleanup EXIT INT TERM

  if [[ -n "$DEV_ORIGIN" && -z "$RELEASE_VERSION" && -z "$SOURCE_REF" ]]; then
    SOURCE_REF="$(fetch_dev_source_ref)" \
      || die "Preview build metadata was not available from ${DEV_ORIGIN}. Rerun setup from the latest Preview, or pass --source-ref <commit>."
  fi

  if [[ -n "$SOURCE_REF" && -z "$RELEASE_VERSION" ]]; then
    RELEASE_VERSION="$(source_build_version "$SOURCE_REF")"
    RELEASE_TAG="$SOURCE_REF"
  elif [[ -z "$RELEASE_VERSION" ]]; then
    RELEASE_TAG="$(fetch_latest_release_tag)"
    RELEASE_VERSION="$(normalize_version "$RELEASE_TAG")"
  else
    RELEASE_TAG="v${RELEASE_VERSION}"
  fi

  DOWNLOAD_BIN="${TMPDIR_INSTALL}/${INSTALL_NAME}-darwin-${BINARY_ARCH}-v${RELEASE_VERSION}"
  CHECKSUMS_FILE="${TMPDIR_INSTALL}/checksums-v${RELEASE_VERSION}.txt"

  log "vibetv: repo=${REPO}"
  if [[ -n "$SOURCE_REF" ]]; then
    log "vibetv: build=${RELEASE_VERSION}"
  else
    log "vibetv: release=${RELEASE_TAG}"
  fi
  log "vibetv: arch=${ARCH}"
  step_done "Preparing Mac app"

  if [[ -n "$SOURCE_REF" ]]; then
    step_start "Preparing Preview app"
    build_source_binary
    step_done "Preparing Preview app"
  else
    step_start "Downloading Mac app"
    download_file "${GITHUB_DOWNLOAD_BASE}/${REPO}/releases/download/${RELEASE_TAG}/${DOWNLOAD_BIN##*/}" "$DOWNLOAD_BIN"
    chmod 755 "$DOWNLOAD_BIN"

    download_file "${GITHUB_DOWNLOAD_BASE}/${REPO}/releases/download/${RELEASE_TAG}/checksums-v${RELEASE_VERSION}.txt" "$CHECKSUMS_FILE"
    verify_checksum
    step_done "Downloading Mac app"
  fi

  step_start "Installing Mac app"
  install_binary
  step_done "Installing Mac app"

  step_start "Starting Control Center"
  restart_service
  wait_for_api
  verify_companion_version
  step_done "Starting Control Center"

  log "vibetv: Mac setup binary installed at ${BIN_PATH}"
  log "vibetv: background service installed at ${DISPLAY_DAEMON_PLIST}"
  if [[ "$SKIP_DEVICE_SETUP" == "1" ]]; then
    log "vibetv: Mac App update verified"
    step_start "Opening Control Center"
    open_control_center
    step_done "Opening Control Center"
    finish_success
    exit 0
  fi

  step_start "Finding VibeTV"
  connect_vibetv
  restart_service_with_discovered_target
  step_done "Finding VibeTV"

  step_start "Checking VibeTV update"
  update_vibetv_firmware
  verify_final_status
  step_done "Checking VibeTV update"

  step_start "Opening Control Center"
  open_control_center
  step_done "Opening Control Center"
  finish_success
}

main "$@"
