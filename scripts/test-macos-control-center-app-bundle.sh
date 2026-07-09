#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_TEST_DIR=""

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

assert_file() {
  [[ -f "$1" ]] || die "missing file: $1"
}

cleanup() {
  if [[ -n "$TMP_TEST_DIR" ]]; then
    rm -rf "$TMP_TEST_DIR"
  fi
}

main() {
  local tmp app dmg stage sign_output
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-macos-test.XXXXXX")"
  TMP_TEST_DIR="$tmp"
  trap cleanup EXIT

  app="${tmp}/VibeTV Control Center.app"
  dmg="${tmp}/VibeTV-Control-Center-v1.2.3.dmg"
  stage="${tmp}/dmg-stage"

  "${ROOT}/scripts/build-macos-control-center-app.sh" \
    --dry-run \
    --version "1.2.3" \
    --build "146" \
    --output "$app" >/dev/null

  assert_file "${app}/Contents/Info.plist"
  [[ -x "${app}/Contents/MacOS/VibeTVControlCenter" ]] \
    || die "app executable is missing or not executable"
  [[ -d "${app}/Contents/Resources/control-center" ]] \
    || die "Control Center resource folder is missing"
  assert_file "${app}/Contents/Resources/companion/BUNDLED_COMPANION.md"
  assert_file "${app}/Contents/Resources/VibeTVControlCenter.icns"

  python3 - "${app}/Contents/Info.plist" <<'PY'
import plistlib
import sys

with open(sys.argv[1], "rb") as f:
    plist = plistlib.load(f)

expected = {
    "CFBundleIdentifier": "shop.vibetv.control-center",
    "CFBundleName": "VibeTV Control Center",
    "CFBundleDisplayName": "VibeTV Control Center",
    "CFBundleExecutable": "VibeTVControlCenter",
    "CFBundleIconFile": "VibeTVControlCenter.icns",
    "CFBundleShortVersionString": "1.2.3",
    "CFBundleVersion": "146",
    "CFBundlePackageType": "APPL",
}

for key, value in expected.items():
    actual = plist.get(key)
    if actual != value:
        raise SystemExit(f"{key}: expected {value!r}, got {actual!r}")

if plist.get("NSAppTransportSecurity", {}).get("NSAllowsLocalNetworking") is not True:
    raise SystemExit("NSAllowsLocalNetworking must be true")
PY

  "${ROOT}/scripts/build-macos-control-center-dmg.sh" \
    --dry-run \
    --app "$app" \
    --output "$dmg" \
    --staging-dir "$stage" >/dev/null

  [[ -d "${stage}/VibeTV Control Center.app" ]] \
    || die "DMG staging folder is missing the app bundle"
  [[ -L "${stage}/Applications" ]] \
    || die "DMG staging folder is missing the Applications symlink"
  [[ "$(readlink "${stage}/Applications")" == "/Applications" ]] \
    || die "Applications symlink must point to /Applications"
  [[ ! -f "$dmg" ]] \
    || die "DMG dry-run must not create a real DMG"

  sign_output="$("${ROOT}/scripts/sign-notarize-macos-control-center.sh" \
    --dry-run \
    --app "$app" \
    --dmg "$dmg" 2>&1)"

  for secret in \
    APPLE_TEAM_ID \
    APPLE_SIGNING_CERTIFICATE_P12_BASE64 \
    APPLE_SIGNING_CERTIFICATE_PASSWORD \
    APPLE_NOTARY_KEY_ID \
    APPLE_NOTARY_ISSUER_ID \
    APPLE_NOTARY_KEY_P8_BASE64
  do
    assert_contains "$sign_output" "$secret" "signing dry-run must name missing ${secret}"
  done

  assert_contains "$sign_output" "codesign --force --options runtime" \
    "signing dry-run must show hardened-runtime codesign"
  assert_contains "$sign_output" "xcrun notarytool submit" \
    "signing dry-run must show notarytool submission"
  assert_contains "$sign_output" "xcrun stapler staple" \
    "signing dry-run must show stapler"
  assert_contains "$sign_output" "spctl --assess" \
    "signing dry-run must show Gatekeeper assessment"

  grep -qF "com.codexbar-display.daemon" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must detect the old LaunchAgent"
  grep -qF "migration-backups" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must back up old LaunchAgents during migration"
  grep -qF "/v1/status" "${ROOT}/macos/VibeTVControlCenter/main.swift" \
    || die "native app shell must check the local Mac App before starting a new one"

  grep -qF "test-macos-control-center-app-bundle.sh" "${ROOT}/.github/workflows/ci.yml" \
    || die "CI must run the macOS app/DMG dry-run test"
  ! grep -Eq "brew (tap|publish|pr|create)|Homebrew/homebrew" "${ROOT}/.github/workflows/release.yml" \
    || die "release workflow must not publish Homebrew assets"
  grep -qF ".dmg" "${ROOT}/docs/operator-runbook.md" \
    || die "operator runbook must include DMG release readiness"

  printf 'macOS Control Center app bundle prep test passed\n'
}

main "$@"
