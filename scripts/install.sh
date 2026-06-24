#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="DreamyTalesPAN/CodexBar-Display"
GITHUB_API_BASE="https://api.github.com"
GITHUB_DOWNLOAD_BASE="https://github.com"
INSTALL_NAME="codexbar-display"
INSTALL_ROOT="${HOME}/Library/Application Support/codexbar-display"
INSTALL_PATH="${INSTALL_ROOT}/bin/${INSTALL_NAME}"
GLOBAL_BIN_DIR="${CODEXBAR_DISPLAY_GLOBAL_BIN_DIR:-/usr/local/bin}"
GLOBAL_BIN_PATH="${GLOBAL_BIN_DIR}/${INSTALL_NAME}"
CODEXBAR_CONFIG_DIR="${HOME}/.codexbar"
CODEXBAR_CONFIG_PATH="${CODEXBAR_CONFIG_DIR}/config.json"

REPO="${CODEXBAR_DISPLAY_REPO:-$DEFAULT_REPO}"
RELEASE_VERSION="${CODEXBAR_DISPLAY_VERSION:-}"
FLASH_FIRMWARE="${CODEXBAR_DISPLAY_FLASH_FIRMWARE:-0}"
DEFAULT_THEME_PACK_ID="${CODEXBAR_DISPLAY_DEFAULT_THEME_PACK_ID:-mini-classic}"
SKIP_THEME_PACK="${CODEXBAR_DISPLAY_SKIP_THEME_PACK:-0}"
SETUP_ARGS=()
FIRMWARE_UPGRADE_ARGS=()
TMPDIR_INSTALL=""
DOWNLOAD_BIN=""
CHECKSUMS_FILE=""
ARCH=""
BINARY_ARCH=""

usage() {
  cat <<'EOF'
Usage:
  install.sh [--repo owner/name] [--version x.y.z] [--flash-firmware] [--skip-theme-pack] [--theme-pack theme-id] [--] [setup args...]

What it does:
  - detects macOS architecture
  - downloads the matching codexbar-display release binary from GitHub Releases
  - verifies the SHA-256 checksum from the release checksum file
  - runs `codexbar-display setup --yes --skip-flash [setup args...]`
  - makes `codexbar-display` available in Terminal
  - optionally runs `codexbar-display upgrade` to flash release firmware when --flash-firmware is passed
  - warms up CodexBar on fresh installs so providers are usable
  - installs the default VibeTV theme pack so firmware 1.0.31+ can render frames
  - uses WiFi for normal customer setup; USB-C only powers VibeTV
  - runs a health check after setup

Examples:
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash -s -- --target http://vibetv.local --theme mini
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash -s -- --target http://192.168.178.159
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash -s -- --version 1.0.0
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
      -H "User-Agent: vibetv-install" \
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
  expected="$(grep -F "$INSTALL_NAME-darwin-${BINARY_ARCH}-v${RELEASE_VERSION}" "$CHECKSUMS_FILE" | awk '{print $1}' | head -n 1 || true)"
  if [[ -z "$expected" ]]; then
    die "checksum entry not found for ${DOWNLOAD_BIN##*/}"
  fi

  actual="$(shasum -a 256 "$DOWNLOAD_BIN" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    die "checksum mismatch for ${DOWNLOAD_BIN##*/}"
  fi
}

build_firmware_upgrade_args() {
  local args=("$@")
  local i arg next

  FIRMWARE_UPGRADE_ARGS=(--repo "$REPO" --target-firmware-version "$RELEASE_VERSION")

  i=0
  while [[ "$i" -lt "${#args[@]}" ]]; do
    arg="${args[$i]}"
    case "$arg" in
      --port|--firmware-env)
        next=$((i + 1))
        if [[ "$next" -lt "${#args[@]}" ]]; then
          FIRMWARE_UPGRADE_ARGS+=("$arg" "${args[$next]}")
          i=$((i + 2))
          continue
        fi
        ;;
      --port=*|--firmware-env=*)
        FIRMWARE_UPGRADE_ARGS+=("$arg")
        ;;
    esac
    i=$((i + 1))
  done
}

setup_transport_from_args() {
  local args=("$@")
  local i arg next

  i=0
  while [[ "$i" -lt "${#args[@]}" ]]; do
    arg="${args[$i]}"
    case "$arg" in
      --transport)
        next=$((i + 1))
        if [[ "$next" -lt "${#args[@]}" ]]; then
          printf '%s\n' "${args[$next]}"
          return 0
        fi
        ;;
      --transport=*)
        printf '%s\n' "${arg#*=}"
        return 0
        ;;
    esac
    i=$((i + 1))
  done

  printf '%s\n' "wifi"
}

