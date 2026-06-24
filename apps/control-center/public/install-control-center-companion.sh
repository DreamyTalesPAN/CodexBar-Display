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
LOG_OUT="/tmp/codexbar-display-companion-api.out.log"
LOG_ERR="/tmp/codexbar-display-companion-api.err.log"

REPO="${VIBETV_COMPANION_REPO:-$DEFAULT_REPO}"
RELEASE_VERSION="${VIBETV_COMPANION_VERSION:-}"
ADDR="${VIBETV_COMPANION_ADDR:-127.0.0.1:47832}"
DEV_ORIGIN="${VIBETV_COMPANION_DEV_ORIGIN:-}"
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
  install-control-center-companion.sh [--repo owner/name] [--version x.y.z] [--addr 127.0.0.1:47832]
  install-control-center-companion.sh --restart
  install-control-center-companion.sh --uninstall

What it does:
  - downloads the matching codexbar-display macOS release binary
  - verifies the release checksum
  - installs the binary under ~/Library/Application Support/codexbar-display/bin
  - stops the old background service if it exists
  - starts the local Mac setup service as a user LaunchAgent with --launchagent
  - otherwise starts it from this Terminal session
  - verifies http://127.0.0.1:47832/v1/status

Examples:
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --launchagent
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --restart

By default the service is started from Terminal. The Control Center setup prompt
passes --launchagent so the Mac setup service keeps running after setup.
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
    <string>${LOG_OUT}</string>

    <key>StandardErrorPath</key>
    <string>${LOG_ERR}</string>
  </dict>
</plist>
PLIST_TAIL
  } > "$PLIST_PATH"

  chmod 644 "$PLIST_PATH"
}

restart_service() {
  if [[ "$START_MODE" == "launchagent" ]]; then
    if [[ ! -f "$PLIST_PATH" ]]; then
      die "LaunchAgent is missing: ${PLIST_PATH}. Run install first."
    fi

    require_cmd_for launchctl "start the macOS user LaunchAgent mode" "rerun with --terminal-session."
    launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
    launchctl enable "$SERVICE" >/dev/null 2>&1 || true
    if ! launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1; then
      if ! launchctl print "$SERVICE" >/dev/null 2>&1; then
        die "failed to load the background service. Rerun with --terminal-session."
      fi
    fi
    launchctl kickstart -k "$SERVICE" >/dev/null
    return 0
  fi

  start_terminal_service
}

wait_for_api() {
  log "vibetv: waiting for Mac setup service at http://${ADDR}/v1/status"
  for _ in $(seq 1 20); do
    if curl -fsS "http://${ADDR}/v1/status" >/dev/null 2>&1; then
      log "vibetv: Mac setup service is running"
      if [[ "$START_MODE" == "launchagent" ]]; then
        log "vibetv: service=${SERVICE}"
      elif [[ -f "$PID_PATH" ]]; then
        log "vibetv: pid=$(cat "$PID_PATH")"
      fi
      log "vibetv: logs=${LOG_OUT} / ${LOG_ERR}"
      return 0
    fi
    sleep 0.5
  done
  die "Mac setup service did not answer on http://${ADDR}/v1/status. Inspect ${LOG_ERR}."
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
  rm -f "$PLIST_PATH"
  log "vibetv: Mac setup service stopped"
  log "vibetv: installed binary kept at ${BIN_PATH}"
}

stop_launchagent() {
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
  fi
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

start_terminal_service() {
  if [[ ! -x "$BIN_PATH" ]]; then
    die "Mac setup binary is missing: ${BIN_PATH}. Run install first."
  fi

  stop_launchagent
  rm -f "$PLIST_PATH"
  stop_terminal_service
  stop_existing_listener

  local api_args=("$BIN_PATH" "api" "--addr" "$ADDR")
  if [[ -n "$DEV_ORIGIN" ]]; then
    api_args+=("--dev-origin" "$DEV_ORIGIN")
  fi

  mkdir -p "$RUN_DIR"
  : > "$LOG_OUT"
  : > "$LOG_ERR"
  nohup "${api_args[@]}" >>"$LOG_OUT" 2>>"$LOG_ERR" &
  printf '%s\n' "$!" > "$PID_PATH"
  disown "$!" >/dev/null 2>&1 || true
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
  if [[ "$START_MODE" == "launchagent" ]]; then
    write_plist
  fi
  restart_service
  wait_for_api

  log "vibetv: Mac setup binary installed at ${BIN_PATH}"
  if [[ "$START_MODE" == "launchagent" ]]; then
    log "vibetv: background service installed at ${PLIST_PATH}"
  else
    log "vibetv: started from this Terminal session"
  fi
}

main "$@"
