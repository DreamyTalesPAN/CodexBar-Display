#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="${ROOT}/.github/workflows/release.yml"
CI_WORKFLOW="${ROOT}/.github/workflows/ci.yml"
LOCAL_INSTALLER="${ROOT}/scripts/install-control-center-companion.sh"
RELEASE_INSTALLER="${ROOT}/scripts/install-control-center-companion-release.sh"
PUBLIC_INSTALLER="${ROOT}/apps/control-center/public/install-control-center-companion.sh"
SIGNING_SCRIPT="${ROOT}/scripts/sign-notarize-macos-control-center.sh"
VERIFY_DMG_SCRIPT="${ROOT}/scripts/verify-macos-control-center-dmg.sh"

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
  [[ -x "$SIGNING_SCRIPT" ]] || die "macOS signing/notarization script is missing or not executable"
  [[ -x "$VERIFY_DMG_SCRIPT" ]] || die "macOS DMG verification script is missing or not executable"
  cmp -s "$RELEASE_INSTALLER" "$PUBLIC_INSTALLER" \
    || die "public Control Center installer must match the release installer"

  local release_job macos_job release_count checksum_line release_line download_dmg_line
  local build_dmg_line verify_dmg_line upload_dmg_line require_dmg_line
  local local_installer release_installer local_installer_build_line local_installer_go_build_line
  local local_static_builder ci_workflow signing_script verify_dmg_plan workflow
  local verify_dmg_open_line verify_syspolicy_line verify_app_spctl_line
  release_job="$(job_block "build-and-release")"
  local_installer="$(cat "$LOCAL_INSTALLER")"
  release_installer="$(cat "$RELEASE_INSTALLER")"
  local_static_builder="$(cat "$ROOT/apps/control-center/scripts/build-local-static.mjs")"
  ci_workflow="$(cat "$CI_WORKFLOW")"
  workflow="$(cat "$WORKFLOW")"
  signing_script="$(cat "$SIGNING_SCRIPT")"
  verify_dmg_plan="$("$VERIFY_DMG_SCRIPT" --dry-run --dmg "/tmp/VibeTV-Control-Center.dmg")"
  macos_job="$(job_block "build-macos-dmg")"

  assert_not_contains "$workflow" "workflow_dispatch:" \
    "public release workflow must not expose the validation-only trigger"
  assert_not_contains "$workflow" "validation_version:" \
    "public release workflow must not accept a validation bundle version"
  assert_contains "$workflow" "permissions:" \
    "release workflow must declare least-privilege permissions"
  assert_contains "$workflow" "contents: read" \
    "release workflow must keep repository write access out of the build job"

  assert_contains "$macos_job" "runs-on: macos-latest" \
    "release workflow must build the customer DMG on macOS"
  assert_contains "$macos_job" "APPLE_SIGNING_CERTIFICATE_P12_BASE64" \
    "macOS DMG job must receive the Developer ID signing certificate secret"
  assert_contains "$macos_job" "APPLE_NOTARY_KEY_P8_BASE64" \
    "macOS DMG job must receive the Apple notarization key secret"
  assert_contains "$macos_job" "Validate Apple release secrets" \
    "macOS DMG job must fail before building when Apple secrets are absent"
  assert_contains "$macos_job" "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')" \
    "macOS DMG job must run only for a public release tag"
  assert_contains "$macos_job" 'VERSION: ${{ github.ref_name }}' \
    "macOS DMG job must derive its version from the public release tag"
  assert_contains "$macos_job" "macOS DMG version must be SemVer x.y.z" \
    "release DMG build must reject an invalid bundle version"
  assert_contains "$macos_job" 'Missing required GitHub Actions secret: ${name}' \
    "macOS DMG job must report missing Apple secrets without exposing their values"
  for secret in \
    APPLE_TEAM_ID \
    APPLE_SIGNING_CERTIFICATE_P12_BASE64 \
    APPLE_SIGNING_CERTIFICATE_PASSWORD \
    APPLE_NOTARY_KEY_ID \
    APPLE_NOTARY_ISSUER_ID \
    APPLE_NOTARY_KEY_P8_BASE64
  do
    assert_contains "$macos_job" "$secret" \
      "macOS DMG job must validate ${secret}"
  done
  assert_contains "$macos_job" "npm run build:local" \
    "macOS DMG job must build the local Control Center static export"
  assert_contains "$macos_job" "companion/internal/companionapi/controlcenter_static" \
    "macOS DMG job must embed the local Control Center static export before building the bundled companion"
  assert_contains "$macos_job" "cp -R apps/control-center/out-local/. companion/internal/companionapi/controlcenter_static/" \
    "macOS DMG job must copy the local Control Center static export into the bundled companion"
  assert_contains "$macos_job" "for ARCH in amd64 arm64" \
    "macOS DMG job must build both Darwin companion architectures"
  assert_contains "$macos_job" "lipo -create" \
    "macOS DMG job must combine the bundled companion binary into a universal binary"
  assert_contains "$macos_job" "build-macos-control-center-app.sh" \
    "macOS DMG job must build the real app bundle"
  assert_contains "$macos_job" "--universal" \
    "macOS DMG job must build a universal native app shell"
  assert_contains "$macos_job" "--sign-app-only" \
    "macOS DMG job must sign the app before creating the DMG"
  assert_contains "$macos_job" "build-macos-control-center-dmg.sh" \
    "macOS DMG job must build the real DMG"
  assert_contains "$macos_job" "--skip-app-sign" \
    "macOS DMG job must sign and notarize the DMG without re-signing the app copy"
  assert_contains "$macos_job" "--notary-log" \
    "macOS DMG job must preserve Apple notarization evidence"
  assert_contains "$macos_job" "Verify notarized Mac DMG for distribution" \
    "macOS DMG job must run a separate final distribution gate"
  assert_contains "$macos_job" "verify-macos-control-center-dmg.sh" \
    "macOS DMG job must verify the exact DMG that will be uploaded"
  assert_contains "$macos_job" "Upload notarization evidence" \
    "macOS DMG job must preserve the Apple notarization log"
  assert_contains "$macos_job" "VibeTV-Control-Center.dmg" \
    "macOS DMG job must produce the stable latest-download DMG asset"
  assert_contains "$macos_job" "actions/upload-artifact@v4" \
    "macOS DMG job must upload the notarized DMG for the release job"
  assert_not_contains "$macos_job" "--dry-run" \
    "macOS DMG job must run the real signing/notarization path"
  assert_contains "$release_job" "needs: build-macos-dmg" \
    "public release job must wait for the notarized Mac DMG"
  assert_contains "$release_job" "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')" \
    "public release job must run only for a release tag"
  assert_contains "$release_job" "contents: write" \
    "only the public tag release job may receive repository write access"
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
  assert_contains "$release_job" "Download notarized Mac DMG" \
    "release workflow must download the notarized DMG before checksums"
  assert_contains "$release_job" "actions/download-artifact@v4" \
    "release workflow must download the notarized DMG artifact"
  assert_contains "$release_job" "Require verified Mac DMG" \
    "release workflow must require the exact stable DMG before checksums"
  assert_contains "$release_job" "dist/macos/*.dmg" \
    "GitHub Release must include the notarized Mac DMG"
  assert_contains "$release_job" "build-macos-control-center-app.sh" \
    "release workflow must dry-run the macOS app bundle structure"
  assert_contains "$release_job" "build-macos-control-center-dmg.sh" \
    "release workflow must dry-run the macOS DMG structure"
  assert_contains "$release_job" "sign-notarize-macos-control-center.sh" \
    "release workflow must dry-run the macOS signing/notary plan"
  assert_contains "$release_job" "tmp/macos-release-dry-run" \
    "release workflow dry-run artifacts must stay out of dist checksums"
  assert_contains "$release_job" 'CODEXBAR_DISPLAY_FW_VERSION="${FW_VERSION}"' \
    "firmware builds must use the explicit firmware version"
  assert_not_contains "$release_job" 'CODEXBAR_DISPLAY_FW_VERSION="${VERSION}"' \
    "firmware version must not be derived from the app release tag"
  assert_not_contains "$release_job" '"firmwareVersion": version' \
    "firmware manifest versions must not be derived from the app release tag"
  assert_not_contains "$release_job" "needs: build-companion-pkgs" \
    "build-and-release must not wait for Mac App PKGs"
  assert_not_contains "$release_job" "companion-pkgs" \
    "build-and-release must not reference package artifacts"
  assert_not_contains "$release_job" "dist/companion-pkg" \
    "GitHub Release must not include Mac App package assets"
  assert_not_contains "$release_job" ".pkg" \
    "GitHub Release must not include Mac App package assets"
  assert_not_contains "$release_job" "brew " \
    "GitHub Release must not publish Homebrew assets"
  assert_not_contains "$(cat "$WORKFLOW")" "build-companion-pkgs:" \
    "release workflow must not build Mac App packages"
  assert_contains "$ci_workflow" "Test macOS Control Center DMG prep" \
    "CI must run the macOS app/DMG dry-run test"
  assert_contains "$ci_workflow" "test-macos-control-center-app-bundle.sh" \
    "CI must run the macOS app/DMG dry-run test script"
  assert_contains "$ci_workflow" "macos-control-center-tests:" \
    "CI must isolate native Swift checks in a macOS job"
  assert_contains "$ci_workflow" "runs-on: macos-latest" \
    "native Swift and URL-scheme checks must run on macOS"
  assert_contains "$(cat "$ROOT/apps/control-center/src/app/api/companion/latest/route.ts")" "CONTROL_CENTER_ENABLE_MAC_APP_DMG_DOWNLOAD" \
    "hosted DMG download must stay behind the server-side feature flag"
  assert_contains "$(cat "$ROOT/apps/control-center/src/app/api/companion/latest/route.ts")" "VibeTV-Control-Center.dmg" \
    "hosted release check must require the exact stable DMG asset name"
  assert_contains "$(cat "$ROOT/apps/control-center/src/app/api/companion/latest/route.ts")" "verifiedDmgAsset" \
    "hosted release check must verify the GitHub asset before returning its URL"
  assert_not_contains "$(cat "$ROOT/apps/control-center/src/components/mac-app-install-command.ts")" "releases/latest/download/VibeTV-Control-Center.dmg" \
    "hosted setup must not use an unchecked latest-release DMG fallback"
  assert_contains "$(cat "$ROOT/apps/control-center/src/components/setup-screen.tsx")" "Download Mac App" \
    "hosted setup must present the DMG download as the primary Mac App action"
  assert_contains "$(cat "$ROOT/macos/VibeTVControlCenter/main.swift")" "migration-backups" \
    "native Mac App must preserve old setup LaunchAgents during migration"

  assert_contains "$signing_script" "--output-format json" \
    "signing script must capture structured notarytool output"
  assert_contains "$signing_script" 'notary_status" != "Accepted"' \
    "signing script must reject every notarization result except Accepted"
  assert_contains "$signing_script" "notarytool log" \
    "signing script must retrieve the Apple notarization log"
  assert_contains "$signing_script" "xcrun stapler validate" \
    "signing script must validate the stapled DMG ticket"
  assert_contains "$signing_script" "syspolicy_check notary-submission" \
    "signing script must run Apple's pre-notarization system-policy check when available"
  assert_contains "$signing_script" "--allow-internal-xprotect-preflight-error" \
    "signing script must expose the narrow validation-only XProtect preflight exception"
  assert_not_contains "$macos_job" "--allow-internal-xprotect-preflight-error" \
    "release workflow must never enable the validation-only XProtect preflight exception"
  assert_contains "$signing_script" "notarization log contains" \
    "signing script must reject Accepted notarization logs that still contain issues"
  assert_contains "$signing_script" "does not match APPLE_TEAM_ID" \
    "signing script must reject a certificate for the wrong Apple team"

  assert_contains "$verify_dmg_plan" "hdiutil verify" \
    "DMG distribution gate must verify the disk image container"
  assert_contains "$verify_dmg_plan" "codesign --verify --strict" \
    "DMG distribution gate must verify the DMG signature"
  assert_contains "$verify_dmg_plan" "xcrun stapler validate" \
    "DMG distribution gate must validate the stapled notarization ticket"
  assert_contains "$verify_dmg_plan" "spctl --assess --type open" \
    "DMG distribution gate must ask Gatekeeper to assess the disk image"
  assert_contains "$verify_dmg_plan" "hdiutil attach -readonly" \
    "DMG distribution gate must mount the exact final artifact read-only"
  assert_contains "$verify_dmg_plan" "spctl --assess --type execute" \
    "DMG distribution gate must ask Gatekeeper to assess the bundled app"
  assert_contains "$verify_dmg_plan" "syspolicy_check distribution" \
    "DMG distribution gate must run Apple's modern mounted-app policy check when available"

  verify_dmg_open_line="$(printf '%s\n' "$verify_dmg_plan" | grep -nF "spctl --assess --type open" | cut -d: -f1)"
  verify_syspolicy_line="$(printf '%s\n' "$verify_dmg_plan" | grep -nF "syspolicy_check distribution" | cut -d: -f1)"
  verify_app_spctl_line="$(printf '%s\n' "$verify_dmg_plan" | grep -nF "spctl --assess --type execute" | cut -d: -f1)"
  [[ -n "$verify_dmg_open_line" && -n "$verify_syspolicy_line" && -n "$verify_app_spctl_line" ]] \
    || die "DMG distribution gate order markers are incomplete"
  (( verify_dmg_open_line < verify_syspolicy_line && verify_syspolicy_line < verify_app_spctl_line )) \
    || die "mounted-app syspolicy check must run after DMG assessment and before legacy app assessment"

  release_count="$(grep -cF "softprops/action-gh-release@v2" "$WORKFLOW")"
  [[ "$release_count" == "1" ]] \
    || die "release workflow must have exactly one public GitHub Release creation step"

  checksum_line="$(line_number "Build release checksums")"
  release_line="$(line_number "Create GitHub Release")"
  download_dmg_line="$(line_number "Download notarized Mac DMG")"
  build_dmg_line="$(line_number "Build signed and notarized Mac DMG")"
  verify_dmg_line="$(line_number "Verify notarized Mac DMG for distribution")"
  upload_dmg_line="$(line_number "Upload notarized Mac DMG")"
  require_dmg_line="$(line_number "Require verified Mac DMG")"
  local_build_line="$(line_number "npm run build:local")"
  companion_build_line="$(line_number "go build")"
  [[ -n "$checksum_line" && -n "$release_line" && -n "$download_dmg_line" ]] \
    || die "release workflow must build checksums before creating the release"
  (( download_dmg_line < checksum_line )) \
    || die "notarized DMG must be downloaded before release checksums are built"
  (( build_dmg_line < verify_dmg_line && verify_dmg_line < upload_dmg_line )) \
    || die "the final DMG must be notarized and verified before artifact upload"
  (( download_dmg_line < require_dmg_line && require_dmg_line < checksum_line )) \
    || die "the downloaded verified DMG must be required before release checksums"
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
  assert_contains "$release_installer" "verify_local_service_stable" \
    "installer must verify the local service stays stable before opening it"
  assert_contains "$release_installer" "ThrottleInterval" \
    "installer LaunchAgent must throttle crash restart loops"
  assert_contains "$release_installer" 'DISPLAY_DAEMON_LOG_ERR="${INSTALL_LOG_DIR}/daemon.err.log"' \
    "installer must keep daemon logs in the customer support log folder"
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