install_default_theme_pack() {
  local setup_transport="$1"

  if [[ "$SKIP_THEME_PACK" == "1" ]]; then
    log "vibetv: default theme pack skipped"
    return 0
  fi
  if [[ -z "$DEFAULT_THEME_PACK_ID" ]]; then
    log "vibetv: default theme pack skipped (empty theme id)"
    return 0
  fi
  case "$setup_transport" in
    [Uu][Ss][Bb])
      log "vibetv: default theme pack skipped for USB setup"
      return 0
      ;;
  esac

  log "vibetv: installing default theme pack (${DEFAULT_THEME_PACK_ID})..."
  if ! "$INSTALL_PATH" theme-pack install --theme "$DEFAULT_THEME_PACK_ID" --skip-firmware-update; then
    die "default theme pack install failed. If VibeTV is reachable by IP but not vibetv.local, rerun with: bash -s -- --target http://<device-ip>"
  fi
}

run_privileged() {
  if "$@"; then
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    return 1
  fi
  log "vibetv: macOS may ask for your password to make '${INSTALL_NAME}' available in Terminal."
  sudo "$@"
}

install_global_command() {
  mkdir -p "$INSTALL_ROOT"

  if [[ ! -d "$GLOBAL_BIN_DIR" ]]; then
    run_privileged mkdir -p "$GLOBAL_BIN_DIR" ||
      die "could not create ${GLOBAL_BIN_DIR}"
  fi

  if [[ -L "$GLOBAL_BIN_PATH" || ! -e "$GLOBAL_BIN_PATH" ]]; then
    run_privileged ln -sfn "$INSTALL_PATH" "$GLOBAL_BIN_PATH" ||
      die "could not link ${GLOBAL_BIN_PATH} to ${INSTALL_PATH}"
  else
    run_privileged ln -sfn "$INSTALL_PATH" "$GLOBAL_BIN_PATH" ||
      die "${GLOBAL_BIN_PATH} exists and could not be replaced"
  fi

  hash -r 2>/dev/null || true
  if ! command -v "$INSTALL_NAME" >/dev/null 2>&1; then
    die "${INSTALL_NAME} was installed, but Terminal cannot find it. Expected ${GLOBAL_BIN_DIR} to be in PATH."
  fi
  if ! "$INSTALL_NAME" version --short >/dev/null 2>&1; then
    die "${INSTALL_NAME} is in PATH, but it did not run correctly"
  fi
  log "vibetv: Terminal command ready: ${INSTALL_NAME}"
}

seed_codexbar_config_if_missing() {
  if [[ -e "$CODEXBAR_CONFIG_PATH" ]]; then
    return 0
  fi

  mkdir -p "$CODEXBAR_CONFIG_DIR"
  cat >"$CODEXBAR_CONFIG_PATH" <<'EOF'
{
  "version": 1,
  "providers": [
    {"id": "codex", "enabled": true},
    {"id": "claude", "enabled": true},
    {"id": "cursor", "enabled": true}
  ]
}
EOF
  chmod 600 "$CODEXBAR_CONFIG_PATH"
  log "vibetv: seeded default CodexBar provider config at ${CODEXBAR_CONFIG_PATH}"
}

open_codexbar_app() {
  if [[ -d "/Applications/CodexBar.app" ]]; then
    open -a /Applications/CodexBar.app >/dev/null 2>&1 || true
  elif [[ -d "${HOME}/Applications/CodexBar.app" ]]; then
    open -a "${HOME}/Applications/CodexBar.app" >/dev/null 2>&1 || true
  fi
}

run_with_timeout() {
  local timeout_secs="$1"
  shift

  "$@" >/dev/null 2>&1 &
  local cmd_pid=$!

  (
    sleep "$timeout_secs"
    kill -TERM "$cmd_pid" 2>/dev/null || true
    sleep 2
    kill -KILL "$cmd_pid" 2>/dev/null || true
  ) &
  local watchdog_pid=$!

  local rc=0
  if ! wait "$cmd_pid"; then
    rc=$?
  fi

  kill -TERM "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  return "$rc"
}

probe_codexbar_ready() {
  run_with_timeout 15 codexbar usage --json --provider codex --source cli ||
    run_with_timeout 15 codexbar usage --json --web-timeout 8
}

wait_for_codexbar_ready() {
  local attempt=1
  local max_attempts=12

  log "vibetv: warming up CodexBar..."
  open_codexbar_app

  while [[ "$attempt" -le "$max_attempts" ]]; do
    if probe_codexbar_ready; then
      log "vibetv: CodexBar is returning provider data"
      return 0
    fi

    if [[ "$attempt" -eq 3 || "$attempt" -eq 7 ]]; then
      open_codexbar_app
    fi

    sleep 5
    attempt=$((attempt + 1))
  done

  return 1
}

