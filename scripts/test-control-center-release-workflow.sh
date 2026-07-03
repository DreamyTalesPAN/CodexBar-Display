#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="${ROOT}/.github/workflows/release.yml"
LOCAL_INSTALLER="${ROOT}/scripts/install-control-center-companion.sh"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

job_block() {
  local job="$1"
  awk -v job="$job" '
    $0 == "  " job ":" { in_job = 1; print; next }
    in_job && $0 ~ /^  [A-Za-z0-9_-]+:/ { exit }
    in_job { print }
  ' "$WORKFLOW"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  [[ "$haystack" == *"$needle"* ]] || die "$message"
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  [[ "$haystack" != *"$needle"* ]] || die "$message"
}

line_number() {
  local needle="$1"
  grep -nF "$needle" "$WORKFLOW" | head -n1 | cut -d: -f1
}

installer_line_number() {
  local needle="$1"
  grep -nF "$needle" "$LOCAL_INSTALLER" | head -n1 | cut -d: -f1
}

main() {
  [[ -f "$WORKFLOW" ]] || die "release workflow is missing"
  [[ -f "$LOCAL_INSTALLER" ]] || die "local Control Center installer is missing"

  local release_job release_count checksum_line release_line
  local local_installer local_installer_build_line local_installer_go_build_line
  local local_static_builder
  release_job="$(job_block "build-and-release")"
  local_installer="$(cat "$LOCAL_INSTALLER")"
  local_static_builder="$(cat "$ROOT/apps/control-center/scripts/build-local-static.mjs")"

  assert_contains "$release_job" "Build release checksums" \
    "build-and-release must build release checksums"
  assert_contains "$release_job" "release/firmware-versions.json" \
    "release workflow must read explicit firmware versions"
  assert_contains "$release_job" "dist/install-control-center-companion.sh" \
    "GitHub Release must include the Mac setup script"
  assert_contains "$release_job" "npm run build:local" \
    "release workflow must build the local Control Center static export"
  assert_contains "$release_job" "companion/internal/companionapi/controlcenter_static" \
    "release workflow must embed the local Control Center static export"
  assert_contains "$release_job" "dist/companion/*" \
    "GitHub Release must include the Mac companion binaries"
  assert_contains "$release_job" 'CODEXBAR_DISPLAY_FW_VERSION="${FW_VERSION}"' \
    "firmware builds must use the explicit firmware version"
  assert_not_contains "$release_job" 'CODEXBAR_DISPLAY_FW_VERSION="${VERSION}"' \
    "firmware version must not be derived from the app release tag"
  assert_not_contains "$release_job" '"firmwareVersion": version' \
    "firmware manifest versions must not be derived from the app release tag"
  assert_not_contains "$release_job" "needs: build-companion-pkgs" \
    "build-and-release must not wait for Mac App PKGs"
  assert_not_contains "$release_job" "actions/download-artifact" \
    "build-and-release must not download package artifacts"
  assert_not_contains "$release_job" "companion-pkgs" \
    "build-and-release must not reference package artifacts"
  assert_not_contains "$release_job" "dist/companion-pkg" \
    "GitHub Release must not include Mac App package assets"
  assert_not_contains "$release_job" ".pkg" \
    "GitHub Release must not include Mac App package assets"
  assert_not_contains "$(cat "$WORKFLOW")" "build-companion-pkgs:" \
    "release workflow must not build Mac App packages"

  release_count="$(grep -cF "softprops/action-gh-release@v2" "$WORKFLOW")"
  [[ "$release_count" == "1" ]] \
    || die "release workflow must have exactly one public GitHub Release creation step"

  checksum_line="$(line_number "Build release checksums")"
  release_line="$(line_number "Create GitHub Release")"
  local_build_line="$(line_number "npm run build:local")"
  companion_build_line="$(line_number "go build")"
  [[ -n "$checksum_line" && -n "$release_line" ]] \
    || die "release workflow must build checksums before creating the release"
  (( checksum_line < release_line )) \
    || die "release checksums must be built before creating the release"
  [[ -n "$local_build_line" && -n "$companion_build_line" ]] \
    || die "release workflow must build local Control Center before companion binaries"
  (( local_build_line < companion_build_line )) \
    || die "local Control Center static export must be embedded before Go binaries are built"

  assert_contains "$local_installer" "npm run build:local" \
    "local installer must build the local Control Center static export"
  assert_contains "$local_installer" "controlcenter_static" \
    "local installer must embed the local Control Center static export"
  local_installer_build_line="$(installer_line_number "npm run build:local")"
  local_installer_go_build_line="$(installer_line_number "go build")"
  [[ -n "$local_installer_build_line" && -n "$local_installer_go_build_line" ]] \
    || die "local installer must build local Control Center before companion binary"
  (( local_installer_build_line < local_installer_go_build_line )) \
    || die "local installer must embed local Control Center before Go binary is built"
  assert_contains "$local_static_builder" "http://127.0.0.1:47832/theme-packs/vibetv-theme-packs.json" \
    "local static Control Center must resolve theme packs from the local Companion"
  assert_contains "$local_static_builder" "dist\", \"theme-packs" \
    "local static Control Center must embed built theme-pack downloads"

  printf 'control-center release workflow test passed\n'
}

main "$@"
