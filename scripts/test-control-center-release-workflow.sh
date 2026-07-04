#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="${ROOT}/.github/workflows/release.yml"
LOCAL_INSTALLER="${ROOT}/scripts/install-control-center-companion.sh"
RELEASE_INSTALLER="${ROOT}/scripts/install-control-center-companion-release.sh"
PUBLIC_INSTALLER="${ROOT}/apps/control-center/public/install-control-center-companion.sh"

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
  [[ -f "$RELEASE_INSTALLER" ]] || die "release Control Center installer is missing"
  [[ -f "$PUBLIC_INSTALLER" ]] || die "public Control Center installer is missing"
  cmp -s "$RELEASE_INSTALLER" "$PUBLIC_INSTALLER" \
    || die "public Control Center installer must match the release installer"

  local release_job release_count checksum_line release_line
  local local_installer release_installer local_installer_build_line local_installer_go_build_line
  local local_static_builder
  release_job="$(job_block "build-and-release")"
  local_installer="$(cat "$LOCAL_INSTALLER")"
  release_installer="$(cat "$RELEASE_INSTALLER")"
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
  assert_contains "$release_installer" "fetch_dev_source_ref" \
    "Preview setup must discover the deployed commit instead of installing the latest release"
  assert_contains "$release_installer" "build_source_binary" \
    "Preview setup must build the Mac App from the deployed source ref"
  assert_contains "$release_installer" "/api/deployment" \
    "Preview setup must read deployment metadata from the hosted app"
  assert_contains "$release_installer" "verify_control_center_available" \
    "installer must verify the local Control Center before opening it"
  assert_contains "$release_installer" "VIBETV" \
    "installer must show a simple VIBETV customer-facing heading"
  assert_contains "$release_installer" "INSTALL_LOG_PATH" \
    "installer must write technical details to a support log"
  assert_contains "$release_installer" "Support log:" \
    "installer must tell customers where the support log is"
  assert_contains "$release_installer" "--verbose" \
    "installer must offer a verbose debug mode"
  assert_contains "$release_installer" "VIBETV_VERBOSE" \
    "installer must support verbose mode through the environment"
  assert_contains "$release_installer" "step_start" \
    "installer must show customer-friendly setup steps"
  assert_contains "$release_installer" "run_quiet" \
    "installer must hide noisy command output by default"
  assert_contains "$release_installer" "run_quiet npm ci" \
    "Preview setup must hide npm install output by default"
  assert_contains "$release_installer" "run_quiet npm run build:local" \
    "Preview setup must hide Control Center build output by default"
  assert_contains "$release_installer" 'run_quiet "$BIN_PATH" install-update' \
    "installer must hide firmware update command output by default"

  printf 'control-center release workflow test passed\n'
}

main "$@"
