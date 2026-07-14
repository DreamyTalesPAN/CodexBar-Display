#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APP_NAME="VibeTV Control Center"
VERSION="${VERSION:-0.0.0}"
APP_DIR="${ROOT}/dist/macos/${APP_NAME}.app"
DMG_PATH="${ROOT}/dist/macos/VibeTV-Control-Center-v${VERSION#v}.dmg"
STAGING_DIR=""
VOLUME_NAME="VibeTV Control Center"
DRY_RUN=0

usage() {
  cat <<EOF
Usage:
  build-macos-control-center-dmg.sh [--app path.app] [--output file.dmg] [--staging-dir dir] [--volume-name name] [--version x.y.z] [--dry-run]

Creates the customer DMG containing ${APP_NAME}.app and an Applications symlink.
Dry-run mode prepares and validates the staging folder without hdiutil.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_value() {
  local name="$1"
  local value="${2:-}"
  [[ -n "$value" ]] || die "${name} needs a value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      need_value "$1" "${2:-}"
      APP_DIR="$2"
      shift 2
      ;;
    --output)
      need_value "$1" "${2:-}"
      DMG_PATH="$2"
      shift 2
      ;;
    --staging-dir)
      need_value "$1" "${2:-}"
      STAGING_DIR="$2"
      shift 2
      ;;
    --volume-name)
      need_value "$1" "${2:-}"
      VOLUME_NAME="$2"
      shift 2
      ;;
    --version)
      need_value "$1" "${2:-}"
      VERSION="${2#v}"
      DMG_PATH="${ROOT}/dist/macos/VibeTV-Control-Center-v${VERSION}.dmg"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

validate_app_bundle() {
  [[ -d "$APP_DIR" ]] || die "app bundle not found: ${APP_DIR}"
  [[ -f "${APP_DIR}/Contents/Info.plist" ]] || die "app bundle is missing Contents/Info.plist"
  [[ -d "${APP_DIR}/Contents/MacOS" ]] || die "app bundle is missing Contents/MacOS"
  find "${APP_DIR}/Contents/MacOS" -mindepth 1 -maxdepth 1 -type f -perm -111 | grep -q . \
    || die "app bundle has no executable file under Contents/MacOS"
}

prepare_staging_dir() {
  if [[ -z "$STAGING_DIR" ]]; then
    STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-dmg.XXXXXX")"
  fi

  rm -rf "$STAGING_DIR"
  mkdir -p "$STAGING_DIR"
  cp -R "$APP_DIR" "$STAGING_DIR/"
  ln -s /Applications "${STAGING_DIR}/Applications"
}

main() {
  validate_app_bundle
  prepare_staging_dir

  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'prepared DMG dry-run staging folder: %s\n' "$STAGING_DIR"
    return 0
  fi

  [[ "$(uname -s)" == "Darwin" ]] || die "real DMG builds require macOS"
  command -v hdiutil >/dev/null 2>&1 || die "hdiutil is required to build a DMG"

  mkdir -p "$(dirname "$DMG_PATH")"
  rm -f "$DMG_PATH"
  hdiutil create \
    -volname "$VOLUME_NAME" \
    -srcfolder "$STAGING_DIR" \
    -ov \
    -format UDZO \
    "$DMG_PATH"

  printf 'built DMG: %s\n' "$DMG_PATH"
}

main "$@"
