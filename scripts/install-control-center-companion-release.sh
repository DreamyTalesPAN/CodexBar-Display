#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="DreamyTalesPAN/CodexBar-Display"
GITHUB_API_BASE="https://api.github.com"
GITHUB_DOWNLOAD_BASE="https://github.com"
INSTALL_NAME="codexbar-display"
PKG_IDENTIFIER="shop.vibetv.companion-api"
APP_SUPPORT_DIR="${HOME}/Library/Application Support/codexbar-display"
BIN_DIR="${APP_SUPPORT_DIR}/bin"
BIN_PATH="${BIN_DIR}/${INSTALL_NAME}"
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
FORCE_LEGACY_SCRIPT=0
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
  install-control-center-companion.sh --force-legacy-script

What it does:
  - downloads the matching codexbar-display macOS release binary
  - verifies the release checksum
  - installs the binary under ~/Library/Application Support/codexbar-display/bin
  - writes a LaunchAgent for `codexbar-display api --addr 127.0.0.1:47832`
  - starts or restarts the local Companion API
  - verifies http://127.0.0.1:47832/v1/status

Examples:
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install-control-center-companion.sh | bash -s -- --restart

If the signed macOS package is already installed, this legacy support script
exits before touching the user LaunchAgent. Use the package repair/update path
instead, unless support explicitly asks for --force-legacy-script.
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
  if [[ ! -f "$PLIST_PATH" ]]; then
    die "LaunchAgent is missing: ${PLIST_PATH}. Run install first."
  fi

  launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
  launchctl enable "$SERVICE" >/dev/null 2>&1 || true
  if ! launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1; then
    if ! launchctl print "$SERVICE" >/dev/null 2>&1; then
      die "failed to load Companion LaunchAgent. Inspect ${LOG_ERR}."
    fi
  fi
  launchctl kickstart -k "$SERVICE" >/dev/null
}

wait_for_api() {
  log "vibetv: waiting for Companion API at http://${ADDR}/v1/status"
  for _ in $(seq 1 20); do
    if curl -fsS "http://${ADDR}/v1/status" >/dev/null 2>&1; then
      log "vibetv: Companion API is running"
      log "vibetv: service=${SERVICE}"
      log "vibetv: logs=${LOG_OUT} / ${LOG_ERR}"
      return 0
    fi
    sleep 0.5
  done
  die "Companion API did not answer on http://${ADDR}/v1/status. Inspect ${LOG_ERR}."
}

install_binary() {
  mkdir -p "$BIN_DIR"
  cp "$DOWNLOAD_BIN" "$BIN_PATH"
  chmod 755 "$BIN_PATH"
}

uninstall_service() {
  launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
  rm -f "$PLIST_PATH"
  log "vibetv: Companion API LaunchAgent removed"
  log "vibetv: installed binary kept at ${BIN_PATH}"
}

installed_package_version() {
  pkgutil --pkg-info "$PKG_IDENTIFIER" 2>/dev/null \
    | awk -F': ' '$1 == "version" {print $2; exit}' || true
}

guard_against_package_install() {
  local package_version
  [[ "$FORCE_LEGACY_SCRIPT" == 0 ]] || return 0

  package_version="$(installed_package_version)"
  [[ -z "$package_version" ]] || die "VibeTV Companion package ${package_version} is already installed. Use the signed package repair/update path instead of this legacy support script. Support can override with --force-legacy-script."
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
      --force-legacy-script)
        FORCE_LEGACY_SCRIPT=1
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
  require_cmd_for launchctl "install and control the macOS LaunchAgent" "run on macOS, then rerun the installer."
  require_cmd_for pkgutil "avoid conflicts with the signed VibeTV Companion package" "run on macOS, then rerun the installer."

  guard_against_package_install

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
  write_plist
  restart_service
  wait_for_api

  log "vibetv: Companion binary installed at ${BIN_PATH}"
  log "vibetv: LaunchAgent installed at ${PLIST_PATH}"
}

main "$@"
