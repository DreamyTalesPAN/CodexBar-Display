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
API_LOG_OUT="/tmp/codexbar-display-companion-api.out.log"
API_LOG_ERR="/tmp/codexbar-display-companion-api.err.log"

REPO="${VIBETV_COMPANION_REPO:-$DEFAULT_REPO}"
RELEASE_VERSION="${VIBETV_COMPANION_VERSION:-}"
ADDR="${VIBETV_COMPANION_ADDR:-127.0.0.1:47832}"
DEV_ORIGIN="${VIBETV_COMPANION_DEV_ORIGIN:-}"
TARGET="${VIBETV_COMPANION_TARGET:-http://vibetv.local}"
MODE="install"
START_MODE="${VIBETV_COMPANION_START_MODE:-terminal}"
TMPDIR_INSTALL=""
DOWNLOAD_BIN=""
CHECKSUMS_FILE=""
ARCH=""
BINARY_ARCH=""
RELEASE_TAG=""

usage() {
  cat <<'EOF'
Usage:
  install-control-center-companion.sh [--repo owner/name] [--version x.y.z] [--addr 127.0.0.1:47832] [--target http://vibetv.local]
  install-control-center-companion.sh --restart
  install-control-center-companion.sh --uninstall

What it does:
  - downloads the matching codexbar-display macOS release binary
  - verifies the release checksum
  - installs the binary under ~/Library/Application Support/codexbar-display/bin
  - stops the old standalone Mac setup service if it exists
  - starts the normal VibeTV Mac App background service
  - verifies http://127.0.0.1:47832/v1/status

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

write_plist() {
  local daemon_args=("$BIN_PATH" "daemon" "--interval" "30s" "--transport" "wifi" "--target" "$TARGET")
  if binary_supports_integrated_api; then
    daemon_args+=("--api-addr" "$ADDR")
  fi
  if [[ -n "$DEV_ORIGIN" && "${daemon_args[*]}" == *"--api-addr"* ]]; then
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

write_api_plist() {
  local api_args=("$BIN_PATH" "api" "--addr" "$ADDR")
  if [[ -n "$DEV_ORIGIN" ]]; then
    api_args+=("--dev-origin" "$DEV_ORIGIN")
  fi

  mkdir -p "$PLIST_DIR"
  {
    cat <<PLIST_HEAD
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
PLIST_HEAD

    for arg in "${api_args[@]}"; do
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
    <string>${API_LOG_OUT}</string>

    <key>StandardErrorPath</key>
    <string>${API_LOG_ERR}</string>
  </dict>
</plist>
PLIST_TAIL
  } > "$PLIST_PATH"

  chmod 644 "$PLIST_PATH"
}

binary_supports_integrated_api() {
  "$BIN_PATH" daemon --help 2>&1 | grep -F -- "--api-addr" >/dev/null
}

restart_service() {
  if [[ ! -x "$BIN_PATH" ]]; then
    die "Mac setup binary is missing: ${BIN_PATH}. Run install first."
  fi

  require_cmd_for launchctl "start the VibeTV Mac App background service" "rerun from a standard macOS Terminal."
  stop_launchagent
  stop_terminal_service
  stop_existing_listener
  local integrated_api=0
  if binary_supports_integrated_api; then
    integrated_api=1
  fi
  write_plist
  if [[ "$integrated_api" != "1" ]]; then
    write_api_plist
    log "vibetv: using compatibility Mac setup service for this installed version"
  fi
  launchctl bootout "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1 || true
  launchctl enable "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1 || true
  if ! launchctl bootstrap "gui/$(id -u)" "$DISPLAY_DAEMON_PLIST" >/dev/null 2>&1; then
    if ! launchctl print "$DISPLAY_DAEMON_SERVICE" >/dev/null 2>&1; then
      die "failed to load the VibeTV Mac App background service."
    fi
  fi
  launchctl kickstart -k "$DISPLAY_DAEMON_SERVICE" >/dev/null
  if [[ "$integrated_api" != "1" ]]; then
    launchctl enable "$SERVICE" >/dev/null 2>&1 || true
    if ! launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1; then
      if ! launchctl print "$SERVICE" >/dev/null 2>&1; then
        die "failed to load the VibeTV Mac setup service."
      fi
    fi
    launchctl kickstart -k "$SERVICE" >/dev/null
  fi
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
      --target)
        [[ $# -ge 2 ]] || die "--target requires a value"
        TARGET="$2"
        shift 2
        ;;
      --target=*)
        TARGET="${1#*=}"
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

  log "vibetv: Mac setup binary installed at ${BIN_PATH}"
  log "vibetv: background service installed at ${DISPLAY_DAEMON_PLIST}"
}

main "$@"
