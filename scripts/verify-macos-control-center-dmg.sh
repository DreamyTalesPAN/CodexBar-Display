#!/usr/bin/env bash
set -euo pipefail

APP_NAME="VibeTV Control Center"
DMG_PATH=""
DRY_RUN=0
MOUNT_DIR=""

usage() {
  cat <<'EOF'
Usage:
  verify-macos-control-center-dmg.sh --dmg file.dmg [--dry-run]

Verifies the final signed, notarized, and stapled customer DMG. Real mode
checks the DMG container and signature, validates the stapled ticket, mounts
the exact artifact, and runs signature and Gatekeeper checks on the app copy
inside it.
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

cleanup() {
  if [[ -n "$MOUNT_DIR" && -d "$MOUNT_DIR" ]]; then
    hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
    rmdir "$MOUNT_DIR" >/dev/null 2>&1 || true
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg)
      need_value "$1" "${2:-}"
      DMG_PATH="$2"
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

[[ -n "$DMG_PATH" ]] || die "--dmg is required"

if [[ "$DRY_RUN" == "1" ]]; then
  cat <<EOF
dry-run: planned distribution verification for ${DMG_PATH}:
  hdiutil verify "${DMG_PATH}"
  codesign --verify --strict --verbose=2 "${DMG_PATH}"
  xcrun stapler validate "${DMG_PATH}"
  spctl --assess --type open --context context:primary-signature --verbose=4 "${DMG_PATH}"
  hdiutil attach -readonly -nobrowse -noautoopen "${DMG_PATH}"
  codesign --verify --deep --strict --verbose=2 "<mount>/${APP_NAME}.app"
  spctl --assess --type execute --verbose=4 "<mount>/${APP_NAME}.app"
EOF
  exit 0
fi

[[ "$(uname -s)" == "Darwin" ]] || die "DMG distribution verification requires macOS"
[[ -f "$DMG_PATH" ]] || die "DMG not found: ${DMG_PATH}"
for command in codesign hdiutil spctl xcrun; do
  command -v "$command" >/dev/null 2>&1 || die "${command} is required"
done

trap cleanup EXIT

hdiutil verify "$DMG_PATH"
codesign --verify --strict --verbose=2 "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
spctl \
  --assess \
  --type open \
  --context context:primary-signature \
  --verbose=4 \
  "$DMG_PATH"

MOUNT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-dmg-verify.XXXXXX")"
hdiutil attach \
  -readonly \
  -nobrowse \
  -noautoopen \
  -mountpoint "$MOUNT_DIR" \
  "$DMG_PATH" >/dev/null

MOUNTED_APP="${MOUNT_DIR}/${APP_NAME}.app"
[[ -d "$MOUNTED_APP" ]] || die "DMG is missing ${APP_NAME}.app"
[[ -L "${MOUNT_DIR}/Applications" ]] || die "DMG is missing the Applications symlink"
[[ "$(readlink "${MOUNT_DIR}/Applications")" == "/Applications" ]] \
  || die "DMG Applications symlink does not point to /Applications"

codesign --verify --deep --strict --verbose=2 "$MOUNTED_APP"
spctl --assess --type execute --verbose=4 "$MOUNTED_APP"

printf 'verified signed, notarized, stapled, Gatekeeper-approved DMG: %s\n' "$DMG_PATH"
