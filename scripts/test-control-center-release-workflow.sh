#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="${ROOT}/.github/workflows/release.yml"
CI_WORKFLOW="${ROOT}/.github/workflows/ci.yml"
PREVIEW_WORKFLOW="${ROOT}/.github/workflows/validate-macos-dmg.yml"
PUBLISH_WORKFLOW_TEST="${ROOT}/scripts/test-release-publish-workflow.sh"
PUBLISH_GATE_TEST="${ROOT}/scripts/test-release-publish-gate.py"
LOCAL_INSTALLER="${ROOT}/scripts/install-control-center-companion.sh"
RELEASE_INSTALLER="${ROOT}/scripts/install-control-center-companion-release.sh"
PUBLIC_INSTALLER="${ROOT}/apps/control-center/public/install-control-center-companion.sh"
SIGNING_SCRIPT="${ROOT}/scripts/sign-notarize-macos-control-center.sh"
VERIFY_DMG_SCRIPT="${ROOT}/scripts/verify-macos-control-center-dmg.sh"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
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

installer_line_number() {
  local needle="$1"
  grep -nF "$needle" "$LOCAL_INSTALLER" | head -n1 | cut -d: -f1
}

main() {
  [[ -x "$PUBLISH_WORKFLOW_TEST" ]] || die "publish workflow contract test is missing"
  [[ -f "$PUBLISH_GATE_TEST" ]] || die "publish gate fixture test is missing"
  [[ -f "$WORKFLOW" ]] || die "release workflow is missing"
  [[ -f "$PREVIEW_WORKFLOW" ]] || die "macOS preview workflow is missing"
  [[ -f "$LOCAL_INSTALLER" ]] || die "local Control Center installer is missing"
  [[ -f "$RELEASE_INSTALLER" ]] || die "release Control Center installer is missing"
  [[ -f "$PUBLIC_INSTALLER" ]] || die "public Control Center installer is missing"
  [[ -x "$SIGNING_SCRIPT" ]] \
    || die "macOS signing/notarization script is missing or not executable"
  [[ -x "$VERIFY_DMG_SCRIPT" ]] \
    || die "macOS DMG verification script is missing or not executable"
  cmp -s "$RELEASE_INSTALLER" "$PUBLIC_INSTALLER" \
    || die "public Control Center installer must match the release installer"

  "$PUBLISH_WORKFLOW_TEST"
  python3 "$PUBLISH_GATE_TEST"

  local workflow ci_workflow preview_workflow signing_script verify_dmg_plan
  local local_installer release_installer local_static_builder
  local verify_dmg_open_line verify_syspolicy_line verify_app_spctl_line
  local local_installer_build_line local_installer_go_build_line
  workflow="$(cat "$WORKFLOW")"
  ci_workflow="$(cat "$CI_WORKFLOW")"
  preview_workflow="$(cat "$PREVIEW_WORKFLOW")"
  signing_script="$(cat "$SIGNING_SCRIPT")"
  local_installer="$(cat "$LOCAL_INSTALLER")"
  release_installer="$(cat "$RELEASE_INSTALLER")"
  local_static_builder="$(cat "$ROOT/apps/control-center/scripts/build-local-static.mjs")"
  verify_dmg_plan="$("$VERIFY_DMG_SCRIPT" \
    --dry-run \
    --dmg "/tmp/VibeTV-Control-Center.dmg")"

  # Publication consumes the already signed candidate. Signing secrets and
  # build tools stay in the separate candidate workflow.
  for forbidden in \
    APPLE_SIGNING_CERTIFICATE_P12_BASE64 \
    APPLE_NOTARY_KEY_P8_BASE64 \
    SPARKLE_ED25519_PRIVATE_KEY \
    build-macos-control-center-app.sh \
    build-macos-control-center-dmg.sh \
    sign-notarize-macos-control-center.sh \
    "go build" \
    "npm ci" \
    "pio run" \
    softprops/action-gh-release
  do
    assert_not_contains "$workflow" "$forbidden" \
      "publish workflow must not rebuild or re-sign candidate assets: ${forbidden}"
  done

  # Preview remains a separate, trusted, read-only path.
  assert_contains "$preview_workflow" "workflow_dispatch:" \
    "preview workflow must remain manually dispatched"
  assert_contains "$preview_workflow" \
    "github.repository == 'DreamyTalesPAN/CodexBar-Display'" \
    "preview workflow must stay limited to the trusted repository"
  assert_contains "$preview_workflow" "github.ref == 'refs/heads/main'" \
    "preview workflow definition must run only from trusted main"
  assert_contains "$preview_workflow" "github.actor == github.repository_owner" \
    "preview workflow must keep the repository owner authorized"
  assert_contains "$preview_workflow" "github.actor == 'marcus7989'" \
    "preview workflow must authorize Marcus explicitly"
  assert_contains "$preview_workflow" "contents: read" \
    "preview workflow must retain read-only repository permissions"
  assert_not_contains "$preview_workflow" "contents: write" \
    "preview workflow must not gain repository write access"
  assert_not_contains "$preview_workflow" "softprops/action-gh-release" \
    "preview workflow must not publish a GitHub Release"
  assert_contains "$preview_workflow" "persist-credentials: false" \
    "preview source checkout must not persist GitHub credentials"
  assert_contains "$preview_workflow" \
    "ref: 24c3855468991f28ef1af2df905b95944d90985c" \
    "preview signing job must keep the reviewed nested-Sparkle source"

  # CI still owns the local dry-run and native macOS checks.
  assert_contains "$ci_workflow" "Test macOS Control Center DMG prep" \
    "CI must run the macOS app/DMG dry-run test"
  assert_contains "$ci_workflow" "test-macos-control-center-app-bundle.sh" \
    "CI must run the macOS app/DMG dry-run test script"
  assert_contains "$ci_workflow" "macos-control-center-tests:" \
    "CI must isolate native Swift checks in a macOS job"
  assert_contains "$ci_workflow" "runs-on: macos-latest" \
    "native Swift and URL-scheme checks must run on macOS"

  assert_contains \
    "$(cat "$ROOT/apps/control-center/src/app/api/companion/latest/route.ts")" \
    "CONTROL_CENTER_ENABLE_MAC_APP_DMG_DOWNLOAD" \
    "hosted DMG download must stay behind the server-side feature flag"
  assert_contains \
    "$(cat "$ROOT/apps/control-center/src/app/api/companion/latest/route.ts")" \
    "VibeTV-Control-Center.dmg" \
    "hosted release check must require the exact stable DMG asset name"
  assert_contains \
    "$(cat "$ROOT/apps/control-center/src/app/api/companion/latest/route.ts")" \
    "verifiedDmgAsset" \
    "hosted release check must verify the GitHub asset before returning its URL"
  assert_not_contains \
    "$(cat "$ROOT/apps/control-center/src/components/mac-app-install-command.ts")" \
    "releases/latest/download/VibeTV-Control-Center.dmg" \
    "hosted setup must not use an unchecked latest-release DMG fallback"
  assert_contains \
    "$(cat "$ROOT/apps/control-center/src/components/setup-screen.tsx")" \
    "Download Mac App" \
    "hosted setup must present the DMG download as the primary Mac App action"
  assert_contains "$(cat "$ROOT/macos/VibeTVControlCenter/main.swift")" \
    "migration-backups" \
    "native Mac App must preserve old setup LaunchAgents during migration"

  # Keep direct signing/notarization safety coverage even though publication
  # no longer signs or rebuilds.
  assert_contains "$signing_script" "--output-format json" \
    "signing script must capture structured notarytool output"
  assert_contains "$signing_script" 'notary_status" != "Accepted"' \
    "signing script must reject every notarization result except Accepted"
  assert_contains "$signing_script" "notarytool log" \
    "signing script must retrieve the Apple notarization log"
  assert_contains "$signing_script" "xcrun stapler validate" \
    "signing script must validate the stapled DMG ticket"
  assert_contains "$signing_script" "syspolicy_check notary-submission" \
    "signing script must run the modern pre-notarization policy check"
  assert_contains "$signing_script" "--allow-internal-xprotect-preflight-error" \
    "signing script must keep the narrow XProtect diagnostic exception"
  assert_contains "$signing_script" "notarization log contains" \
    "Accepted notarization logs with issues must still fail"
  assert_contains "$signing_script" "does not match APPLE_TEAM_ID" \
    "signing script must reject a certificate for the wrong Apple team"

  # Keep the static final-DMG distribution gate and ordering checks.
  for required in \
    "hdiutil verify" \
    "codesign --verify --strict" \
    "xcrun stapler validate" \
    "spctl --assess --type open" \
    "hdiutil attach -readonly" \
    "spctl --assess --type execute" \
    "syspolicy_check distribution"
  do
    assert_contains "$verify_dmg_plan" "$required" \
      "DMG distribution gate is missing: ${required}"
  done
  verify_dmg_open_line="$(
    printf '%s\n' "$verify_dmg_plan" |
      grep -nF "spctl --assess --type open" |
      cut -d: -f1
  )"
  verify_syspolicy_line="$(
    printf '%s\n' "$verify_dmg_plan" |
      grep -nF "syspolicy_check distribution" |
      cut -d: -f1
  )"
  verify_app_spctl_line="$(
    printf '%s\n' "$verify_dmg_plan" |
      grep -nF "spctl --assess --type execute" |
      cut -d: -f1
  )"
  (( verify_dmg_open_line < verify_syspolicy_line &&
    verify_syspolicy_line < verify_app_spctl_line )) \
    || die "mounted-app policy checks are in the wrong order"

  # Keep installer/customer-path safety coverage.
  assert_contains "$local_installer" "npm run build:local" \
    "local installer must build the local Control Center static export"
  assert_contains "$local_installer" "controlcenter_static" \
    "local installer must embed the local Control Center static export"
  local_installer_build_line="$(installer_line_number "npm run build:local")"
  local_installer_go_build_line="$(installer_line_number "go build")"
  (( local_installer_build_line < local_installer_go_build_line )) \
    || die "local installer must embed local Control Center before Go build"
  assert_contains "$local_static_builder" \
    "http://127.0.0.1:47832/theme-packs/vibetv-theme-packs.json" \
    "local static Control Center must use the local Companion theme catalog"
  assert_contains "$local_static_builder" 'dist", "theme-packs' \
    "local static Control Center must embed theme-pack downloads"

  for required in \
    fetch_dev_source_ref \
    build_source_binary \
    /api/deployment \
    verify_control_center_available \
    verify_local_service_stable \
    ThrottleInterval \
    VIBETV \
    INSTALL_LOG_PATH \
    "Support log:" \
    --verbose \
    VIBETV_VERBOSE \
    step_start \
    run_quiet \
    "run_quiet npm ci" \
    "run_quiet npm run build:local"
  do
    assert_contains "$release_installer" "$required" \
      "release installer safety contract is missing: ${required}"
  done
  assert_contains "$release_installer" \
    'DISPLAY_DAEMON_LOG_ERR="${INSTALL_LOG_DIR}/daemon.err.log"' \
    "installer must keep daemon logs in the support log folder"
  assert_contains "$release_installer" \
    'run_quiet "$BIN_PATH" install-update' \
    "installer must hide firmware update noise by default"

  local firmware_versions
  firmware_versions="$(cat "${ROOT}/release/firmware-versions.json")"
  assert_not_contains "$firmware_versions" "vibetv.shop" \
    "firmware update messages must not send customers to a hosted URL"
  assert_contains "$firmware_versions" "VibeTV Mac App" \
    "firmware update messages must name the VibeTV Mac App"

  printf 'control-center release workflow test passed\n'
}

main "$@"
