#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="DreamyTalesPAN/CodexBar-Display"
GITHUB_API_BASE="https://api.github.com"
GITHUB_DOWNLOAD_BASE="https://github.com"
INSTALL_NAME="codexbar-display"
INSTALL_ROOT="${HOME}/Library/Application Support/codexbar-display"
INSTALL_PATH="${INSTALL_ROOT}/bin/${INSTALL_NAME}"
CODEXBAR_CONFIG_DIR="${HOME}/.codexbar"
CODEXBAR_CONFIG_PATH="${CODEXBAR_CONFIG_DIR}/config.json"

REPO="${CODEXBAR_DISPLAY_REPO:-$DEFAULT_REPO}"
RELEASE_VERSION="${CODEXBAR_DISPLAY_VERSION:-}"
FLASH_FIRMWARE="${CODEXBAR_DISPLAY_FLASH_FIRMWARE:-0}"
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
  install.sh [--repo owner/name] [--version x.y.z] [--flash-firmware] [--] [setup args...]

What it does:
  - detects macOS architecture
  - downloads the matching codexbar-display release binary from GitHub Releases
  - verifies the SHA-256 checksum from the release checksum file
  - runs `codexbar-display setup --yes --skip-flash [setup args...]`
  - optionally runs `codexbar-display upgrade` to flash release firmware when --flash-firmware is passed
  - warms up CodexBar on fresh installs so providers are usable
  - runs a health check after setup

Examples:
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
  curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash -s -- --target http://vibetv.local --theme mini
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

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "missing required command: $1"
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

  require_cmd curl
  require_cmd shasum
  require_cmd awk
  require_cmd sed
  require_cmd grep
  require_cmd uname
  require_cmd mktemp

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
  "$DOWNLOAD_BIN" setup --yes --skip-flash "${SETUP_ARGS[@]+"${SETUP_ARGS[@]}"}"

  if [[ ! -x "$INSTALL_PATH" ]]; then
    die "setup finished but expected installed binary is missing: ${INSTALL_PATH}"
  fi

  seed_codexbar_config_if_missing
  if ! wait_for_codexbar_ready; then
    die "CodexBar installed, but provider warm-up did not complete. Open CodexBar once, make sure at least one provider is active, then rerun the installer."
  fi

  if [[ "$FLASH_FIRMWARE" == "1" ]]; then
    log "vibetv: upgrading firmware from release..."
    build_firmware_upgrade_args "${SETUP_ARGS[@]}"
    "$INSTALL_PATH" upgrade "${FIRMWARE_UPGRADE_ARGS[@]}"
  fi

  log "vibetv: installed binary at ${INSTALL_PATH}"
  log "vibetv: running health check..."
  "$INSTALL_PATH" health

  log "vibetv: setup complete"
}

main "$@"