main() {
  local local_tag

  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  require_cmd_for curl "download the VibeTV installer files from GitHub" "install curl or use a standard macOS Terminal, then rerun the installer."
  require_cmd_for shasum "verify the downloaded VibeTV binary checksum" "install the macOS command line tools, then rerun the installer."
  require_cmd_for awk "read the expected checksum from the release file" "install the macOS command line tools, then rerun the installer."
  require_cmd_for sed "read the latest GitHub release version" "install the macOS command line tools, then rerun the installer."
  require_cmd_for grep "find the matching checksum entry" "install the macOS command line tools, then rerun the installer."
  require_cmd_for uname "detect your Mac CPU architecture" "use a standard macOS Terminal, then rerun the installer."
  require_cmd_for mktemp "create a temporary download folder" "use a standard macOS Terminal, then rerun the installer."

  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "this installer only supports macOS"
  fi

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

  while [[ $# -gt 0 ]]; do
    case "$1" in
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
      --flash-firmware)
        FLASH_FIRMWARE=1
        shift
        ;;
      --skip-theme-pack)
        SKIP_THEME_PACK=1
        shift
        ;;
      --theme-pack)
        [[ $# -ge 2 ]] || die "--theme-pack requires a value"
        DEFAULT_THEME_PACK_ID="$2"
        shift 2
        ;;
      --theme-pack=*)
        DEFAULT_THEME_PACK_ID="${1#*=}"
        shift
        ;;
      --)
        shift
        SETUP_ARGS=("$@")
        break
        ;;
      *)
        SETUP_ARGS=("$@")
        break
        ;;
    esac
  done

  if [[ -z "$RELEASE_VERSION" ]]; then
    local_tag="$(fetch_latest_release_tag)"
    RELEASE_VERSION="$(normalize_version "$local_tag")"
    RELEASE_TAG="$local_tag"
  else
    RELEASE_TAG="v${RELEASE_VERSION}"
  fi

  TMPDIR_INSTALL="$(mktemp -d "${TMPDIR:-/tmp}/codexbar-display-install.XXXXXX")"
  trap cleanup EXIT INT TERM

  DOWNLOAD_BIN="${TMPDIR_INSTALL}/${INSTALL_NAME}-darwin-${BINARY_ARCH}-v${RELEASE_VERSION}"
  CHECKSUMS_FILE="${TMPDIR_INSTALL}/checksums-v${RELEASE_VERSION}.txt"

  BINARY_URL="${GITHUB_DOWNLOAD_BASE}/${REPO}/releases/download/${RELEASE_TAG}/${DOWNLOAD_BIN##*/}"
  CHECKSUMS_URL="${GITHUB_DOWNLOAD_BASE}/${REPO}/releases/download/${RELEASE_TAG}/checksums-v${RELEASE_VERSION}.txt"

  log "vibetv: repo=${REPO}"
  log "vibetv: release=${RELEASE_TAG}"
  log "vibetv: arch=${ARCH}"
  log "vibetv: downloading release binary..."
  download_file "$BINARY_URL" "$DOWNLOAD_BIN"
  chmod 755 "$DOWNLOAD_BIN"

  log "vibetv: downloading checksums..."
  download_file "$CHECKSUMS_URL" "$CHECKSUMS_FILE"

  log "vibetv: verifying checksum..."
  verify_checksum

  log "vibetv: starting setup..."
  log "vibetv: normal setup uses WiFi; USB-C only powers VibeTV and no USB serial port is expected."
  log "vibetv: if vibetv.local is unreliable, setup will try to discover the device IP automatically."
  "$DOWNLOAD_BIN" setup --yes --skip-flash "${SETUP_ARGS[@]+"${SETUP_ARGS[@]}"}"

  if [[ ! -x "$INSTALL_PATH" ]]; then
    die "setup finished but expected installed binary is missing: ${INSTALL_PATH}"
  fi

  install_global_command

  seed_codexbar_config_if_missing
  if ! wait_for_codexbar_ready; then
    die "CodexBar installed, but provider warm-up did not complete. Open CodexBar once, make sure at least one provider is active, then rerun the installer."
  fi

  if [[ "$FLASH_FIRMWARE" == "1" ]]; then
    log "vibetv: upgrading firmware from release..."
    build_firmware_upgrade_args "${SETUP_ARGS[@]}"
    "$INSTALL_PATH" upgrade "${FIRMWARE_UPGRADE_ARGS[@]}"
  fi

  install_default_theme_pack "$(setup_transport_from_args "${SETUP_ARGS[@]}")"

  log "vibetv: installed binary at ${INSTALL_PATH}"
  log "vibetv: running health check..."
  "$INSTALL_PATH" health

  log "vibetv: setup complete"
}

main "$@"
